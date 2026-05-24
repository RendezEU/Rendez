import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";

const schema = z.object({ accept: z.boolean() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { requestId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const feedRequest = await prisma.feedMatchRequest.findUnique({
    where: { id: requestId },
    include: {
      activityPost: { select: { id: true, userId: true, title: true, activityCategory: true, scheduledAt: true, locationName: true } },
      requester: { select: { name: true } },
    },
  });
  if (!feedRequest) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (feedRequest.activityPost.userId !== userId)
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (feedRequest.status !== "PENDING")
    return NextResponse.json({ error: "Already responded." }, { status: 409 });

  const { accept } = parsed.data;

  if (!accept) {
    await prisma.feedMatchRequest.update({
      where: { id: requestId },
      data: { status: "DECLINED" },
    });
    // Notify requester so they're not left in limbo
    await sendPushToUser(
      feedRequest.requesterId,
      "Interest not accepted",
      `Your interest in "${feedRequest.activityPost.title}" wasn't a match this time. Keep exploring the feed!`,
      { screen: "feed" }
    );
    return NextResponse.json({ ok: true });
  }

  // Prevent duplicate active matches between the same pair
  const existingMatch = await prisma.match.findFirst({
    where: {
      OR: [
        { userAId: userId, userBId: feedRequest.requesterId },
        { userAId: feedRequest.requesterId, userBId: userId },
      ],
      status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"] },
    },
  });
  if (existingMatch) {
    await prisma.feedMatchRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED", matchId: existingMatch.id } });
    return NextResponse.json({ ok: true, matchId: existingMatch.id });
  }

  // Create a COORDINATING match — both sides have agreed
  const post = feedRequest.activityPost;
  const hasPresetTime = !!post.scheduledAt;

  // ── Credit gate for pre-scheduled activities ──────────────────────────────
  // When an activity has a fixed time the match is immediately CONFIRMED,
  // so we consume a credit here (same as CONFIRM_PLAN does for flexible ones).
  if (hasPresetTime) {
    const billing = await prisma.billing.findUnique({ where: { userId } });
    const isPremium = billing?.tier === "PREMIUM";
    if (!isPremium) {
      const freeLeft = billing?.freeCreditsRemaining ?? 0;
      const paidLeft = billing?.purchasedCredits ?? 0;
      if (freeLeft + paidLeft <= 0) {
        return NextResponse.json(
          { error: "NO_CREDITS", message: "You need a Rendez credit to confirm this match." },
          { status: 402 }
        );
      }
      if (freeLeft > 0) {
        await prisma.billing.update({ where: { userId }, data: { freeCreditsRemaining: { decrement: 1 } } });
      } else {
        await prisma.billing.update({ where: { userId }, data: { purchasedCredits: { decrement: 1 } } });
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const match = await prisma.match.create({
    data: {
      userAId: userId,
      userBId: feedRequest.requesterId,
      source: "FEED_REQUEST" as never,
      // If the activity already had a fixed time, skip straight to CONFIRMED
      status: (hasPresetTime ? "CONFIRMED" : "COORDINATING") as never,
      activityCategory: post.activityCategory,
      userADecision: true,
      userBDecision: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      // Auto-create the finalized plan from the activity post's schedule
      ...(hasPresetTime && {
        finalizedPlan: {
          create: {
            scheduledAt: post.scheduledAt!,
            locationName: post.locationName ?? "",

            activityCategory: post.activityCategory,
          },
        },
      }),
    },
  });

  await prisma.feedMatchRequest.update({
    where: { id: requestId },
    data: { status: "ACCEPTED", matchId: match.id },
  });

  const ownerName = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  // Push notification + real-time Pusher event to the requester
  await Promise.all([
    sendPushToUser(
      feedRequest.requesterId,
      `${ownerName?.name ?? "Someone"} accepted your interest 🎉`,
      "You're connected! Head to Matches to start planning your Rendez.",
      { matchId: match.id, screen: "matches" }
    ),
    triggerUserEvent(feedRequest.requesterId, "new-match", {
      matchId: match.id,
      activityCategory: feedRequest.activityPost.activityCategory,
    }).catch(() => {}),
  ]);

  return NextResponse.json({ ok: true, matchId: match.id });
}
