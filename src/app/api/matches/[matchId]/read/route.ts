import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;

  // Mark all messages in this match NOT sent by this user as read
  await prisma.message.updateMany({
    where: { matchId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
