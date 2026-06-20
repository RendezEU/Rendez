import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const posts = await prisma.activityPost.findMany({
    where: { isRendezEvent: false },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      title: true,
      city: true,
      isActive: true,
      isSpontaneous: true,
      isFlexible: true,
      isRecurring: true,
      scheduledAt: true,
      expiresAt: true,
      maxParticipants: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
      _count: { select: { matchRequests: true } },
    },
  });

  return NextResponse.json({
    now: now.toISOString(),
    count: posts.length,
    posts: posts.map((p) => ({
      id: p.id,
      title: p.title,
      city: p.city,
      creator: p.user.email,
      isActive: p.isActive,
      isSpontaneous: p.isSpontaneous,
      isFlexible: p.isFlexible,
      isRecurring: p.isRecurring,
      maxParticipants: p.maxParticipants,
      matchRequests: p._count.matchRequests,
      isFull: p._count.matchRequests >= (p.maxParticipants ?? 1),
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      isExpired: p.expiresAt ? p.expiresAt < now : false,
      scheduledPast: p.scheduledAt ? p.scheduledAt < now : false,
    })),
  });
}
