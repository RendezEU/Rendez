import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const schema = z.object({
  birthDate: z.string(),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY"]),
  genderPreferences: z.array(z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER", "PREFER_NOT_TO_SAY"])).min(1),
  city: z.string().min(1),
  maxDistanceKm: z.number().min(1).max(500).default(25),
});

export async function POST(req: Request) {
  const session = await getRequiredSession();
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });

  const { birthDate, gender, genderPreferences, city, maxDistanceKm } = parsed.data;

  await prisma.profile.upsert({
    where: { userId: session.user?.id as string },
    create: {
      userId: session.user?.id as string,
      birthDate: new Date(birthDate),
      gender,
      genderPreferences,
      city,
      maxDistanceKm,
      intent: "OPEN",
      personalityScore: 5,
    },
    update: { birthDate: new Date(birthDate), gender, genderPreferences, city, maxDistanceKm },
  });

  await prisma.user.update({
    where: { id: session.user?.id as string },
    data: { onboardingStep: Math.max(1, 1) },
  });

  return NextResponse.json({ ok: true });
}
