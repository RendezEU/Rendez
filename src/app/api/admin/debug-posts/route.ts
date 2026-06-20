import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Get all real users + blocks
  const allUsers = await prisma.user.findMany({
    where: { email: { not: { contains: "rendez-fake" } } },
    select: { id: true, email: true },
    take: 20,
  });

  const blocks = await prisma.block.findMany({
    select: { blockerId: true, blockedId: true },
  });

  // For each real user: simulate what the public feed returns
  const feedSim: Record<string, string[]> = {};
  for (const viewer of allUsers) {
    const hiddenIds = blocks
      .filter((b) => b.blockerId === viewer.id || b.blockedId === viewer.id)
      .map((b) => (b.blockerId === viewer.id ? b.blockedId : b.blockerId));

    const visible = await prisma.activityPost.findMany({
      where: {
        isActive: true,
        isRendezEvent: false,
        expiresAt: { gt: now },
        userId: { not: viewer.id, ...(hiddenIds.length > 0 ? { notIn: hiddenIds } : {}) },
        city: { contains: "Cork", mode: "insensitive" },
      },
      select: { id: true, title: true, isSpontaneous: true, isFlexible: true, scheduledAt: true, user: { select: { email: true } } },
    });
    feedSim[viewer.email ?? viewer.id] = visible.map((p) => `"${p.title}" by ${p.user.email} [spon=${p.isSpontaneous} flex=${p.isFlexible} sched=${p.scheduledAt?.toISOString() ?? "null"}]`);
  }

  return NextResponse.json({ now: now.toISOString(), users: allUsers.map((u) => u.email), blocks: blocks.length, feedSim });

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
