import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { stripe } from "@/lib/stripe/client";
import { prisma } from "@/lib/db/client";

const VALID_AMOUNTS = [1, 2, 5] as const;
type TipAmount = (typeof VALID_AMOUNTS)[number];

export async function POST(req: Request) {
  try {
    const session = await getRequiredSession();
    const { amount } = await req.json() as { amount?: number };

    if (!VALID_AMOUNTS.includes(amount as TipAmount)) {
      return NextResponse.json({ error: "Invalid tip amount. Must be 1, 2, or 5." }, { status: 400 });
    }

    const userId = session.user?.id as string;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { billing: true },
    });

    // Get or create Stripe customer
    let customerId = user?.billing?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user?.email ?? undefined,
        name: session.user?.name ?? undefined,
        metadata: { userId },
      });
      customerId = customer.id;
      await prisma.billing.upsert({
        where: { userId },
        create: { userId, stripeCustomerId: customerId },
        update: { stripeCustomerId: customerId },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://rally-orpin.vercel.app";

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      submit_type: "pay",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: (amount as number) * 100, // convert to cents
            product_data: {
              name: "Support Rendez ☕",
              description: "Optional contribution — keeps Rendez free and community-run in Cork.",
            },
          },
        },
      ],
      success_url: `${appUrl}/?tip=thank-you`,
      cancel_url: `${appUrl}/`,
      metadata: {
        userId,
        type: "tip",
        amount: String((amount as number) * 100),
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("[stripe/tip]", err);
    return NextResponse.json({ error: "Could not create checkout session." }, { status: 500 });
  }
}
