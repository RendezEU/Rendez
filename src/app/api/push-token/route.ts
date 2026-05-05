import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const schema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  await prisma.pushToken.upsert({
    where: { token: parsed.data.token },
    update: { userId, platform: parsed.data.platform },
    create: { userId, token: parsed.data.token, platform: parsed.data.platform },
  });

  return NextResponse.json({ ok: true });
}
