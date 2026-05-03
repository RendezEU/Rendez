import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const schema = z.object({ intent: z.enum(["CASUAL", "SERIOUS", "OPEN"]) });

export async function POST(req: Request) {
  const session = await getRequiredSession();
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  await prisma.profile.update({
    where: { userId: session.user.id },
    data: { intent: parsed.data.intent },
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { onboardingStep: 2 },
  });

  return NextResponse.json({ ok: true });
}
