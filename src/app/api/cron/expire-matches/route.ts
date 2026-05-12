import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { addReputationEvent } from "@/lib/reputation/calculator";
import { sendPushToUser } from "@/lib/push/sendPush";

function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  // fallback: legacy x-cron-secret header (manual triggers)
  return req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();

  // ── 1. Expire pending AI-match suggestions ──────────────────────────────
  const expiredMatches = await prisma.match.findMany({
    where: {
      status: { in: ["PENDING_BOTH_DECISIONS", "PENDING_OTHER_DECISION"] },
      expiresAt: { lt: now },
    },
    select: { id: true, userAId: true, userBId: true, activityCategory: true },
  });

  if (expiredMatches.length > 0) {
    await prisma.match.updateMany({
      where: { id: { in: expiredMatches.map((m) => m.id) } },
      data: { status: "EXPIRED" },
    });

    // Notify both users that the suggestion expired
    for (const m of expiredMatches) {
      await Promise.all([
        sendPushToUser(
          m.userAId,
          "A match suggestion expired ⏳",
          "You had a pending match that wasn't acted on in time. New suggestions are generated weekly.",
          { screen: "matches" }
        ),
        sendPushToUser(
          m.userBId,
          "A match suggestion expired ⏳",
          "You had a pending match that wasn't acted on in time. New suggestions are generated weekly.",
          { screen: "matches" }
        ),
      ]);
    }
  }

  // ── 2. Expire stale feed interest requests (older than 7 days) ──────────
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const staleRequests = await prisma.feedMatchRequest.findMany({
    where: { status: "PENDING", createdAt: { lt: sevenDaysAgo } },
    include: { activityPost: { select: { title: true } } },
  });

  if (staleRequests.length > 0) {
    await prisma.feedMatchRequest.updateMany({
      where: { id: { in: staleRequests.map((r) => r.id) } },
      data: { status: "EXPIRED" },
    });

    for (const r of staleRequests) {
      await sendPushToUser(
        r.requesterId,
        "Interest request expired",
        `Your interest in "${r.activityPost.title}" wasn't responded to in time. Keep exploring the feed!`,
        { screen: "feed" }
      );
    }
  }

  // ── 3. Activate confirmed matches within 2 hours of scheduled time ───────
  const toActivate = await prisma.match.findMany({
    where: {
      status: "CONFIRMED",
      finalizedPlan: { scheduledAt: { lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) } },
    },
    include: { finalizedPlan: true },
  });

  for (const m of toActivate) {
    await prisma.match.update({ where: { id: m.id }, data: { status: "DATE_ACTIVE" } });
  }

  // ── 4. Complete active matches 3 hours after scheduled time ─────────────
  const toComplete = await prisma.match.findMany({
    where: {
      status: "DATE_ACTIVE",
      finalizedPlan: { scheduledAt: { lt: new Date(now.getTime() - 3 * 60 * 60 * 1000) } },
    },
    include: { finalizedPlan: true },
  });

  for (const m of toComplete) {
    await prisma.match.update({ where: { id: m.id }, data: { status: "COMPLETED" } });

    const plan = m.finalizedPlan;
    if (!plan) continue;

    if (!plan.userAArrivedAt) {
      await addReputationEvent(m.userAId, "NO_SHOW", m.id, "Did not check in");
    } else {
      await addReputationEvent(m.userAId, "DATE_COMPLETED", m.id);
    }
    if (!plan.userBArrivedAt) {
      await addReputationEvent(m.userBId, "NO_SHOW", m.id, "Did not check in");
    } else {
      await addReputationEvent(m.userBId, "DATE_COMPLETED", m.id);
    }
  }

  return NextResponse.json({
    expiredMatches: expiredMatches.length,
    expiredInterests: staleRequests.length,
    activated: toActivate.length,
    completed: toComplete.length,
  });
}
