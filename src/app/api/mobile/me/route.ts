import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { verifyMobileToken, extractBearerToken } from "@/lib/auth/mobile";

export async function GET(req: Request) {
  const token = extractBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const userId = await verifyMobileToken(token);
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: { include: { photos: true, promptAnswers: true } },
      billing: true,
      reputation: true,
      availabilitySlots: true,
    },
  });

  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    onboardingComplete: user.onboardingComplete,
    tier: user.billing?.tier ?? "FREE",
    matchCredits: (user.billing?.freeCreditsRemaining ?? 0) + (user.billing?.purchasedCredits ?? 0),
    profile: user.profile,
    reputation: user.reputation,
    availabilitySlots: user.availabilitySlots,
  });
}
