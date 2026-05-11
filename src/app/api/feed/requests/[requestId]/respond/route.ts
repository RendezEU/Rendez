import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";

const schema = z.object({ accept: z.boolean() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const userId = await getRequestUserId(req);
  const { requestId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const feedRequest = await prisma.feedMatchRequest.findUnique({
    where: { id: requestId },
    include: { activityPost: true, requester: { select: { name: true } } },
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
  const match = await prisma.match.create({
    data: {
      userAId: userId,
      userBId: feedRequest.requesterId,
      source: "FEED_REQUEST" as never,
      status: "COORDINATING" as never,
      activityCategory: feedRequest.activityPost.activityCategory,
      userADecision: true,
      userBDecision: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
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
      "You've been matched! Head to Matches to start planning your date.",
      { matchId: match.id, screen: "matches" }
    ),
    triggerUserEvent(feedRequest.requesterId, "new-match", {
      matchId: match.id,
      activityCategory: feedRequest.activityPost.activityCategory,
    }).catch(() => {}),
  ]);

  return NextResponse.json({ ok: true, matchId: match.id });
}
