import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
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
  } else if (match.status === "DATE_ACTIVE" && hoursAfter >= 3) {
    await prisma.match.update({ where: { id: matchId }, data: { status: "COMPLETED" } });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;

  // Auto-transition status based on scheduled time before returning
  await autoTransitionMatch(matchId).catch(() => {});

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      userA: { select: { id: true, name: true, availabilitySlots: { select: { dayOfWeek: true, timeBlock: true }, where: { isActive: true, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] } }, profile: { include: { photos: true, promptAnswers: true } } } },
      userB: { select: { id: true, name: true, availabilitySlots: { select: { dayOfWeek: true, timeBlock: true }, where: { isActive: true, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] } }, profile: { include: { photos: true, promptAnswers: true } } } },
      finalizedPlan: true,
      systemActions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Mobile reads availabilitySlots under profile (e.g. userA.profile.availabilitySlots)
  // but Prisma returns it as a sibling of profile. Nest it here so the shape matches.
  function nestSlots<T extends { availabilitySlots: unknown; profile: Record<string, unknown> | null }>(u: T) {
    const { availabilitySlots, profile, ...rest } = u;
    return { ...rest, profile: profile ? { ...profile, availabilitySlots } : null };
  }

  return NextResponse.json({ ...match, userA: nestSlots(match.userA), userB: nestSlots(match.userB) });
}
