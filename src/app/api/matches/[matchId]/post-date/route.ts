import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerUserEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import { addReputationEvent, applyStarRatings } from "@/lib/reputation/calculator";
import { z } from "zod";

const schema = z.object({
  decision: z.enum(["CONNECT", "PASS"]),
  showUp: z.number().min(1).max(5).optional(),
  kindness: z.number().min(1).max(5).optional(),
  profileMatch: z.number().min(1).max(5).optional(),
});

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

  const { decision, showUp, kindness, profileMatch } = parsed.data;
  const otherId = match.userAId === userId ? match.userBId : match.userAId;

  await prisma.postDateDecision.upsert({
    where: { matchId_userId: { matchId, userId } },
    create: { matchId, userId, decision },
    update: { decision },
  });

  // Apply star ratings to the other person's reputation
  if (showUp !== undefined && kindness !== undefined && profileMatch !== undefined) {
    await applyStarRatings(otherId, showUp, kindness, profileMatch);
  }

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
      // Promote match to CONNECTED and lift the message cap for both sides
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: "CONNECTED",
          extraMsgGrantedA: true,
          extraMsgGrantedB: true,
        },
      });

      const [userA, userB] = await Promise.all([
        prisma.user.findUnique({ where: { id: match.userAId }, select: { email: true, name: true } }),
        prisma.user.findUnique({ where: { id: match.userBId }, select: { email: true, name: true } }),
      ]);

      // Real-time Pusher + push notification to both users
      await Promise.all([
        triggerUserEvent(match.userAId, "contact-unlocked", {
          matchId,
          contact: { name: userB?.name, email: userB?.email },
        }),
        triggerUserEvent(match.userBId, "contact-unlocked", {
          matchId,
          contact: { name: userA?.name, email: userA?.email },
        }),
        sendPushToUser(
          match.userAId,
          `You and ${userB?.name ?? "your date"} both connected! 🎉`,
          "You can now message freely and share contact details.",
          { matchId, screen: "matches" }
        ),
        sendPushToUser(
          match.userBId,
          `You and ${userA?.name ?? "your date"} both connected! 🎉`,
          "You can now message freely and share contact details.",
          { matchId, screen: "matches" }
        ),
      ]);
    }
  }

  return NextResponse.json({ ok: true, decision });
}
