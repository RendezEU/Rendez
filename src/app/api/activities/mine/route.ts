import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);

  const posts = await prisma.activityPost.findMany({
    where: { userId, isActive: true },
    orderBy: { scheduledAt: "asc" },
    include: { _count: { select: { matchRequests: true } } },
  });

  return NextResponse.json(
    posts.map((p) => ({
      id: p.id,
      activityCategory: p.activityCategory,
      title: p.title,
      description: p.description,
      city: p.city,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      locationName: p.locationName,
      createdAt: p.createdAt.toISOString(),
      isPast: p.scheduledAt ? p.scheduledAt < new Date() : false,
      requestCount: p._count.matchRequests,
    }))
  );
}

