import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const VALID_REASONS = [
  "Inappropriate content",
  "Fake or spam",
  "Feels unsafe",
  "Harassment",
  "Other",
] as const;

const schema = z.object({
  reason: z.enum(VALID_REASONS),
  notes: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reason." }, { status: 400 });

  const post = await prisma.activityPost.findUnique({
    where: { id: activityId },
    select: { id: true, userId: true, isActive: true },
  });

  if (!post || !post.isActive) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (post.userId === userId) return NextResponse.json({ error: "Cannot report your own post." }, { status: 400 });

  // One report per user per post
  const existing = await prisma.report.findFirst({
    where: { reporterId: userId, reportedPostId: activityId },
  });
  if (existing) return NextResponse.json({ ok: true }); // silently deduplicate

  await prisma.report.create({
    data: {
      reporterId: userId,
      reportedPostId: activityId,
      reportedUserId: post.userId,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
    },
  });

  return NextResponse.json({ ok: true });
}
