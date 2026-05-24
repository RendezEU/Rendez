import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { checkRateLimit, pruneRateLimitStore } from "@/lib/rate-limit";
import { generateOtp, sendPasswordResetEmail } from "@/lib/email";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

// 3 reset requests per 15 minutes per IP
const RESET_LIMIT = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/mobile/forgot-password
 * Always returns 200 — never confirms whether the email exists (anti-enumeration).
 */
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  pruneRateLimitStore(RESET_WINDOW_MS);

  if (!(await checkRateLimit(`pwreset:${ip}`, RESET_LIMIT, RESET_WINDOW_MS))) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in 15 minutes." },
      { status: 429 }
    );
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true }); // don't leak validation detail
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true, email: true },
  });

  if (user) {
    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.user.update({ where: { id: user.id }, data: { otpCode: otp, otpExpiry } });
    sendPasswordResetEmail(user.email, otp).catch((err) =>
      console.error("Failed to send password reset email:", err)
    );
  }

  // Always return the same response
  return NextResponse.json({ ok: true });
}
