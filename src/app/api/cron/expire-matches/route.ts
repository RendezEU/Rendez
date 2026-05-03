import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { addReputationEvent } from "@/lib/reputation/calculator";

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();

  // Expire pending matches past their expiry
  const expired = await prisma.match.updateMany({
    where: {
      status: { in: ["PENDING_BOTH_DECISIONS", "PENDING_OTHER_DECISION"] },
      expiresAt: { lt: now },
    },
    data: { status: "EXPIRED" },
  });

  // Activate confirmed matches within 2 hours of scheduled time
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

  // Complete active matches 3 hours after scheduled time + handle no-shows
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

    // No-show detection
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
    expired: expired.count,
    activated: toActivate.length,
    completed: toComplete.length,
  });
}
