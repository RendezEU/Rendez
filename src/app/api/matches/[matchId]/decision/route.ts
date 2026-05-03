import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { z } from "zod";

const schema = z.object({ accept: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const session = await getRequiredSession();
  const { matchId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isA = match.userAId === session.user.id;
  const isB = match.userBId === session.user.id;
  if (!isA && !isB) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { accept } = parsed.data;

  const updateData: Record<string, unknown> = isA
    ? { userADecision: accept, userADecidedAt: new Date() }
    : { userBDecision: accept, userBDecidedAt: new Date() };

  const updated = await prisma.match.update({ where: { id: matchId }, data: updateData });

  const aDecided = updated.userADecision !== null;
  const bDecided = updated.userBDecision !== null;

  if (!accept) {
    // One rejection → rejected
    await prisma.match.update({ where: { id: matchId }, data: { status: "REJECTED" } });

    // Return credit if it was reserved
    await prisma.billing.updateMany({
      where: { userId: session.user.id },
      data: { freeCreditsRemaining: { increment: 0 } }, // credits are consumed only on mutual accept
    });
  } else if (aDecided && bDecided && updated.userADecision && updated.userBDecision) {
    // Both accepted → coordinating
    await prisma.match.update({ where: { id: matchId }, data: { status: "COORDINATING" } });

    // Consume one credit from each user
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
    await triggerUserEvent(session.user.id, "match-accepted", { matchId });
  } else {
    // One accepted, waiting for other
    await prisma.match.update({ where: { id: matchId }, data: { status: "PENDING_OTHER_DECISION" } });
  }

  return NextResponse.json({ ok: true });
}
