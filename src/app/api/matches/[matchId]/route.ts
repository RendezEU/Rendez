import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

async function autoTransitionMatch(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { finalizedPlan: true },
  });
  if (!match || !match.finalizedPlan) return;

  const now = new Date();
  const scheduledAt = new Date(match.finalizedPlan.scheduledAt);
  const hoursAfter = (now.getTime() - scheduledAt.getTime()) / (1000 * 60 * 60);

  if (match.status === "CONFIRMED" && hoursAfter >= 0) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "DATE_ACTIVE" } });
  } else if (match.status === "DATE_ACTIVE" && hoursAfter >= 4) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "COMPLETED" } });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;

  // Auto-transition status based on scheduled time before returning
  await autoTransitionMatch(matchId).catch(() => {});

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      userA: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true, availabilitySlots: { select: { dayOfWeek: true, timeBlock: true }, where: { isActive: true, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] } } } } } },
      userB: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true, availabilitySlots: { select: { dayOfWeek: true, timeBlock: true }, where: { isActive: true, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] } } } } } },
      finalizedPlan: true,
      systemActions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  return NextResponse.json(match);
}
