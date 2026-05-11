import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";

const schema = z.object({ message: z.string().max(200).optional() });

const FREE_WEEKLY_LIMIT = 3;
const PREMIUM_WEEKLY_LIMIT = 10;

export async function POST(req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const userId = await getRequestUserId(req);
  const { activityId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const post = await prisma.activityPost.findUnique({ where: { id: activityId } });
  if (!post || !post.isActive) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (post.userId === userId) return NextResponse.json({ error: "Cannot request your own post." }, { status: 400 });

  // Weekly limit check
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const billing = await prisma.billing.findUnique({ where: { userId: userId } });
  const limit = billing?.tier === "PREMIUM" ? PREMIUM_WEEKLY_LIMIT : FREE_WEEKLY_LIMIT;

  const count = await prisma.feedMatchRequest.count({
    where: { requesterId: userId, createdAt: { gte: weekStart } },
  });

  if (count >= limit) {
    return NextResponse.json({ error: "Weekly request limit reached." }, { status: 429 });
  }

  // Check not already requested
  const existing = await prisma.feedMatchRequest.findUnique({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
  });
  if (existing) return NextResponse.json({ error: "Already requested." }, { status: 409 });

  const [request, requester] = await Promise.all([
    prisma.feedMatchRequest.create({
      data: {
        activityPostId: activityId,
        requesterId: userId,
        message: parsed.data.message,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  // Notify the post owner
  const notifBody = parsed.data.message
    ? parsed.data.message.length > 80
      ? parsed.data.message.slice(0, 80) + "…"
      : parsed.data.message
    : "Tap to view their profile and decide.";
  await sendPushToUser(
    post.userId,
    `${requester?.name ?? "Someone"} is interested in your post 💌`,
    notifBody,
    { screen: "matches" }
  );

  return NextResponse.json(request, { status: 201 });
}
