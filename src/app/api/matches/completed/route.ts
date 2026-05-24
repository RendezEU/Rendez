import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { in: ["COMPLETED", "CONNECTED"] },
    },
    include: {
      userA: { select: { id: true, name: true, profile: { select: { photos: true, allowShareCard: true } } } },
      userB: { select: { id: true, name: true, profile: { select: { photos: true, allowShareCard: true } } } },
      finalizedPlan: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Resolve activityIntent from the feed request that created this match (if any)
  const matchIds = matches.map((m) => m.id);
  const feedRequests = await prisma.feedMatchRequest.findMany({
    where: { matchId: { in: matchIds } },
    select: { matchId: true, activityPost: { select: { activityIntent: true } } },
  });
  const intentByMatchId = new Map(feedRequests.map((fr) => [fr.matchId, fr.activityPost.activityIntent]));

  return NextResponse.json(
    matches.map((m) => {
      const other = m.userAId === userId ? m.userB : m.userA;
      return {
        id: m.id,
        status: m.status,
        activityCategory: m.activityCategory,
        activityIntent: intentByMatchId.get(m.id) ?? null,
        otherUser: other,
        finalizedPlan: m.finalizedPlan,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    })
  );
}
