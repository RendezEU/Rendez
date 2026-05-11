import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { geocodeCity } from "@/lib/geocode";
import { z } from "zod";

const schema = z.object({
  birthDate: z.string(),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY"]),
  genderPreferences: z.array(z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY"])).min(1),
  city: z.string().min(1),
  maxDistanceKm: z.number().min(1).max(500).default(25),
});

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });

  const { birthDate, gender, genderPreferences, city, maxDistanceKm } = parsed.data;

  const coords = await geocodeCity(city);

  await prisma.profile.upsert({
    where: { userId: userId },
    create: {
      userId: userId,
      birthDate: new Date(birthDate),
      gender,
      genderPreferences,
      city,
      maxDistanceKm,
      intent: "OPEN",
      personalityScore: 5,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    },
    update: {
      birthDate: new Date(birthDate),
      gender,
      genderPreferences,
      city,
      maxDistanceKm,
      ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStep: Math.max(1, 1) },
  });

  return NextResponse.json({ ok: true });
}
