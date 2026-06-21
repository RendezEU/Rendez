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
const FREE_RENDEZ_MONTHLY_LIMIT = 2;

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
          status: { not: "DECLINED" },
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

  // ── Monthly Rendez event limit (server-enforced, premium = unlimited) ────────
  if (post.isRendezEvent && !isPremium) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const rendezThisMonth = await prisma.feedMatchRequest.count({
      where: {
        requesterId: userId,
        isWaitlist: false,
        createdAt: { gte: monthStart },
        activityPost: { isRendezEvent: true },
      },
    });
    if (rendezThisMonth >= FREE_RENDEZ_MONTHLY_LIMIT) {
      return NextResponse.json(
        { error: "RENDEZ_LIMIT", message: "Free members can join 2 Rendez events per month. Upgrade to Premium for unlimited access." },
        { status: 429 }
      );
    }
  }

  // ── Weekly community request limit (premium = unlimited) ─────────────────
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weeklyCount = (isPremium || post.isRendezEvent) ? 0 : await prisma.feedMatchRequest.count({
    where: { requesterId: userId, isWaitlist: false, createdAt: { gte: weekStart }, activityPost: { isRendezEvent: false } },
  });

  // ── Already requested? ─────────────────────────────────────────────────────
  const existing = await prisma.feedMatchRequest.findUnique({
    where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
  });
  if (existing) return NextResponse.json({ error: "Already requested." }, { status: 409 });

  // ── Check weekly limit before ANY community join (confirmed or waitlist) ───
  if (!isPremium && !post.isRendezEvent && weeklyCount >= FREE_WEEKLY_LIMIT) {
    return NextResponse.json({ error: "Weekly request limit reached." }, { status: 429 });
  }

  const maxParticipants = post.maxParticipants ?? 1;

  // ── Atomic capacity check + create inside a transaction ───────────────────
  // Without a transaction two concurrent requests both see confirmedCount < max
  // and both insert confirmed (non-waitlist) records, overbooking the event.
  let placedOnWaitlist = false;

  const request = await prisma.$transaction(async (tx) => {
    const confirmedCount = await tx.feedMatchRequest.count({
      where: { activityPostId: activityId, isWaitlist: false, status: { not: "DECLINED" } },
    });
    const isFull = confirmedCount >= maxParticipants;
    placedOnWaitlist = isFull;

    return tx.feedMatchRequest.create({
      data: {
        activityPostId: activityId,
        requesterId:    userId,
        message:        parsed.data.message,
        hasPlusOne:     post.isCouplesEvent ? (parsed.data.hasPlusOne ?? false) : false,
        isWaitlist:     isFull,
        isPriority:     isPremium,
      },
    });
  });

  if (placedOnWaitlist) {
    await sendPushToUser(
      post.userId,
      `${requesterUser?.name ?? "Someone"} joined your waitlist`,
      isPremium
        ? "A Premium member is waiting — they'll be first in line if anyone cancels."
        : `Someone is waiting for a spot in "${post.title}".`,
      { screen: "feed", activityId }
    );
  } else {
    const notifBody = parsed.data.message
      ? parsed.data.message.length > 80
        ? parsed.data.message.slice(0, 80) + "…"
        : parsed.data.message
      : "You have 24 hours to accept or it will be auto-declined.";
    await sendPushToUser(
      post.userId,
      `${requesterUser?.name ?? "Someone"} is interested in your post 💌`,
      notifBody,
      { screen: "matches" }
    );
  }

  return NextResponse.json({ ...request, isWaitlist: placedOnWaitlist }, { status: 201 });
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

  // ── Delete + promote inside a transaction so two concurrent cancellations
  // can't both promote the same waitlist person ────────────────────────────
  let promotedRequesterId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.feedMatchRequest.delete({
      where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
    });

    if (wasConfirmed) {
      const nextInLine = await tx.feedMatchRequest.findFirst({
        where: { activityPostId: activityId, isWaitlist: true },
        orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
        select: { id: true, requesterId: true },
      });

      if (nextInLine) {
        await tx.feedMatchRequest.update({
          where: { id: nextInLine.id },
          data: { isWaitlist: false },
        });
        promotedRequesterId = nextInLine.requesterId;
      }
    }
  });

  if (promotedRequesterId) {
    await sendPushToUser(
      promotedRequesterId,
      "A spot just opened up — you're in! 🎉",
      `Someone cancelled their spot in "${request.activityPost.title}". Your reservation is confirmed.`,
      { screen: "feed", activityId }
    );
  }

  return NextResponse.json({ ok: true });
}
