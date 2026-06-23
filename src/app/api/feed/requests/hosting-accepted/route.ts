import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  // Collect IDs of matches that are no longer active so we can exclude their
  // linked FeedMatchRequests. FeedMatchRequest has no explicit Prisma relation
  // to Match, so we filter by matchId instead of by relation.
  const terminalMatches = await prisma.match.findMany({
    where: { status: { in: ["COMPLETED", "CONNECTED", "EXPIRED"] } },
    select: { id: true },
  });
  const terminalIds = terminalMatches.map((m) => m.id);

  const requests = await prisma.feedMatchRequest.findMany({
    where: {
      status: "ACCEPTED",
      activityPost: { userId },
      // Only surface requests for active matches
      OR: [
        { matchId: null },
        { matchId: { notIn: terminalIds } },
      ],
    },
    include: {
      activityPost: {
        select: {
          id: true,
          title: true,
          activityCategory: true,
          locationName: true,
          scheduledAt: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
          profile: {
            select: {
              photos: { select: { url: true }, orderBy: { order: "asc" }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // For flexible activities, use the FinalizedPlan's agreed time/location if set.
  const matchIds = requests.map((r) => r.matchId).filter(Boolean) as string[];
  const plans = matchIds.length
    ? await prisma.finalizedPlan.findMany({
        where: { matchId: { in: matchIds } },
        select: { matchId: true, scheduledAt: true, locationName: true },
      })
    : [];
  const planByMatchId = new Map(plans.map((p) => [p.matchId, p]));

  return NextResponse.json(
    requests.map((r) => {
      const plan = r.matchId ? planByMatchId.get(r.matchId) : undefined;
      return {
        activityPostId: r.activityPost.id,
        matchId: r.matchId ?? null,
        title: r.activityPost.title,
        category: r.activityPost.activityCategory,
        locationName: plan?.locationName ?? r.activityPost.locationName,
        scheduledAt: plan?.scheduledAt?.toISOString() ?? r.activityPost.scheduledAt,
        otherName: r.requester.name ?? "Someone",
        otherPhoto: r.requester.profile?.photos?.[0]?.url ?? null,
      };
    })
  );
}
