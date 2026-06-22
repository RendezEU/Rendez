import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

// GET — returns upcoming committed event times for both match participants.
// Used by the time-proposal UI so users can see busy slots as a scheduling guide.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { userAId: true, userBId: true },
  });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const otherId = match.userAId === userId ? match.userBId : match.userAId;
  const now = new Date();

  async function getBusyTimes(uid: string) {
    // Committed Rendez events: joined, not waitlisted, not declined, with a future scheduled time
    const rendezJoins = await prisma.feedMatchRequest.findMany({
      where: {
        requesterId: uid,
        isWaitlist: false,
        status: { not: "DECLINED" },
        activityPost: {
          scheduledAt: { gt: now },
          isRendezEvent: true,
        },
      },
      select: { activityPost: { select: { scheduledAt: true } } },
    });

    // Confirmed 1:1 plans (FinalizedPlan linked via Match where user is participant)
    const finalizedPlans = await prisma.finalizedPlan.findMany({
      where: {
        scheduledAt: { gt: now },
        match: { OR: [{ userAId: uid }, { userBId: uid }] },
      },
      select: { scheduledAt: true },
    });

    const times: string[] = [
      ...rendezJoins.map((r) => r.activityPost.scheduledAt!.toISOString()),
      ...finalizedPlans.map((p) => p.scheduledAt.toISOString()),
    ];
    return times;
  }

  const [mine, theirs] = await Promise.all([getBusyTimes(userId), getBusyTimes(otherId)]);

  return NextResponse.json({ mine, theirs });
}
