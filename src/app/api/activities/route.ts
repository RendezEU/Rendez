import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

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
