import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

/**
 * POST /api/mobile/reset-password
 * Validates the OTP, hashes the new password, and clears the OTP.
 * Also marks the email as verified if it wasn't already.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true, otpCode: true, otpExpiry: true, emailVerified: true },
  });

  if (
    !user ||
    !user.otpCode ||
    !user.otpExpiry ||
    user.otpCode !== parsed.data.code ||
    user.otpExpiry < new Date()
  ) {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      otpCode: null,
      otpExpiry: null,
      // Completing a password reset proves email ownership
      emailVerified: user.emailVerified ?? new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
