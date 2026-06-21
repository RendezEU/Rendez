import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const posts = await prisma.activityPost.findMany({
    where: { userId, isActive: true },
    orderBy: { scheduledAt: "asc" },
    include: {
      _count: { select: { matchRequests: true } },
      matchRequests: { where: { status: "ACCEPTED", isWaitlist: false }, select: { id: true } },
    },
  });

  return NextResponse.json(
    posts.map((p) => ({
      id: p.id,
      activityCategory: p.activityCategory,
      activityIntent: p.activityIntent,
      title: p.title,
      description: p.description,
      city: p.city,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      locationName: p.locationName,
      locationLat: p.locationLat,
      locationLng: p.locationLng,
      isSpontaneous: p.isSpontaneous,
      isFlexible: p.isFlexible,
      isRecurring: p.isRecurring,
      recurringDayOfWeek: p.recurringDayOfWeek,
      maxParticipants: p.maxParticipants,
      createdAt: p.createdAt.toISOString(),
      isPast: p.scheduledAt ? p.scheduledAt < new Date() : false,
      requestCount: p._count.matchRequests,
      isFull: p.matchRequests.length >= (p.maxParticipants ?? 1),
      myRequest: false, // it's the user's own post
    }))
  );
}

