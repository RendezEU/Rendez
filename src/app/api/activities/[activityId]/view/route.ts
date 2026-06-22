import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

// POST — record a view on an activity post. Only counts views from other users (not the owner).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;

  const post = await prisma.activityPost.findUnique({
    where: { id: activityId },
    select: { userId: true, isActive: true },
  });

  if (!post || !post.isActive) return NextResponse.json({ ok: true });
  // Don't count the host viewing their own post
  if (post.userId === userId) return NextResponse.json({ ok: true });

  await prisma.activityPost.update({
    where: { id: activityId },
    data: { viewCount: { increment: 1 } },
  });

  return NextResponse.json({ ok: true });
}
