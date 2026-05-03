import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerMatchEvent } from "@/lib/pusher/server";
import { addReputationEvent } from "@/lib/reputation/calculator";
import { z } from "zod";

const schema = z.object({
  actionType: z.enum(["PROPOSE_TIME","ACCEPT_TIME","PROPOSE_LOCATION","ACCEPT_LOCATION","CONFIRM_PLAN","RUNNING_LATE","ARRIVED","CANCEL"]),
  payload: z.record(z.unknown()).default({}),
  targetActionId: z.string().optional(), // for ACCEPT_TIME / ACCEPT_LOCATION
});

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const session = await getRequiredSession();
  const { matchId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { finalizedPlan: true },
  });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const isA = match.userAId === session.user?.id as string;
  const isB = match.userBId === session.user?.id as string;
  if (!isA && !isB) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { actionType, payload, targetActionId } = parsed.data;

  // Handle ARRIVED → check-in
  if (actionType === "ARRIVED") {
    const field = isA ? "userAArrivedAt" : "userBArrivedAt";
    if (match.finalizedPlan) {
      await prisma.finalizedPlan.update({
        where: { id: match.finalizedPlan.id },
        data: { [field]: new Date() },
      });
    }
    await addReputationEvent(session.user?.id as string, "ON_TIME", matchId);
    await triggerMatchEvent(matchId, "user-arrived", { userId: session.user?.id as string });
    return NextResponse.json({ ok: true });
  }

  // Handle CONFIRM_PLAN → create FinalizedPlan
  if (actionType === "CONFIRM_PLAN") {
    const actions = await prisma.systemAction.findMany({ where: { matchId } });
    const acceptedTime = actions.find(
      (a) => a.actionType === "ACCEPT_TIME" && a.acceptedAt
    );
    const acceptedLoc = actions.find(
      (a) => a.actionType === "ACCEPT_LOCATION" && a.acceptedAt
    );

    if (!acceptedTime || !acceptedLoc) {
      return NextResponse.json(
        { error: "Both time and location must be agreed upon first." },
        { status: 400 }
      );
    }

    const timePayload = actions.find((a) => a.id === (acceptedTime.payload as { sourceId?: string }).sourceId)?.payload ?? acceptedTime.payload;
    const locPayload = acceptedLoc.payload as { locationName?: string; locationUrl?: string };

    const scheduledAt = (timePayload as { proposedDatetime?: string }).proposedDatetime
      ? new Date((timePayload as { proposedDatetime: string }).proposedDatetime)
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
    await triggerMatchEvent(matchId, "plan-confirmed", { matchId });
    return NextResponse.json({ ok: true });
  }

  // Handle CANCEL
  if (actionType === "CANCEL") {
    await prisma.match.update({ where: { id: matchId }, data: { status: "CANCELLED" } });
    return NextResponse.json({ ok: true });
  }

  // Accept actions
  if (actionType === "ACCEPT_TIME" || actionType === "ACCEPT_LOCATION") {
    if (!targetActionId) return NextResponse.json({ error: "targetActionId required." }, { status: 400 });
    const updated = await prisma.systemAction.update({
      where: { id: targetActionId },
      data: { acceptedAt: new Date() },
    });
    await triggerMatchEvent(matchId, "action-accepted", updated);
    return NextResponse.json(updated);
  }

  // Propose actions
  const action = await prisma.systemAction.create({
    data: { matchId, initiatorId: session.user?.id as string, actionType, payload: payload as never },
  });

  await triggerMatchEvent(matchId, "system-action", action);

  return NextResponse.json(action, { status: 201 });
}
