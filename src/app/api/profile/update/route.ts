import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { geocodeCity } from "@/lib/geocode";
import { z } from "zod";

const GENDER_VALUES = ["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY"] as const;
const INTENT_VALUES = ["CASUAL", "SERIOUS", "OPEN", "FRIENDSHIP", "NETWORKING"] as const;
const DATING_INTENTS = ["CASUAL", "SERIOUS", "OPEN"] as const;

const schema = z.object({
  bio: z.string().max(500).optional(),
  city: z.string().min(1).max(100).optional(),
  intents: z.array(z.enum(INTENT_VALUES)).min(1).optional(),
  personalityScore: z.number().int().min(1).max(10).optional(),
  customActivities: z.string().max(300).optional(),
  genderPreferences: z.array(z.enum(GENDER_VALUES)).optional(),
});

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });

  const { intents, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };

  if (intents) {
    data.intents = intents;
    const primaryDating = intents.find((i) => (DATING_INTENTS as readonly string[]).includes(i));
    data.intent = primaryDating ?? "OPEN";
  }

  if (rest.city) {
    const coords = await geocodeCity(rest.city);
    if (coords) {
      data.latitude = coords.lat;
      data.longitude = coords.lng;
    }
  }

  await prisma.profile.update({ where: { userId }, data: data as never });

  return NextResponse.json({ ok: true });
}
