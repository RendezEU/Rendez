import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { sendPushToUser } from "@/lib/push/sendPush";
import { moderateText } from "@/lib/content-filter";
import { z } from "zod";

const schema = z.object({ content: z.string().min(1).max(500) });

const RATE_WINDOW_SECS = 5;
const RATE_MAX_PER_WINDOW = 2;

async function isParticipant(activityPostId: string, userId: string): Promise<boolean> {
  const [request, post] = await Promise.all([
    prisma.feedMatchRequest.findUnique({
      where: { activityPostId_requesterId: { activityPostId, requesterId: userId } },
      select: { isWaitlist: true },
    }),
    prisma.activityPost.findUnique({
      where: { id: activityPostId },
      select: { userId: true },
    }),
  ]);
  // Host is always a participant; confirmed (non-waitlist) joiners too
  if (post?.userId === userId) return true;
  if (request && !request.isWaitlist) return true;
  return false;
}

// GET — fetch all messages for a group event chat
export async function GET(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;

  if (!(await isParticipant(activityId, userId))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const messages = await prisma.eventMessage.findMany({
    where: { activityPostId: activityId },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          profile: { select: { photos: { where: { isPrimary: true }, take: 1, select: { url: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    messages.map((m) => ({
      id: m.id,
      content: m.content,
      senderId: m.senderId,
      senderName: m.sender.name ?? "Unknown",
      senderPhoto: m.sender.profile?.photos?.[0]?.url ?? null,
      createdAt: m.createdAt.toISOString(),
    }))
  );
}

// POST — send a message to the group event chat
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const moderation = moderateText(parsed.data.content);
  if (!moderation.ok) {
    return NextResponse.json({ error: moderation.reason }, { status: 422 });
  }

  if (!(await isParticipant(activityId, userId))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Rate limit: max 2 messages per 5-second window per user
  const windowStart = new Date(Date.now() - RATE_WINDOW_SECS * 1000);
  const recentCount = await prisma.eventMessage.count({
    where: { activityPostId: activityId, senderId: userId, createdAt: { gte: windowStart } },
  });
  if (recentCount >= RATE_MAX_PER_WINDOW) {
    return NextResponse.json({ error: "Slow down — you're sending too fast." }, { status: 429 });
  }

  const message = await prisma.eventMessage.create({
    data: { activityPostId: activityId, senderId: userId, content: parsed.data.content },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          profile: { select: { photos: { where: { isPrimary: true }, take: 1, select: { url: true } } } },
        },
      },
    },
  });

  // Notify all other confirmed participants + the host
  const [requests, post] = await Promise.all([
    prisma.feedMatchRequest.findMany({
      where: { activityPostId: activityId, isWaitlist: false, requesterId: { not: userId } },
      select: { requesterId: true },
    }),
    prisma.activityPost.findUnique({
      where: { id: activityId },
      select: { userId: true, title: true },
    }),
  ]);

  const recipientIds = new Set<string>(requests.map((r) => r.requesterId));
  if (post && post.userId !== userId) recipientIds.add(post.userId);

  const senderName = message.sender.name ?? "Someone";
  const preview = parsed.data.content.length > 80
    ? parsed.data.content.slice(0, 80) + "…"
    : parsed.data.content;

  await Promise.all(
    Array.from(recipientIds).map((id) =>
      sendPushToUser(
        id,
        `${senderName} in ${post?.title ?? "group chat"} 💬`,
        preview,
        { screen: "home", activityId }
      )
    )
  );

  return NextResponse.json({
    id: message.id,
    content: message.content,
    senderId: message.senderId,
    senderName: message.sender.name ?? "Unknown",
    senderPhoto: message.sender.profile?.photos?.[0]?.url ?? null,
    createdAt: message.createdAt.toISOString(),
  }, { status: 201 });
}
