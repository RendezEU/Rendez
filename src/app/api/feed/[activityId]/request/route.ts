import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { sendPushToUser } from "@/lib/push/sendPush";
import { z } from "zod";

const schema = z.object({
  message:    z.string().max(200).optional(),
  hasPlusOne: z.boolean().optional().default(false),
});

const FREE_WEEKLY_LIMIT = 3;

// ─── POST: join event or join waitlist if full ────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const [post, requesterUser, billing] = await Promise.all([
    prisma.activityPost.findUnique({ where: { id: activityId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, profile: { select: { gender: true } } },
    }),
    prisma.billing.findUnique({ where: { userId } }),
  ]);

  if (!post || !post.isActive) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (post.userId === userId) return NextResponse.json({ error: "Cannot request your own post." }, { status: 400 });

  const isPremium = billing?.tier === "PREMIUM";

  // ── Gender restriction check ───────────────────────────────────────────────
  if (post.genderRestriction) {
    const requesterGender = requesterUser?.profile?.gender;
    if (requesterGender !== post.genderRestriction) {
      return NextResponse.json(
        {
          error: "gender_restricted",
          restriction: post.genderRestriction,
          message: `This is a ${post.genderRestriction === "MALE" ? "men's" : "women's"} only event.`,
        },
        { status: 403 }
      );
    }
  }

  // ── Gender balance check (open Rendez events only) ─────────────────────────
  if (post.isRendezEvent && post.maxParticipants > 1 && !post.genderRestriction && !post.isCouplesEvent) {
    const requesterGender = requesterUser?.profile?.gender;
    if (requesterGender === "MALE" || requesterGender === "FEMALE") {
      const genderSlotMax = Math.floor(post.maxParticipants / 2);
      const sameGenderCount = await prisma.feedMatchRequest.count({
        where: {
          activityPostId: activityId,
          isWaitlist: false,
          requester: { profile: { gender: requesterGender } },
        },
      });
      if (sameGenderCount >= genderSlotMax) {
        return NextResponse.json(
          {
            error: "gender_slot_full",
            gender: requesterGender,
            message: `The ${requesterGender === "MALE" ? "men's" : "women's"} spots for this event are full.`,
          },
          { status: 409 }
        );
      }
    }
  }

  // ── Weekly request limit (premium = unlimited) ────────────────────────────
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weeklyCount = isPremium ? 0 : await prisma.feedMatchRequest.count({
    where: { requesterId: userId, isWaitlist: false, createdAt: { gte: weekStart } },
  });

  // ── Already requested? ─────────────────────────────────────────────────────
  const existing = await prisma.feedMatchRequest.findUnique({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
  });
  if (existing) return NextResponse.json({ error: "Already requested." }, { status: 409 });

  // ── Check if event is full (confirmed spots only) ──────────────────────────
  const confirmedCount = await prisma.feedMatchRequest.count({
    where: { activityPostId: activityId, isWaitlist: false },
  });
  const maxParticipants = post.maxParticipants ?? 1;
  const isFull = confirmedCount >= maxParticipants;

  if (isFull) {
    // Join the waitlist — premium users get priority flag
    const request = await prisma.feedMatchRequest.create({
      data: {
        activityPostId: activityId,
        requesterId:    userId,
        message:        parsed.data.message,
        hasPlusOne:     post.isCouplesEvent ? (parsed.data.hasPlusOne ?? false) : false,
        isWaitlist:     true,
        isPriority:     isPremium,
      },
    });

    // Notify the post owner so they know someone is waiting
    await sendPushToUser(
      post.userId,
      `${requesterUser?.name ?? "Someone"} joined your waitlist`,
      isPremium
        ? "A Premium member is waiting — they'll be first in line if anyone cancels."
        : `Someone is waiting for a spot in "${post.title}".`,
      { screen: "feed", activityId }
    );

    return NextResponse.json({ ...request, isWaitlist: true }, { status: 201 });
  }

  // ── Confirmed join — check weekly limit (free users only) ────────────────
  if (!isPremium && weeklyCount >= FREE_WEEKLY_LIMIT) {
    return NextResponse.json({ error: "Weekly request limit reached." }, { status: 429 });
  }

  const request = await prisma.feedMatchRequest.create({
    data: {
      activityPostId: activityId,
      requesterId:    userId,
      message:        parsed.data.message,
      hasPlusOne:     post.isCouplesEvent ? (parsed.data.hasPlusOne ?? false) : false,
      isWaitlist:     false,
      isPriority:     false,
    },
  });

  // Notify the post owner
  const notifBody = parsed.data.message
    ? parsed.data.message.length > 80
      ? parsed.data.message.slice(0, 80) + "…"
      : parsed.data.message
    : "Tap to view their profile and decide.";
  await sendPushToUser(
    post.userId,
    `${requesterUser?.name ?? "Someone"} is interested in your post 💌`,
    notifBody,
    { screen: "matches" }
  );

  return NextResponse.json({ ...request, isWaitlist: false }, { status: 201 });
}

// ─── DELETE: cancel reservation or leave waitlist ─────────────────────────────
export async function DELETE(req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { activityId } = await params;

  const request = await prisma.feedMatchRequest.findUnique({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
    include: { activityPost: { select: { title: true, maxParticipants: true } } },
  });

  if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const wasConfirmed = !request.isWaitlist;

  // Delete the request
  await prisma.feedMatchRequest.delete({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
  });

  // ── If they had a confirmed spot, promote the next person in the waitlist ──
  if (wasConfirmed) {
    // Priority users first, then by join time (FIFO within each tier)
    const nextInLine = await prisma.feedMatchRequest.findFirst({
      where: { activityPostId: activityId, isWaitlist: true },
      orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
      include: { requester: { select: { name: true } } },
    });

    if (nextInLine) {
      // Promote to confirmed
      await prisma.feedMatchRequest.update({
        where: { id: nextInLine.id },
        data: { isWaitlist: false },
      });

      // Tell them the good news
      await sendPushToUser(
        nextInLine.requesterId,
        "A spot just opened up — you're in! 🎉",
        `Someone cancelled their spot in "${request.activityPost.title}". Your reservation is confirmed.`,
        { screen: "feed", activityId }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
