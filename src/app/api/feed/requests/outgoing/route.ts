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
    },
    include: {
      activityPost: {
        select: {
          id: true,
          activityCategory: true,
          title: true,
          activityIntent: true,
          maxParticipants: true,
          locationName: true,
          scheduledAt: true,
          userId: true,
          user: {
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
        activityIntent: r.activityPost.activityIntent,
        maxParticipants: r.activityPost.maxParticipants,
        locationName: r.activityPost.locationName,
        scheduledAt: r.activityPost.scheduledAt,
      },
      host: {
        id: r.activityPost.user.id,
        name: r.activityPost.user.name,
        profile: r.activityPost.user.profile,
      },
    }))
  );
}
