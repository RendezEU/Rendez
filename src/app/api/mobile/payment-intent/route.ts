import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { stripe } from "@/lib/stripe/client";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import Stripe from "stripe";

const schema = z.object({
  type: z.enum(["subscription", "credit", "tip"]),
  amount: z.number().int().positive().optional(), // cents, for tips only
});

const CREDIT_PRICE_CENTS  =  250; // €2.50
const VALID_TIP_CENTS = [100, 200, 500] as const; // €1, €2, €5

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { type, amount } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, billing: true },
  });

  // Get or create Stripe customer
  let customerId = user?.billing?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user?.email ?? undefined,
      name: user?.name ?? undefined,
      metadata: { userId },
    });
    customerId = customer.id;
    await prisma.billing.upsert({
      where: { userId },
      create: { userId, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  // Subscriptions need a SetupIntent approach via Stripe's payment sheet
  // For simplicity we use PaymentIntent for one-off and a subscription creation for premium
  if (type === "subscription") {
    // Create a subscription with payment_behavior=default_incomplete so we get
    // a PaymentIntent client secret to confirm in the app
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: process.env.STRIPE_PREMIUM_PRICE_ID! }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: { userId, type: "subscription" },
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice & {
      payment_intent: Stripe.PaymentIntent;
    };
    const pi = invoice?.payment_intent;

    return NextResponse.json({
      clientSecret: pi?.client_secret,
      customerId,
      subscriptionId: subscription.id,
    });
  }

  if (type === "credit") {
    const pi = await stripe.paymentIntents.create({
      amount: CREDIT_PRICE_CENTS,
      currency: "eur",
      customer: customerId,
      setup_future_usage: "off_session",
      metadata: { userId, type: "credit" },
    });
    return NextResponse.json({ clientSecret: pi.client_secret, customerId });
  }

  if (type === "tip") {
    if (!amount || !(VALID_TIP_CENTS as readonly number[]).includes(amount)) {
      return NextResponse.json({ error: "Invalid tip amount." }, { status: 400 });
    }
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "eur",
      customer: customerId,
      metadata: { userId, type: "tip" },
    });
    return NextResponse.json({ clientSecret: pi.client_secret, customerId });
  }

  return NextResponse.json({ error: "Invalid type." }, { status: 400 });
}
