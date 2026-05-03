import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { z } from "zod";

const schema = z.object({ accept: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
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

  if (!accept) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "REJECTED" } });
  } else if (aDecided && bDecided && updated.userADecision && updated.userBDecision) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "COORDINATING" } });

    await prisma.billing.updateMany({
      where: { userId: match.userAId, freeCreditsRemaining: { gt: 0 } },
      data: { freeCreditsRemaining: { decrement: 1 } },
    });
    await prisma.billing.updateMany({
      where: { userId: match.userBId, freeCreditsRemaining: { gt: 0 } },
      data: { freeCreditsRemaining: { decrement: 1 } },
    });

    const otherId = isA ? match.userBId : match.userAId;
    await triggerUserEvent(otherId, "match-accepted", { matchId });
    await triggerUserEvent(userId, "match-accepted", { matchId });
  } else {
    await prisma.match.update({ where: { id: matchId }, data: { status: "PENDING_OTHER_DECISION" } });
  }

  return NextResponse.json({ ok: true });
}
