import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      userA: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true } } } },
      userB: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true } } } },
      finalizedPlan: true,
      systemActions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  return NextResponse.json(match);
}
