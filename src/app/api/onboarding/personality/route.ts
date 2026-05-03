import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const schema = z.object({ personalityScore: z.number().int().min(1).max(10) });

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  await prisma.profile.update({
    where: { userId: userId },
    data: { personalityScore: parsed.data.personalityScore },
  });

  await prisma.user.update({ where: { id: userId }, data: { onboardingStep: 3 } });

  return NextResponse.json({ ok: true });
}
