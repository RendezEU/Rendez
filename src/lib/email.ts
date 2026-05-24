/**
 * Resend email client.
 * Free tier: 3,000 emails/month, 100/day — no credit card required.
 * Sign up at https://resend.com, get an API key, then add:
 *   RESEND_API_KEY=re_...
 *   FROM_EMAIL=Rendez <noreply@yourdomain.com>    ← must be a verified Resend domain
 * to your .env.local / Vercel environment variables.
 *
 * When RESEND_API_KEY is absent the functions log the OTP to the console
 * so you can test locally without configuring email.
 */

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.FROM_EMAIL ?? "Rendez <noreply@rendez.app>";

// ── Email verification ────────────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  name: string,
  otp: string
): Promise<void> {
  if (!resend) {
    console.log(`[DEV] Email verification OTP for ${to}: ${otp}`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Verify your Rendez email",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;">
        <h2 style="color:#f97316;">Rendez 🪷</h2>
        <p>Hi ${name},</p>
        <p>Use the code below to verify your email address. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;text-align:center;padding:24px 0;color:#111;">
          ${otp}
        </div>
        <p style="color:#888;font-size:13px;">If you didn't create a Rendez account, you can safely ignore this email.</p>
      </div>
    `,
  });
}

// ── Password reset ────────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  otp: string
): Promise<void> {
  if (!resend) {
    console.log(`[DEV] Password reset OTP for ${to}: ${otp}`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Reset your Rendez password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;">
        <h2 style="color:#f97316;">Rendez 🪷</h2>
        <p>Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;text-align:center;padding:24px 0;color:#111;">
          ${otp}
        </div>
        <p style="color:#888;font-size:13px;">If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  });
}

// ── Helper ───────────────────────────────────────────────────────────────────

/** Returns a cryptographically random 6-digit string, zero-padded. */
export function generateOtp(): string {
  // crypto is available in Node 18+ and edge runtimes
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}
