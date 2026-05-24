import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { stripe } from "@/lib/stripe/client";

/**
 * POST /api/billing/buy-credit
 * Mobile-facing endpoint — returns a Stripe Checkout URL for a single
 * Rendez credit (€2.50). The app opens the URL in a browser via Linking.
 * On success Stripe webhook increments purchasedCredits via the
 * checkout.session.completed → type:"match_pack" handler.
 */
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  // Ensure a billing record + Stripe customer exist
  let billing = await prisma.billing.findUnique({ where: { userId } });
  let customerId = billing?.stripeCustomerId;

  if (!customerId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const customer = await stripe.customers.create({
      email: user?.email ?? undefined,
      name: user?.name ?? undefined,
      metadata: { userId },
    });
    customerId = customer.id;
    billing = await prisma.billing.upsert({
      where: { userId },
      create: { userId, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [{ price: process.env.STRIPE_MATCH_PACK_PRICE_ID!, quantity: 1 }],
    success_url: `${appUrl}/payment-success?type=match_pack`,
    cancel_url:  `${appUrl}/payment-cancel`,
    metadata: { userId, type: "match_pack" },
  });

  return NextResponse.json({ url: session.url });
}
