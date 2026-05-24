import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

/** POST /api/users/:userId/block  — block a user */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const blockerId = auth;
  const { userId: blockedId } = await params;

  if (blockerId === blockedId) {
    return NextResponse.json({ error: "Cannot block yourself." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

/** DELETE /api/users/:userId/block  — unblock a user */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const blockerId = auth;
  const { userId: blockedId } = await params;

  await prisma.block.deleteMany({ where: { blockerId, blockedId } });

  return NextResponse.json({ ok: true });
}
