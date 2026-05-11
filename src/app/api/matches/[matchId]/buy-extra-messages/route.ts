import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { stripe } from "@/lib/stripe/client";

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isA = match.userAId === userId;
  const isB = match.userBId === userId;
  if (!isA && !isB) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const alreadyGranted = isA ? match.extraMsgGrantedA : match.extraMsgGrantedB;
  if (alreadyGranted) {
    return NextResponse.json({ error: "ALREADY_PURCHASED" }, { status: 409 });
  }

  // Ensure the user has a Stripe customer record
  let billing = await prisma.billing.findUnique({ where: { userId } });
  let customerId = billing?.stripeCustomerId;

  if (!customerId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
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
    line_items: [{ price: process.env.STRIPE_EXTRA_MSG_PRICE_ID!, quantity: 1 }],
    success_url: `${appUrl}/payment-success?type=extra_messages&matchId=${matchId}`,
    cancel_url: `${appUrl}/payment-cancel`,
    metadata: { userId, type: "extra_messages", matchId, side: isA ? "A" : "B" },
  });

  return NextResponse.json({ url: session.url });
}
