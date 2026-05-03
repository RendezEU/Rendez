import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { addReputationEvent } from "@/lib/reputation/calculator";
import { z } from "zod";

const schema = z.object({ decision: z.enum(["CONNECT", "PASS"]) });

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (match.status !== "COMPLETED") {
    return NextResponse.json({ error: "Date not completed yet." }, { status: 400 });
  }

  const { decision } = parsed.data;
  const otherId = match.userAId === userId ? match.userBId : match.userAId;

  await prisma.postDateDecision.upsert({
    where: { matchId_userId: { matchId, userId } },
    create: { matchId, userId, decision },
    update: { decision },
  });

  // Add reputation event for the other person
  if (decision === "CONNECT") {
    await addReputationEvent(otherId, "CONNECT_RECEIVED", matchId);
  } else {
    await addReputationEvent(otherId, "PASS_RECEIVED", matchId);
  }

  // Check if both decided
  const decisions = await prisma.postDateDecision.findMany({ where: { matchId } });
  if (decisions.length === 2) {
    const bothConnect = decisions.every((d) => d.decision === "CONNECT");

    if (bothConnect) {
      // Both chose CONNECT — send contact info via Pusher private channels
      const [userA, userB] = await Promise.all([
        prisma.user.findUnique({ where: { id: match.userAId }, select: { email: true, name: true } }),
        prisma.user.findUnique({ where: { id: match.userBId }, select: { email: true, name: true } }),
      ]);

      await triggerUserEvent(match.userAId, "contact-unlocked", {
        matchId,
        contact: { name: userB?.name, email: userB?.email },
      });
      await triggerUserEvent(match.userBId, "contact-unlocked", {
        matchId,
        contact: { name: userA?.name, email: userA?.email },
      });
    }
  }

  return NextResponse.json({ ok: true, decision });
}
