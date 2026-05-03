import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerMatchEvent } from "@/lib/pusher/server";
import { z } from "zod";

const MAX_MESSAGES = 5;

const schema = z.object({ content: z.string().min(1).max(500) });

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
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
  if (!["COORDINATING", "CONFIRMED", "DATE_ACTIVE"].includes(match.status)) {
    return NextResponse.json({ error: "Match not in coordination phase." }, { status: 403 });
  }

  const count = await prisma.message.count({ where: { matchId } });
  if (count >= MAX_MESSAGES) {
    return NextResponse.json({ error: "MESSAGE_LIMIT_REACHED", limit: MAX_MESSAGES }, { status: 403 });
  }

  const message = await prisma.message.create({
    data: {
      matchId,
      senderId: userId,
      content: parsed.data.content,
      messageIndex: count + 1,
    },
    include: { sender: { select: { id: true, name: true } } },
  });

  await triggerMatchEvent(matchId, "new-message", message);

  return NextResponse.json(message, { status: 201 });
}
