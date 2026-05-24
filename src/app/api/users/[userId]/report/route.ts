import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

/** POST /api/users/:userId/report  — report a user */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const reporterId = auth;
  const { userId: reportedUserId } = await params;

  if (reporterId === reportedUserId) {
    return NextResponse.json({ error: "Cannot report yourself." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: reportedUserId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await prisma.report.create({
    data: { reporterId, reportedUserId, reason },
  });

  return NextResponse.json({ ok: true });
}
