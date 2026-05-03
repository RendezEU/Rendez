import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { stripe } from "@/lib/stripe/client";
import { prisma } from "@/lib/db/client";

export async function POST(req: Request) {
  const session = await getRequiredSession();
  const formData = await req.formData();
  const type = formData.get("type") as string;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { billing: true },
  });

  let customerId = user?.billing?.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      name: session.user.name ?? undefined,
      metadata: { userId: session.user.id },
    });
    customerId = customer.id;
    await prisma.billing.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (type === "subscription") {
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PREMIUM_PRICE_ID!, quantity: 1 }],
      success_url: `${appUrl}/settings/billing?success=1`,
      cancel_url: `${appUrl}/settings/billing`,
      metadata: { userId: session.user.id, type: "subscription" },
    });
    return NextResponse.redirect(checkoutSession.url!);
  }

  if (type === "match_pack") {
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_MATCH_PACK_PRICE_ID!, quantity: 1 }],
      success_url: `${appUrl}/settings/billing?success=1`,
      cancel_url: `${appUrl}/settings/billing`,
      metadata: { userId: session.user.id, type: "match_pack" },
    });
    return NextResponse.redirect(checkoutSession.url!);
  }

  return NextResponse.json({ error: "Invalid type." }, { status: 400 });
}
