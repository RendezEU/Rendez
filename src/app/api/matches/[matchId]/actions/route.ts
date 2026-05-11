import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerMatchEvent } from "@/lib/pusher/server";
import { addReputationEvent } from "@/lib/reputation/calculator";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";

const schema = z.object({
  actionType: z.enum(["PROPOSE_TIME","ACCEPT_TIME","PROPOSE_LOCATION","ACCEPT_LOCATION","CONFIRM_PLAN","RUNNING_LATE","ARRIVED","CANCEL","RETRACT_PROPOSAL","RESCHEDULE"]),
  payload: z.record(z.unknown()).default({}),
  targetActionId: z.string().optional(), // for ACCEPT_TIME / ACCEPT_LOCATION
});

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { finalizedPlan: true },
  });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const isA = match.userAId === userId;
  const isB = match.userBId === userId;
  if (!isA && !isB) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { actionType, payload, targetActionId } = parsed.data;
  const recipientId = isA ? match.userBId : match.userAId;

  // Load sender name lazily — only fetched once and reused
  let _senderName: string | null = null;
  async function senderName() {
    if (_senderName) return _senderName;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    _senderName = u?.name ?? "Your match";
    return _senderName;
  }

  // Handle ARRIVED → check-in
  if (actionType === "ARRIVED") {
    const field = isA ? "userAArrivedAt" : "userBArrivedAt";
    if (match.finalizedPlan) {
      await prisma.finalizedPlan.update({
        where: { id: match.finalizedPlan.id },
        data: { [field]: new Date() },
      });
    }
    await addReputationEvent(userId, "ON_TIME", matchId);
    await triggerMatchEvent(matchId, "user-arrived", { userId: userId });
    await sendPushToUser(recipientId, `${await senderName()} has arrived! 📍`, "They're there — head over!", { matchId, screen: "matches" });
    return NextResponse.json({ ok: true });
  }

  // Handle CONFIRM_PLAN → create FinalizedPlan
  if (actionType === "CONFIRM_PLAN") {
    const actions = await prisma.systemAction.findMany({ where: { matchId } });
    // Accepting a proposal sets acceptedAt on the original PROPOSE_TIME / PROPOSE_LOCATION record
    const acceptedTime = actions.find(
      (a) => a.actionType === "PROPOSE_TIME" && a.acceptedAt
    );
    const acceptedLoc = actions.find(
      (a) => a.actionType === "PROPOSE_LOCATION" && a.acceptedAt
    );

    if (!acceptedTime || !acceptedLoc) {
      return NextResponse.json(
        { error: "Both time and location must be agreed upon first." },
        { status: 400 }
      );
    }

    const timePayload = acceptedTime.payload as { proposedDatetime?: string };
    const locPayload = acceptedLoc.payload as { locationName?: string; locationUrl?: string };

    const scheduledAt = timePayload.proposedDatetime
      ? new Date(timePayload.proposedDatetime)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.finalizedPlan.upsert({
      where: { matchId },
      create: {
        matchId,
        activityCategory: match.activityCategory,
        locationName: locPayload.locationName ?? "TBD",
        locationUrl: locPayload.locationUrl,
        scheduledAt,
      },
      update: {},
    });

    await prisma.match.update({ where: { id: matchId }, data: { status: "CONFIRMED" } });

    // Block the matching availability slot for both users until the date passes
    const JS_TO_DOW = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"] as const;
    const h = scheduledAt.getHours();
    const timeBlock = h < 13 ? "MORNING" : h < 18 ? "AFTERNOON" : h < 21 ? "EVENING" : "NIGHT";
    const dayOfWeek = JS_TO_DOW[scheduledAt.getDay()];
    await prisma.availabilitySlot.updateMany({
      where: { userId: { in: [match.userAId, match.userBId] }, dayOfWeek, timeBlock },
      data: { blockedUntil: scheduledAt },
    });

    await triggerMatchEvent(matchId, "plan-confirmed", { matchId });
    await sendPushToUser(
      recipientId,
      `${await senderName()} confirmed the plan! 🎉`,
      `📍 ${locPayload.locationName ?? "TBD"}`,
      { matchId, screen: "matches" }
    );
    return NextResponse.json({ ok: true });
  }

  // Handle RESCHEDULE — reset to COORDINATING, clear finalized plan and proposals
  if (actionType === "RESCHEDULE") {
    if (!["CONFIRMED", "DATE_ACTIVE"].includes(match.status)) {
      return NextResponse.json({ error: "Can only reschedule a confirmed match." }, { status: 400 });
    }
    // Unblock availability slots
    if (match.finalizedPlan) {
      const scheduledAt = new Date(match.finalizedPlan.scheduledAt);
      const JS_TO_DOW = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"] as const;
      const h = scheduledAt.getHours();
      const timeBlock = h < 13 ? "MORNING" : h < 18 ? "AFTERNOON" : h < 21 ? "EVENING" : "NIGHT";
      const dayOfWeek = JS_TO_DOW[scheduledAt.getDay()];
      await prisma.availabilitySlot.updateMany({
        where: { userId: { in: [match.userAId, match.userBId] }, dayOfWeek, timeBlock, blockedUntil: scheduledAt },
        data: { blockedUntil: null },
      });
      await prisma.finalizedPlan.delete({ where: { matchId } });
    }
    // Clear all proposals for this match
    await prisma.systemAction.deleteMany({ where: { matchId } });
    await prisma.match.update({ where: { id: matchId }, data: { status: "COORDINATING" } });
    await triggerMatchEvent(matchId, "rescheduled", { matchId });
    await sendPushToUser(
      recipientId,
      `${await senderName()} wants to reschedule 🔄`,
      "They'd like to find a new time. Head to the match to suggest one!",
      { matchId, screen: "matches" }
    );
    return NextResponse.json({ ok: true });
  }

  // Handle CANCEL
  if (actionType === "CANCEL") {
    await prisma.match.update({ where: { id: matchId }, data: { status: "CANCELLED" } });
    // Unblock availability slots if they were blocked by this match
    if (match.finalizedPlan) {
      const scheduledAt = new Date(match.finalizedPlan.scheduledAt);
      const JS_TO_DOW = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"] as const;
      const h = scheduledAt.getHours();
      const timeBlock = h < 13 ? "MORNING" : h < 18 ? "AFTERNOON" : h < 21 ? "EVENING" : "NIGHT";
      const dayOfWeek = JS_TO_DOW[scheduledAt.getDay()];
      await prisma.availabilitySlot.updateMany({
        where: { userId: { in: [match.userAId, match.userBId] }, dayOfWeek, timeBlock, blockedUntil: scheduledAt },
        data: { blockedUntil: null },
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Handle RUNNING_LATE
  if (actionType === "RUNNING_LATE") {
    await triggerMatchEvent(matchId, "running-late", { userId });
    await sendPushToUser(recipientId, `${await senderName()} is running late 🏃`, "They're on the way!", { matchId, screen: "matches" });
    return NextResponse.json({ ok: true });
  }

  // Retract / decline proposal
  if (actionType === "RETRACT_PROPOSAL") {
    const retractType = (payload as { proposalType?: string }).proposalType;
    if (!retractType) return NextResponse.json({ error: "proposalType required." }, { status: 400 });

    if (targetActionId) {
      // Recipient declining a specific incoming proposal
      const proposal = await prisma.systemAction.findUnique({ where: { id: targetActionId } });
      if (!proposal || proposal.matchId !== matchId) return NextResponse.json({ error: "Not found." }, { status: 404 });
      await prisma.systemAction.delete({ where: { id: targetActionId } });
      const isTime = retractType === "PROPOSE_TIME";
      await sendPushToUser(
        proposal.initiatorId,
        `${await senderName()} wants a different ${isTime ? "time" : "place"} 🔄`,
        "They declined — try a new suggestion!",
        { matchId, screen: "matches" }
      );
    } else {
      // Proposer retracting their own pending proposals
      await prisma.systemAction.deleteMany({
        where: { matchId, initiatorId: userId, actionType: retractType as never, acceptedAt: null },
      });
    }
    await triggerMatchEvent(matchId, "system-action", { retracted: retractType });
    return NextResponse.json({ ok: true });
  }

  // Accept actions — notify the original proposer
  if (actionType === "ACCEPT_TIME" || actionType === "ACCEPT_LOCATION") {
    if (!targetActionId) return NextResponse.json({ error: "targetActionId required." }, { status: 400 });
    const updated = await prisma.systemAction.update({
      where: { id: targetActionId },
      data: { acceptedAt: new Date() },
    });
    await triggerMatchEvent(matchId, "action-accepted", updated);
    const isTime = actionType === "ACCEPT_TIME";
    await sendPushToUser(
      updated.initiatorId,
      `${await senderName()} accepted your ${isTime ? "time" : "place"} suggestion ${isTime ? "✅🕐" : "✅📍"}`,
      isTime ? "Time is set — now agree on a place!" : "Place is set — now agree on a time!",
      { matchId, screen: "matches" }
    );
    return NextResponse.json(updated);
  }

  // Propose actions — notify the other user
  const action = await prisma.systemAction.create({
    data: { matchId, initiatorId: userId, actionType, payload: payload as never },
  });

  await triggerMatchEvent(matchId, "system-action", action);

  if (actionType === "PROPOSE_TIME") {
    const dt = (payload as { proposedDatetime?: string }).proposedDatetime;
    const dateStr = dt ? new Date(dt).toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    await sendPushToUser(
      recipientId,
      `${await senderName()} suggested a time 🕐`,
      dateStr || "Tap to view",
      { matchId, screen: "matches" }
    );
  } else if (actionType === "PROPOSE_LOCATION") {
    const loc = (payload as { locationName?: string }).locationName ?? "a place";
    await sendPushToUser(
      recipientId,
      `${await senderName()} suggested a place 📍`,
      loc,
      { matchId, screen: "matches" }
    );
  }

  return NextResponse.json(action, { status: 201 });
}
