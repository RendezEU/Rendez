import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);
  const [posts, myRequests] = await Promise.all([
    prisma.activityPost.findMany({
      where: { isActive: true, expiresAt: { gt: new Date() }, userId: { not: userId } },
      orderBy: { scheduledAt: "asc" },
      take: 30,
      include: {
        user: {
          select: {
            id: true, name: true,
            profile: {
              select: {
                gender: true, birthDate: true, city: true,
                preferredActivities: true, bio: true, intents: true, photoVerified: true,
                promptAnswers: { orderBy: { displayOrder: "asc" }, take: 2 },
                photos: { where: { isPrimary: true }, take: 1 },
              },
            },
          },
        },
        _count: { select: { matchRequests: true } },
      },
    }),
    prisma.feedMatchRequest.findMany({
      where: { requesterId: userId },
      select: { activityPostId: true },
    }),
  ]);

  const myRequestedIds = new Set(myRequests.map((r) => r.activityPostId));

  return NextResponse.json(
    posts.map((p) => ({
      id: p.id,
      activityCategory: p.activityCategory,
      title: p.title,
      description: p.description,
      city: p.city,
      scheduledAt: p.scheduledAt,
      locationName: p.locationName,
      isSpontaneous: p.isSpontaneous,
      maxParticipants: p.maxParticipants,
      activityIntent: p.activityIntent,
      createdAt: p.createdAt,
      creator: p.user,
      requestCount: p._count.matchRequests,
      myRequest: myRequestedIds.has(p.id),
    }))
  );
}

const VALID_ACTIVITIES = ["RUNNING","COFFEE_WALK","DRINKS","TENNIS","HIKING","CYCLING","YOGA","COOKING","MUSEUM","PICNIC","CLIMBING","DANCING"] as const;
const VALID_INTENTS = ["DATING","FRIENDS","NETWORKING","OPEN"] as const;

const schema = z.object({
  activityCategory: z.enum(VALID_ACTIVITIES),
  activityIntent: z.enum(VALID_INTENTS).optional().default("OPEN"),
  title: z.string().min(1).max(100).transform((s) => s.trim()),
  description: z.string().max(600).nullish().transform((v) => v ?? undefined),
  scheduledAt: z.string().nullish().transform((v) => v ?? undefined),
  locationName: z.string().nullish().transform((v) => v ?? undefined),
  city: z.string().min(1).transform((s) => s.trim()),
  isSpontaneous: z.boolean().optional().default(false),
  maxParticipants: z.number().int().min(1).max(6).optional().default(1),
});

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error("POST /api/activities validation error", JSON.stringify(parsed.error.flatten()));
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const isSpontaneous = parsed.data.isSpontaneous ?? false;
  const now = new Date();

  let scheduled: Date;
  let expiresAt: Date;
  if (isSpontaneous) {
    // Spontaneous: "free now" — starts now, expires in 3 hours
    scheduled = now;
    expiresAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  } else {
    if (!parsed.data.scheduledAt) return NextResponse.json({ error: "scheduledAt required." }, { status: 400 });
    scheduled = new Date(parsed.data.scheduledAt);
    expiresAt = scheduled;
  }

  const post = await prisma.activityPost.create({
    data: {
      userId: userId,
      activityCategory: parsed.data.activityCategory,
      activityIntent: parsed.data.activityIntent,
      title: parsed.data.title,
      description: parsed.data.description,
      scheduledAt: scheduled,
      locationName: parsed.data.locationName,
      city: parsed.data.city,
      isSpontaneous,
      maxParticipants: parsed.data.maxParticipants ?? 1,
      expiresAt,
    },
  });

  return NextResponse.json(post, { status: 201 });
}
