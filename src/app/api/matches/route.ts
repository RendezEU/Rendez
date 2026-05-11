import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
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
  // DATE_ACTIVE where scheduled time was 4+ hours ago → COMPLETED
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  await prisma.match.updateMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: "DATE_ACTIVE",
      finalizedPlan: { scheduledAt: { lte: fourHoursAgo } },
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
  const userId = await getRequestUserId(req);

  // Auto-transition statuses based on scheduled time
  await autoTransitionMatches(userId).catch(() => {});

  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { not: "EXPIRED" },
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

  // Compute unread count per match for this user
  const unreadCounts = await Promise.all(
    matches.map((m) =>
      prisma.message.count({
        where: { matchId: m.id, senderId: { not: userId }, readAt: null },
      })
    )
  );

  return NextResponse.json(
    matches.map((m, i) => ({ ...m, unreadCount: unreadCounts[i] }))
  );
}
