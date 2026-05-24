import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";

const schema = z.object({ accept: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isA = match.userAId === userId;
  const isB = match.userBId === userId;
  if (!isA && !isB) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { accept } = parsed.data;

  const updateData: Record<string, unknown> = isA
    ? { userADecision: accept, userADecidedAt: new Date() }
    : { userBDecision: accept, userBDecidedAt: new Date() };

  const updated = await prisma.match.update({ where: { id: matchId }, data: updateData });

  const aDecided = updated.userADecision !== null;
  const bDecided = updated.userBDecision !== null;

  const otherId = isA ? match.userBId : match.userAId;

  if (!accept) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "REJECTED" } });
  } else if (aDecided && bDecided && updated.userADecision && updated.userBDecision) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "COORDINATING" } });

    await triggerUserEvent(otherId, "match-accepted", { matchId });
    await triggerUserEvent(userId, "match-accepted", { matchId });

    // Both accepted — notify both. Credits are NOT consumed here;
    // they are consumed at CONFIRM_PLAN when the Rendez is actually locked in.
    await sendPushToUser(otherId, "It's a Rendez! 🎉", "You're both in — start planning your Rendez!", { matchId, screen: "matches" });
    await sendPushToUser(userId,  "It's a Rendez! 🎉", "You're both in — start planning your Rendez!", { matchId, screen: "matches" });
  } else {
    await prisma.match.update({ where: { id: matchId }, data: { status: "PENDING_OTHER_DECISION" } });
    // Notify the other person that this user has decided — nudge them to respond
    await sendPushToUser(otherId, "Someone responded to your match 💛", "Check your matches and make your decision!", { matchId, screen: "matches" });
  }

  return NextResponse.json({ ok: true });
}
