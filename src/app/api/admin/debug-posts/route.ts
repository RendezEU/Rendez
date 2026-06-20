import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Check all blocks between real test users
  const blocks = await prisma.block.findMany({
    include: {
      blocker: { select: { email: true } },
      blocked: { select: { email: true } },
    },
  });

  // Simulate what the public feed returns for each test user
  const testEmails = ["kbeyza94@gmail.com", "icihanozyurt@gmail.com", "kbeyza94@outlook.com", "ibrahim.cihan.ozyurt@gmail.com"];
  const testUsers = await prisma.user.findMany({
    where: { email: { in: testEmails } },
    select: { id: true, email: true },
  });

  const feedSim: Record<string, string[]> = {};
  for (const viewer of testUsers) {
    const blockedByMe = await prisma.block.findMany({ where: { blockerId: viewer.id }, select: { blockedId: true } });
    const blockedMe = await prisma.block.findMany({ where: { blockedId: viewer.id }, select: { blockerId: true } });
    const hiddenIds = [...blockedByMe.map((b) => b.blockedId), ...blockedMe.map((b) => b.blockerId)];
    const visible = await prisma.activityPost.findMany({
      where: {
        isActive: true,
        isRendezEvent: false,
        expiresAt: { gt: now },
        userId: { not: viewer.id, notIn: hiddenIds.length > 0 ? hiddenIds : undefined },
        city: { contains: "Cork", mode: "insensitive" },
      },
      select: { id: true, title: true, user: { select: { email: true } } },
    });
    feedSim[viewer.email!] = visible.map((p) => `${p.title} (by ${p.user.email})`);
  }

  return NextResponse.json({ now: now.toISOString(), blocks: blocks.map((b) => `${b.blocker.email} → ${b.blocked.email}`), feedSim });

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
