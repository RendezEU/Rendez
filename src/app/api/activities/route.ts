import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);
  const posts = await prisma.activityPost.findMany({
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
              preferredActivities: true, bio: true,
              promptAnswers: { orderBy: { displayOrder: "asc" }, take: 2 },
              photos: { where: { isPrimary: true }, take: 1 },
            },
          },
        },
      },
      _count: { select: { matchRequests: true } },
    },
  });

  return NextResponse.json(
    posts.map((p) => ({
      id: p.id,
      activityCategory: p.activityCategory,
      title: p.title,
      description: p.description,
      city: p.city,
      scheduledAt: p.scheduledAt,
      locationName: p.locationName,
      maxParticipants: 1,
      createdAt: p.createdAt,
      creator: p.user,
      _count: p._count,
    }))
  );
}

const VALID_ACTIVITIES = ["RUNNING","COFFEE_WALK","DRINKS","TENNIS","HIKING","CYCLING","YOGA","COOKING","MUSEUM","PICNIC","CLIMBING","DANCING"] as const;

const schema = z.object({
  activityCategory: z.enum(VALID_ACTIVITIES),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scheduledAt: z.string(),
  locationName: z.string().optional(),
  city: z.string().min(1),
});

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const scheduled = new Date(parsed.data.scheduledAt);

  const post = await prisma.activityPost.create({
    data: {
      userId: userId,
      activityCategory: parsed.data.activityCategory,
      title: parsed.data.title,
      description: parsed.data.description,
      scheduledAt: scheduled,
      locationName: parsed.data.locationName,
      city: parsed.data.city,
      expiresAt: scheduled, // expires when the activity is scheduled
    },
  });

  return NextResponse.json(post, { status: 201 });
}
