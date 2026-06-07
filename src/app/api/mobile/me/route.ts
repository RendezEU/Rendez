import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { verifyMobileToken, extractBearerToken } from "@/lib/auth/mobile";
import { stripe } from "@/lib/stripe/client";
import { z } from "zod";

const patchSchema = z.object({
  allowShareCard: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const token = extractBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const userId = await verifyMobileToken(token);
    if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const [user, datesCompleted] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: { include: { photos: true, promptAnswers: true } },
          billing: true,
          reputation: true,
          availabilitySlots: true,
        },
      }),
      prisma.match.count({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
          status: { in: ["COMPLETED", "CONNECTED"] },
        },
      }),
    ]);

    if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      onboardingComplete: user.onboardingComplete,
      tier: user.billing?.tier ?? "FREE",
      matchCredits: (user.billing?.freeCreditsRemaining ?? 0) + (user.billing?.purchasedCredits ?? 0),
      profile: user.profile,
      reputation: user.reputation,
      availabilitySlots: user.availabilitySlots,
      datesCompleted,
      allowShareCard: user.profile?.allowShareCard ?? true,
    });
  } catch (err) {
    console.error("[me:GET]", err);
    return NextResponse.json({ error: "Failed to load profile. Please try again." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const token = extractBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const userId = await verifyMobileToken(token);
    if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data." }, { status: 400 });

    const { allowShareCard } = parsed.data;
    if (allowShareCard !== undefined) {
      await prisma.profile.update({
        where: { userId },
        data: { allowShareCard },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[me:PATCH]", err);
    return NextResponse.json({ error: "Update failed. Please try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const token = extractBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const userId = await verifyMobileToken(token);
    if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    // 1. Cancel active Stripe subscription so the customer isn't billed again
    const billing = await prisma.billing.findUnique({ where: { userId } });
    if (billing?.stripeSubscriptionId && billing.subscriptionStatus === "active") {
      try {
        await stripe.subscriptions.cancel(billing.stripeSubscriptionId);
      } catch {
        // Non-fatal — proceed with deletion even if Stripe call fails
      }
    }

    // 2. Collect IDs needed for manual cleanup
    const [matches, billingRecord] = await Promise.all([
      prisma.match.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { id: true },
      }),
      prisma.billing.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    const matchIds = matches.map((m) => m.id);

    // 3. Delete rows that have no onDelete:Cascade from User or Match
    await prisma.$transaction([
      prisma.matchCreditConsumption.deleteMany({
        where: { OR: [
          { matchId: { in: matchIds } },
          ...(billingRecord ? [{ billingId: billingRecord.id }] : []),
        ]},
      }),
      ...(billingRecord
        ? [prisma.billingEvent.deleteMany({ where: { billingId: billingRecord.id } })]
        : []),
      prisma.feedMatchRequest.deleteMany({ where: { requesterId: userId } }),
      prisma.reputationEvent.deleteMany({ where: { userId } }),
      prisma.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
      prisma.report.deleteMany({ where: { reporterId: userId } }),
    ]);

    // 4. Delete matches — cascades: Message, SystemAction, FinalizedPlan, PostDateDecision
    if (matchIds.length > 0) {
      await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    }

    // 5. Delete the User — Prisma cascades: Profile (→PromptAnswers, Photos), Account,
    //    Session, AvailabilitySlot, Billing, Reputation, PushToken, ActivityPost
    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[me:DELETE]", err);
    return NextResponse.json({ error: "Account deletion failed. Please contact support." }, { status: 500 });
  }
}
