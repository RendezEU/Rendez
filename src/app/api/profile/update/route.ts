import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const schema = z.object({
  bio: z.string().max(500).optional(),
  city: z.string().min(1).max(100).optional(),
  intent: z.enum(["CASUAL", "SERIOUS", "OPEN"]).optional(),
  personalityScore: z.number().int().min(1).max(10).optional(),
  customActivities: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });

  await prisma.profile.update({
    where: { userId },
    data: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
