import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

import { prisma } from "@/lib/db/client";

async function autoTransitionMatches(userId: string) {
  const now = new Date();
  // CONFIRMED with scheduled time in the past → DATE_ACTIVE
  await prisma.match.updateMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: "CONFIRMED",
      finalizedPlan: { scheduledAt: { lte: now } },
    },
    data: { status: "DATE_ACTIVE" },
  });
  // DATE_ACTIVE where scheduled time was 3+ hours ago → COMPLETED
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  await prisma.match.updateMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: "DATE_ACTIVE",
      finalizedPlan: { scheduledAt: { lte: threeHoursAgo } },
    },
    data: { status: "COMPLETED" },
  });
  // PENDING matches past their expiresAt → EXPIRED
  await prisma.match.updateMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { in: ["PENDING_BOTH_DECISIONS", "PENDING_OTHER_DECISION"] },
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  // Auto-transition statuses based on scheduled time
  await autoTransitionMatches(userId).catch((e) => console.error("[autoTransition]", e));

  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      // Exclude terminal statuses — COMPLETED matches live in diary, EXPIRED ones are dead
      status: { notIn: ["EXPIRED", "COMPLETED"] },
    },
    include: {
      userA: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true } } } },
      userB: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true } } } },
      finalizedPlan: true,
      messages: { orderBy: { createdAt: "asc" } },
      systemActions: { orderBy: { createdAt: "asc" } },
      _count: {
        select: {
          messages: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Compute unread counts in a single grouped query instead of one per match
  const unreadRows = await prisma.message.groupBy({
    by: ["matchId"],
    where: {
      matchId: { in: matches.map((m) => m.id) },
      senderId: { not: userId },
      readAt: null,
    },
    _count: { matchId: true },
  });
  const unreadMap = new Map(unreadRows.map((r) => [r.matchId, r._count.matchId]));

  return NextResponse.json(
    matches.map((m) => ({ ...m, unreadCount: unreadMap.get(m.id) ?? 0 }))
  );
}
