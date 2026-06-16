import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;

  const post = await prisma.activityPost.findFirst({
    where: { id: activityId, isActive: true },
    include: {
      user: {
        select: {
          id: true, name: true,
          profile: {
            select: {
              gender: true, birthDate: true, city: true,
              preferredActivities: true, bio: true, intents: true, photoVerified: true,
              promptAnswers: { orderBy: { displayOrder: "asc" } },
              photos: { where: { isPrimary: true }, take: 1 },
            },
          },
        },
      },
      _count: { select: { matchRequests: true } },
    },
  });

  if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Check if requesting user already sent interest
  const myRequest = await prisma.feedMatchRequest.findUnique({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
    select: { id: true },
  });

  // Gender counts for open Rendez events (shown as men/women bar in detail screen)
  let maleCount: number | undefined;
  let femaleCount: number | undefined;
  let genderSlotMax: number | undefined;
  if (post.isRendezEvent && !post.genderRestriction && !post.isCouplesEvent) {
    type GenderRow = { gender: string | null; cnt: bigint };
    const rows = await prisma.$queryRaw<GenderRow[]>`
      SELECT pr."gender", COUNT(*)::bigint AS cnt
      FROM "FeedMatchRequest" r
      JOIN "Profile" pr ON pr."userId" = r."requesterId"
      WHERE r."activityPostId" = ${activityId}
        AND r."isWaitlist" = false
        AND pr."gender" IN ('MALE', 'FEMALE')
      GROUP BY pr."gender"
    `;
    maleCount = 0;
    femaleCount = 0;
    for (const row of rows) {
      if (row.gender === "MALE")   maleCount   = Number(row.cnt);
      if (row.gender === "FEMALE") femaleCount = Number(row.cnt);
    }
    genderSlotMax = Math.floor((post.maxParticipants ?? 12) / 2);
  }

  return NextResponse.json({
    id: post.id,
    activityCategory: post.activityCategory,
    activityIntent: post.activityIntent,
    title: post.title,
    description: post.description,
    city: post.city,
    scheduledAt: post.scheduledAt,
    locationName: post.locationName,
    locationLat: post.locationLat,
    locationLng: post.locationLng,
    isSpontaneous: post.isSpontaneous,
    isFlexible: post.isFlexible,
    isRecurring: post.isRecurring,
    isRendezEvent: post.isRendezEvent,
    genderRestriction: post.genderRestriction,
    isCouplesEvent: post.isCouplesEvent,
    recurringDayOfWeek: post.recurringDayOfWeek,
    maxParticipants: post.maxParticipants,
    createdAt: post.createdAt,
    creator: post.user,
    requestCount: post._count.matchRequests,
    isFull: post._count.matchRequests >= (post.maxParticipants ?? 1),
    myRequest: !!myRequest,
    maleCount,
    femaleCount,
    genderSlotMax,
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;

  // Check ownership first so we return 403 vs 404 correctly
  const post = await prisma.activityPost.findUnique({
    where: { id: activityId },
    select: { userId: true, isActive: true },
  });

  if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (post.userId !== userId) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (!post.isActive) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.activityPost.update({
    where: { id: activityId },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
