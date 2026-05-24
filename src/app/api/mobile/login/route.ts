import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { signMobileToken } from "@/lib/auth/mobile";
import { checkRateLimit, pruneRateLimitStore } from "@/lib/rate-limit";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 10 attempts per 15 minutes per IP
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  // Rate-limit by IP address
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  pruneRateLimitStore(LOGIN_WINDOW_MS);

  if (!(await checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS))) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again in 15 minutes." },
      { status: 429 }
    );
  }

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
