import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { sendPushToUser } from "@/lib/push/sendPush";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  // Lazy 24h auto-decline: any community-post interest that has been PENDING for
  // more than 24 hours without a host response is auto-declined right now, and
  // the requester is notified. This runs on every fetch so the user always sees
  // the correct state without waiting for a nightly cron.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.feedMatchRequest.findMany({
    where: {
      requesterId: userId,
      status: "PENDING",
      isWaitlist: false,
      activityPost: { isRendezEvent: false },
      createdAt: { lt: cutoff },
    },
    select: { id: true, activityPost: { select: { title: true } } },
  });
  if (stale.length > 0) {
    await prisma.feedMatchRequest.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data: { status: "DECLINED" },
    });
    for (const r of stale) {
      await sendPushToUser(
        userId,
        "Interest not accepted",
        `Your interest in "${r.activityPost.title}" wasn't accepted within 24 hours. Keep exploring the feed!`,
        { screen: "feed" }
      ).catch(() => {});
    }
  }

  const requests = await prisma.feedMatchRequest.findMany({
    where: {
      requesterId: userId,
      status: { in: ["PENDING", "ACCEPTED", "DECLINED"] },
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
