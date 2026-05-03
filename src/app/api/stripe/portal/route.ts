import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { stripe } from "@/lib/stripe/client";
import { prisma } from "@/lib/db/client";

export async function POST() {
  const session = await getRequiredSession();
  const billing = await prisma.billing.findUnique({ where: { userId: session.user?.id as string } });

  if (!billing?.stripeCustomerId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`);
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  });

  return NextResponse.redirect(portal.url);
}
