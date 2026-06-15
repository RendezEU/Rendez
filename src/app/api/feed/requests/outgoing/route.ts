import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const requests = await prisma.feedMatchRequest.findMany({
    where: {
      requesterId: userId,
      status: { in: ["PENDING", "ACCEPTED"] },
      // Rendez event joins are confirmed automatically — they live on the Home tab, not here
      activityPost: { isRendezEvent: false },
    },
    include: {
      activityPost: {
        select: {
          id: true,
          activityCategory: true,
          title: true,
          description: true,
          activityIntent: true,
          maxParticipants: true,
          locationName: true,
          scheduledAt: true,
          isRecurring: true,
          recurringDayOfWeek: true,
          isFlexible: true,
          isSpontaneous: true,
          isRendezEvent: true,
          userId: true,
          user: {
            select: {
              id: true,
              name: true,
              profile: {
                select: {
                  birthDate: true,
                  city: true,
                  gender: true,
                  photos: { select: { url: true }, orderBy: { order: "asc" }, take: 1 },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    requests.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      activityPost: {
        id: r.activityPost.id,
        activityCategory: r.activityPost.activityCategory,
        title: r.activityPost.title,
        description: r.activityPost.description,
        activityIntent: r.activityPost.activityIntent,
        maxParticipants: r.activityPost.maxParticipants,
        locationName: r.activityPost.locationName,
        scheduledAt: r.activityPost.scheduledAt,
        isRecurring: r.activityPost.isRecurring,
        recurringDayOfWeek: r.activityPost.recurringDayOfWeek,
        isFlexible: r.activityPost.isFlexible,
        isSpontaneous: r.activityPost.isSpontaneous,
        isRendezEvent: r.activityPost.isRendezEvent,
      },
      host: {
        id: r.activityPost.user.id,
        name: r.activityPost.user.name ?? "Unknown",
        profile: r.activityPost.user.profile,
      },
    }))
  );
}
