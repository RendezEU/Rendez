import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerMatchEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";
import { moderateText } from "@/lib/content-filter";

const BASE_LIMIT = 10;
const EXTRA_LIMIT = 10; // purchased add-on

const schema = z.object({ content: z.string().min(1).max(500) });

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { matchId },
    include: { sender: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(messages);
}

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const moderation = moderateText(parsed.data.content);
  if (!moderation.ok) {
    return NextResponse.json({ error: moderation.reason }, { status: 422 });
  }

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (!["COORDINATING", "CONFIRMED", "DATE_ACTIVE", "CONNECTED"].includes(match.status)) {
    return NextResponse.json({ error: "Match not in coordination phase." }, { status: 403 });
  }

  const isA = match.userAId === userId;
  const extraGranted = isA ? match.extraMsgGrantedA : match.extraMsgGrantedB;
  const maxMessages = BASE_LIMIT + (extraGranted ? EXTRA_LIMIT : 0);

  // Wrap count + create in a transaction so two concurrent requests can't both
  // pass the limit check before either insert lands (prevents over-limit messages
  // and duplicate messageIndex values).
  let message: Awaited<ReturnType<typeof prisma.message.create>> & {
    sender: { id: string; name: string | null };
  };
  try {
    message = await prisma.$transaction(async (tx) => {
      const myCount = await tx.message.count({ where: { matchId, senderId: userId } });
      if (myCount >= maxMessages) {
        throw Object.assign(new Error("MESSAGE_LIMIT_REACHED"), { isLimit: true });
      }
      const totalCount = await tx.message.count({ where: { matchId } });
      return tx.message.create({
        data: { matchId, senderId: userId, content: parsed.data.content, messageIndex: totalCount + 1 },
        include: { sender: { select: { id: true, name: true } } },
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { isLimit?: boolean }).isLimit) {
      return NextResponse.json({ error: "MESSAGE_LIMIT_REACHED", limit: maxMessages }, { status: 403 });
    }
    throw err;
  }

  await triggerMatchEvent(matchId, "new-message", message);

  // Push notification to the other user
  const recipientId = match.userAId === userId ? match.userBId : match.userAId;
  const senderName = message.sender.name;
  await sendPushToUser(
    recipientId,
    `New message from ${senderName} 💬`,
    parsed.data.content.length > 80 ? parsed.data.content.slice(0, 80) + "…" : parsed.data.content,
    { matchId, screen: "matches" }
  );

  return NextResponse.json(message, { status: 201 });
}
