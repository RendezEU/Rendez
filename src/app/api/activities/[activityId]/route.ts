import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const userId = await getRequestUserId(req);
  const { activityId } = await params;

  await prisma.activityPost.update({
    where: { id: activityId, userId },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
