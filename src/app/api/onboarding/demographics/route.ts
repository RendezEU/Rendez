import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { geocodeCity } from "@/lib/geocode";
import { z } from "zod";

const schema = z.object({
  birthDate: z.string().refine((s) => {
    const d = new Date(s);
    if (isNaN(d.getTime())) return false;
    const ageYears = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return ageYears >= 18;
  }, { message: "You must be at least 18 years old to use Rendez." }),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY"]),
  genderPreferences: z.array(z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY", "FRIENDS"])).min(1).transform((prefs) => prefs),
  city: z.string().min(1),
  maxDistanceKm: z.number().min(1).max(500).default(25),
});

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });

  const { birthDate, gender, genderPreferences, city, maxDistanceKm } = parsed.data;

  // "FRIENDS" is a UI-only option — strip it before saving to the Gender enum column
  // and capture it as an intent flag instead
  const wantsFriends = genderPreferences.includes("FRIENDS");
  const cleanedGenderPrefs = genderPreferences.filter((g) => g !== "FRIENDS") as
    ("MALE" | "FEMALE" | "NON_BINARY" | "OTHER" | "PREFER_NOT_TO_SAY")[];
  // If they only selected Friends with no gender prefs, default to all genders
  const finalGenderPrefs: ("MALE" | "FEMALE" | "NON_BINARY" | "OTHER" | "PREFER_NOT_TO_SAY")[] =
    cleanedGenderPrefs.length > 0
      ? cleanedGenderPrefs
      : ["MALE", "FEMALE", "NON_BINARY", "OTHER"];
  const derivedIntent = wantsFriends ? "FRIENDSHIP" : "OPEN";

  const coords = await geocodeCity(city);

  await prisma.profile.upsert({
    where: { userId: userId },
    create: {
      userId: userId,
      birthDate: new Date(birthDate),
      gender,
      genderPreferences: finalGenderPrefs,
      city,
      maxDistanceKm,
      intent: derivedIntent,
      personalityScore: 5,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    },
    update: {
      birthDate: new Date(birthDate),
      gender,
      genderPreferences: finalGenderPrefs,
      city,
      maxDistanceKm,
      intent: derivedIntent,
      ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStep: Math.max(1, 1) },
  });

  return NextResponse.json({ ok: true });
}
