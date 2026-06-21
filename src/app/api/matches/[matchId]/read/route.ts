import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;

  // Verify the caller is a participant — without this check any user could mark
  // another pair's messages as read, silently corrupting unread counts.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { userAId: true, userBId: true },
  });
  if (!match || (match.userAId !== userId && match.userBId !== userId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Mark all messages in this match NOT sent by this user as read
  await prisma.message.updateMany({
    where: { matchId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
