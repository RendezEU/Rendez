import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { activityId } = await params;

  const requests = await prisma.feedMatchRequest.findMany({
    where: { activityPostId: activityId, isWaitlist: false },
    include: {
      requester: {
        select: {
          id: true,
          name: true,
          profile: {
            select: {
              photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    requests.map((r) => ({
      id: r.requester.id,
      name: r.requester.name,
      photo: r.requester.profile?.photos?.[0]?.url ?? null,
    }))
  );
}
