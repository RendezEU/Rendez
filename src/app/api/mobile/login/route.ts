import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { signMobileToken } from "@/lib/auth/mobile";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { profile: true, billing: true },
  });

  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = await signMobileToken(user.id);

  return NextResponse.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      onboardingComplete: user.onboardingComplete,
      tier: user.billing?.tier ?? "FREE",
      matchCredits: (user.billing?.freeCreditsRemaining ?? 0) + (user.billing?.purchasedCredits ?? 0),
    },
  });
}
