import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const schema = z.object({ message: z.string().max(200).optional() });

const FREE_WEEKLY_LIMIT = 3;
const PREMIUM_WEEKLY_LIMIT = 10;

export async function POST(req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const session = await getRequiredSession();
  const { activityId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const post = await prisma.activityPost.findUnique({ where: { id: activityId } });
  if (!post || !post.isActive) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (post.userId === session.user.id) return NextResponse.json({ error: "Cannot request your own post." }, { status: 400 });

  // Weekly limit check
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const billing = await prisma.billing.findUnique({ where: { userId: session.user.id } });
  const limit = billing?.tier === "PREMIUM" ? PREMIUM_WEEKLY_LIMIT : FREE_WEEKLY_LIMIT;

  const count = await prisma.feedMatchRequest.count({
    where: { requesterId: session.user.id, createdAt: { gte: weekStart } },
  });

  if (count >= limit) {
    return NextResponse.json({ error: "Weekly request limit reached." }, { status: 429 });
  }

  // Check not already requested
  const existing = await prisma.feedMatchRequest.findUnique({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: session.user.id } },
  });
  if (existing) return NextResponse.json({ error: "Already requested." }, { status: 409 });

  const request = await prisma.feedMatchRequest.create({
    data: {
      activityPostId: activityId,
      requesterId: session.user.id,
      message: parsed.data.message,
    },
  });

  return NextResponse.json(request, { status: 201 });
}
