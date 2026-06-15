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
    await sendPushToUser(m.userAId, "Your Rendez is tomorrow! 📅", `Your Rendez with ${m.userB.name}${loc} is tomorrow — get ready!`, { matchId: m.id, screen: "matches" });
    await sendPushToUser(m.userBId, "Your Rendez is tomorrow! 📅", `Your Rendez with ${m.userA.name}${loc} is tomorrow — get ready!`, { matchId: m.id, screen: "matches" });
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
    await sendPushToUser(m.userAId, "Your Rendez is in 2 hours! ⏰", `Your Rendez with ${m.userB.name}${loc} is coming up — see you there!`, { matchId: m.id, screen: "matches" });
    await sendPushToUser(m.userBId, "Your Rendez is in 2 hours! ⏰", `Your Rendez with ${m.userA.name}${loc} is coming up — see you there!`, { matchId: m.id, screen: "matches" });
  }

  // ── Mid-event photo nudge ─────────────────────────────────────────────────
  // Window: 50–70 min after scheduledAt. A cron running every 30 min hits this
  // exactly once per event — no DB flag needed.
  const midEventStart = new Date(now.getTime() - 70 * 60 * 1000);
  const midEventEnd   = new Date(now.getTime() - 50 * 60 * 1000);

  let photoNudgeCount = 0;

  // 1) Rendez group events — notify every accepted participant
  const liveRendezEvents = await prisma.activityPost.findMany({
    where: {
      isRendezEvent: true,
      isActive: true,
      scheduledAt: { gte: midEventStart, lte: midEventEnd },
    },
    include: {
      matchRequests: {
        where: { status: "ACCEPTED" },
        include: { requester: { select: { id: true } } },
      },
    },
  });

  for (const event of liveRendezEvents) {
    for (const req of event.matchRequests) {
      await sendPushToUser(
        req.requester.id,
        "📸 Quick, snap a photo!",
        `You're at ${event.title} — grab a photo to save to your Memories afterwards 🧡`,
        { screen: "matches" },
      );
      photoNudgeCount++;
    }
  }

  // 2) 1:1 confirmed matches — notify both people
  const liveMatches = await prisma.match.findMany({
    where: {
      status: { in: ["CONFIRMED", "DATE_ACTIVE"] },
      finalizedPlan: {
        scheduledAt: { gte: midEventStart, lte: midEventEnd },
      },
    },
    include: {
      finalizedPlan: true,
      userA: { select: { id: true, name: true } },
      userB: { select: { id: true, name: true } },
    },
  });

  for (const m of liveMatches) {
    await sendPushToUser(
      m.userAId,
      "📸 Quick, snap a photo!",
      `You're on your Rendez with ${m.userB.name} — grab a photo to save to your Memories afterwards 🧡`,
      { matchId: m.id, screen: "matches" },
    );
    await sendPushToUser(
      m.userBId,
      "📸 Quick, snap a photo!",
      `You're on your Rendez with ${m.userA.name} — grab a photo to save to your Memories afterwards 🧡`,
      { matchId: m.id, screen: "matches" },
    );
    photoNudgeCount += 2;
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
    photoNudges: photoNudgeCount,
  });
}
