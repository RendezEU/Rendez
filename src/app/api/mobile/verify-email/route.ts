import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { verifyMobileToken, extractBearerToken } from "@/lib/auth/mobile";
import { generateOtp, sendVerificationEmail } from "@/lib/email";
import { z } from "zod";

const verifySchema = z.object({ code: z.string().length(6) });
const resendSchema = z.object({ resend: z.literal(true) });

/**
 * POST /api/mobile/verify-email
 * Body { code: "123456" }  → verifies the OTP sent at registration
 * Body { resend: true }    → sends a fresh OTP to the authenticated user's email
 */
export async function POST(req: Request) {
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
    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { otpCode: otp, otpExpiry } });
    sendVerificationEmail(user.email, user.name ?? "there", otp).catch((err) =>
      console.error("Failed to resend verification email:", err)
    );
    return NextResponse.json({ ok: true, message: "Verification code sent." });
  }

  // ── Verify path ─────────────────────────────────────────────────────────────
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
}
