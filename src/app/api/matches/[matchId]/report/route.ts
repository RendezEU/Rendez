import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

/** POST /api/matches/:matchId/report  — report the other person in a match */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const reporterId = auth;
  const { matchId } = await params;

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

  // Verify the reporter is a participant and find the other user
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { userAId: true, userBId: true },
  });

  if (!match) return NextResponse.json({ error: "Match not found." }, { status: 404 });

  const isParticipant = match.userAId === reporterId || match.userBId === reporterId;
  if (!isParticipant) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const reportedUserId = match.userAId === reporterId ? match.userBId : match.userAId;

  await prisma.report.create({
    data: { reporterId, reportedUserId, reason },
  });

  return NextResponse.json({ ok: true });
}
