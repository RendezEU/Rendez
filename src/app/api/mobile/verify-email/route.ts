import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { verifyMobileToken, extractBearerToken } from "@/lib/auth/mobile";
import { generateOtp, sendVerificationEmail } from "@/lib/email";
import { checkRateLimit, pruneRateLimitStore } from "@/lib/rate-limit";
import { z } from "zod";

const verifySchema = z.object({ code: z.string().length(6) });
const resendSchema = z.object({ resend: z.literal(true) });

// 5 OTP attempts per 15 minutes per IP — prevents brute-forcing 6-digit codes
const OTP_ATTEMPT_LIMIT = 5;
// 3 resend requests per 15 minutes per IP — prevents email spam
const OTP_RESEND_LIMIT = 3;
const OTP_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/mobile/verify-email
 * Body { code: "123456" }  → verifies the OTP sent at registration
 * Body { resend: true }    → sends a fresh OTP to the authenticated user's email
 */
export async function POST(req: Request) {
  try {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  pruneRateLimitStore(OTP_WINDOW_MS);

  const token = extractBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const userId = await verifyMobileToken(token);
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerified: true, otpCode: true, otpExpiry: true },
  });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json();

  // ── Resend path ─────────────────────────────────────────────────────────────
  const resendParsed = resendSchema.safeParse(body);
  if (resendParsed.success) {
    if (!(await checkRateLimit(`otp-resend:${ip}`, OTP_RESEND_LIMIT, OTP_WINDOW_MS))) {
      return NextResponse.json(
        { error: "Too many resend requests. Please wait 15 minutes." },
        { status: 429 }
      );
    }
    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { otpCode: otp, otpExpiry } });
    sendVerificationEmail(user.email, user.name ?? "there", otp).catch((err) =>
      console.error("Failed to resend verification email:", err)
    );
    return NextResponse.json({ ok: true, message: "Verification code sent." });
  }

  // ── Verify path ─────────────────────────────────────────────────────────────
  if (!(await checkRateLimit(`otp-verify:${ip}`, OTP_ATTEMPT_LIMIT, OTP_WINDOW_MS))) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait 15 minutes before trying again." },
      { status: 429 }
    );
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid code format." }, { status: 400 });

  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  if (
    !user.otpCode ||
    !user.otpExpiry ||
    user.otpCode !== parsed.data.code ||
    user.otpExpiry < new Date()
  ) {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: new Date(), otpCode: null, otpExpiry: null },
  });

  return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[verify-email]", err);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
