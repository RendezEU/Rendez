import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { signMobileToken } from "@/lib/auth/mobile";
import { generateOtp, sendVerificationEmail } from "@/lib/email";
import { checkRateLimit, pruneRateLimitStore } from "@/lib/rate-limit";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// 10 registration attempts per hour per IP — prevents account flooding / email enumeration
const REGISTER_LIMIT = 10;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  pruneRateLimitStore(REGISTER_WINDOW_MS);

  if (!(await checkRateLimit(`register:${ip}`, REGISTER_LIMIT, REGISTER_WINDOW_MS))) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again in an hour." },
      { status: 429 }
    );
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, name: true, passwordHash: true, emailVerified: true, billing: true },
  });

  if (existing) {
    if (existing.emailVerified) {
      // Fully verified account — tell them to sign in
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in.", code: "ALREADY_VERIFIED" },
        { status: 409 }
      );
    }

    // Unverified account — validate their password so we don't let strangers
    // hijack the slot, then resend the OTP and hand back a fresh token so
    // the app can drop them straight onto the verify-email screen.
    const passwordMatches = existing.passwordHash
      ? await bcrypt.compare(parsed.data.password, existing.passwordHash)
      : false;

    if (!passwordMatches) {
      return NextResponse.json(
        { error: "You already started registration with this email. Please sign in to continue.", code: "UNVERIFIED_EXISTS" },
        { status: 409 }
      );
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.user.update({ where: { id: existing.id }, data: { otpCode: otp, otpExpiry } });
    sendVerificationEmail(parsed.data.email, existing.name ?? "there", otp).catch((err) =>
      console.error("Failed to resend verification email:", err)
    );
    const token = await signMobileToken(existing.id);
    return NextResponse.json(
      {
        token,
        user: {
          id: existing.id,
          email: parsed.data.email,
          name: existing.name,
          onboardingComplete: false,
          tier: existing.billing ? "FREE" : "FREE",
          matchCredits: 3,
        },
        emailVerificationSent: true,
      },
      { status: 200 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const otp = generateOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      otpCode: otp,
      otpExpiry,
      billing: { create: { freeCreditsRemaining: 3 } },
    },
  });

  // Fire-and-forget — don't block registration if email fails
  sendVerificationEmail(parsed.data.email, parsed.data.name, otp).catch((err) =>
    console.error("Failed to send verification email:", err)
  );

  const token = await signMobileToken(user.id);

  return NextResponse.json(
    {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        onboardingComplete: false,
        tier: "FREE",
        matchCredits: 3,
      },
      emailVerificationSent: true,
    },
    { status: 201 }
  );
  } catch (err) {
    console.error("[register]", err);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}
