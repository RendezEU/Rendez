import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
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
    include: { activityPost: true },
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

  return NextResponse.json({ ok: true, matchId: match.id });
}
