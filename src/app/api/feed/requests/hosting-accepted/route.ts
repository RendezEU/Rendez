import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const requests = await prisma.feedMatchRequest.findMany({
    where: {
      status: "ACCEPTED",
      activityPost: { userId },
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

  return NextResponse.json(
    requests.map((r) => ({
      activityPostId: r.activityPost.id,
      matchId: r.matchId ?? null,
      title: r.activityPost.title,
      category: r.activityPost.activityCategory,
      locationName: r.activityPost.locationName,
      scheduledAt: r.activityPost.scheduledAt,
      otherName: r.requester.name ?? "Someone",
      otherPhoto: r.requester.profile?.photos?.[0]?.url ?? null,
    }))
  );
}
