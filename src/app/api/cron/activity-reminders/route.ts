import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { sendPushToUser } from "@/lib/push/sendPush";

function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in2h  = new Date(now.getTime() +  2 * 60 * 60 * 1000);

  // Confirmed matches happening in ~24h (between 23h and 25h from now)
  const upcoming24 = await prisma.match.findMany({
    where: {
      status: "CONFIRMED",
      finalizedPlan: {
        scheduledAt: { gte: new Date(in24h.getTime() - 60 * 60 * 1000), lte: new Date(in24h.getTime() + 60 * 60 * 1000) },
      },
    },
    include: {
      finalizedPlan: true,
      userA: { select: { id: true, name: true } },
      userB: { select: { id: true, name: true } },
    },
  });

  for (const m of upcoming24) {
    const loc = m.finalizedPlan?.locationName ? ` at ${m.finalizedPlan.locationName}` : "";
    await sendPushToUser(m.userAId, "Your date is tomorrow! 📅", `Reminder: you're meeting ${m.userB.name}${loc} tomorrow.`, { matchId: m.id, screen: "matches" });
    await sendPushToUser(m.userBId, "Your date is tomorrow! 📅", `Reminder: you're meeting ${m.userA.name}${loc} tomorrow.`, { matchId: m.id, screen: "matches" });
  }

  // Confirmed matches happening in ~2h (between 1h50m and 2h10m from now)
  const upcoming2h = await prisma.match.findMany({
    where: {
      status: "CONFIRMED",
      finalizedPlan: {
        scheduledAt: { gte: new Date(in2h.getTime() - 10 * 60 * 1000), lte: new Date(in2h.getTime() + 10 * 60 * 1000) },
      },
    },
    include: {
      finalizedPlan: true,
      userA: { select: { id: true, name: true } },
      userB: { select: { id: true, name: true } },
    },
  });

  for (const m of upcoming2h) {
    const loc = m.finalizedPlan?.locationName ? ` at ${m.finalizedPlan.locationName}` : "";
    await sendPushToUser(m.userAId, "Your date is in 2 hours! ⏰", `Get ready — you're meeting ${m.userB.name}${loc} soon!`, { matchId: m.id, screen: "matches" });
    await sendPushToUser(m.userBId, "Your date is in 2 hours! ⏰", `Get ready — you're meeting ${m.userA.name}${loc} soon!`, { matchId: m.id, screen: "matches" });
  }

  // Activity posts whose scheduledAt is in 24h — notify the creator
  const upcomingPosts = await prisma.activityPost.findMany({
    where: {
      isActive: true,
      scheduledAt: { gte: new Date(in24h.getTime() - 60 * 60 * 1000), lte: new Date(in24h.getTime() + 60 * 60 * 1000) },
    },
    include: { user: { select: { id: true } }, _count: { select: { matchRequests: true } } },
  });

  for (const p of upcomingPosts) {
    const interested = p._count.matchRequests;
    const msg = interested > 0
      ? `Your "${p.title}" is tomorrow — ${interested} ${interested === 1 ? "person is" : "people are"} interested!`
      : `Your "${p.title}" is tomorrow. Time to get ready!`;
    await sendPushToUser(p.user.id, "Activity reminder 🎯", msg, { screen: "feed" });
  }

  return NextResponse.json({
    reminded24h: upcoming24.length,
    reminded2h: upcoming2h.length,
    activityReminders: upcomingPosts.length,
  });
}
