import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { prisma } from "@/lib/db/client";
import type Stripe from "stripe";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const type = session.metadata?.type;
      if (!userId) break;

      if (type === "match_pack") {
        // Idempotency guard — Stripe delivers webhooks at least once; stripeEventId is @unique
        const alreadyProcessed = await prisma.billingEvent.findUnique({
          where: { stripeEventId: event.id },
          select: { id: true },
        });
        if (!alreadyProcessed) {
          const billing = await prisma.billing.findUnique({ where: { userId } });
          if (billing) {
            await prisma.billing.updateMany({
              where: { userId },
              data: { purchasedCredits: { increment: 1 } },
            });
            await prisma.billingEvent.create({
              data: {
                billingId: billing.id,
                eventType: "MATCH_CREDIT_PURCHASED",
                stripeEventId: event.id,
                amount: session.amount_total ?? 250,
                currency: session.currency ?? "eur",
              },
            });
          }
        }
      }

      if (type === "extra_messages") {
        const matchId = session.metadata?.matchId;
        const side = session.metadata?.side;
        if (matchId && side) {
          await prisma.match.update({
            where: { id: matchId },
            data: side === "A" ? { extraMsgGrantedA: true } : { extraMsgGrantedB: true },
          });
        }
      }

      if (type === "tip") {
        const billing = await prisma.billing.findUnique({ where: { userId } });
        if (billing) {
          await prisma.billingEvent.create({
            data: {
              billingId: billing.id,
              eventType: "TIP_RECEIVED",
              stripeEventId: event.id,
              amount: session.amount_total ?? 0,
              currency: session.currency ?? "eur",
            },
          });
        }
      }

      if (type === "subscription" && session.subscription) {
        await prisma.billing.updateMany({
          where: { userId },
          data: {
            tier: "PREMIUM",
            stripeSubscriptionId: session.subscription as string,
            subscriptionStatus: "active",
          },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await prisma.billing.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { tier: "FREE", subscriptionStatus: "cancelled" },
      });
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
      await prisma.billing.updateMany({
        where: userId ? { userId } : { stripeSubscriptionId: sub.id },
        data: {
          ...(sub.status === "active" ? { tier: "PREMIUM" } : {}),
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
          subscriptionEndsAt: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : undefined,
        },
      });
      break;
    }

    // Mobile SDK: PaymentIntent confirmed in-app (credits & tips)
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const userId = pi.metadata?.userId;
      const type   = pi.metadata?.type;
      if (!userId) break;

      if (type === "credit") {
        // Idempotency guard — same as checkout.session.completed handler above
        const alreadyProcessed = await prisma.billingEvent.findUnique({
          where: { stripeEventId: event.id },
          select: { id: true },
        });
        if (!alreadyProcessed) {
          const billing = await prisma.billing.findUnique({ where: { userId } });
          if (billing) {
            await prisma.billing.updateMany({
              where: { userId },
              data: { purchasedCredits: { increment: 1 } },
            });
            await prisma.billingEvent.create({
              data: {
                billingId: billing.id,
                eventType: "MATCH_CREDIT_PURCHASED",
                stripeEventId: event.id,
                amount: pi.amount,
                currency: pi.currency,
              },
            });
          }
        }
      }

      if (type === "tip") {
        const billing = await prisma.billing.findUnique({ where: { userId } });
        if (billing) {
          await prisma.billingEvent.create({
            data: {
              billingId: billing.id,
              eventType: "TIP_RECEIVED",
              stripeEventId: event.id,
              amount: pi.amount,
              currency: pi.currency,
            },
          });
        }
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
