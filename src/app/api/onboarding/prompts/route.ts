import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import { cookies } from "next/headers";

const VALID_KEYS = ["perfect_sunday","enjoy_meeting","surprisingly_good","conversation_starter","weekend_ritual","deal_breaker","hidden_talent","bucket_list","comfort_zone","life_motto"];

const answerSchema = z.object({
  promptKey: z.string().refine((k) => VALID_KEYS.includes(k)),
  answer: z.string().min(1).max(200),
  displayOrder: z.number().int().min(0),
});

const schema = z.object({ answers: z.array(answerSchema).min(3) });

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Answer at least 3 prompts." }, { status: 400 });

  // NOTE: photos step comes AFTER prompts in the onboarding flow, so we must
  // NOT require a photo here. Photo presence is enforced later (feed visibility).
  const profile = await prisma.profile.findUnique({ where: { userId: userId } });
  if (!profile) return NextResponse.json({ error: "Complete earlier steps first." }, { status: 400 });

  // Upsert each answer
  for (const a of parsed.data.answers) {
    await prisma.promptAnswer.upsert({
      where: { profileId_promptKey: { profileId: profile.id, promptKey: a.promptKey } },
      create: { profileId: profile.id, promptKey: a.promptKey, answer: a.answer, displayOrder: a.displayOrder },
      update: { answer: a.answer, displayOrder: a.displayOrder },
    });
  }

  // Mark onboarding complete
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingComplete: true, onboardingStep: 6 },
  });

  // Set cookie for middleware
  const cookieStore = await cookies();
  cookieStore.set("onboarding_complete", "true", { httpOnly: false, path: "/", maxAge: 60 * 60 * 24 * 365 });

  return NextResponse.json({ ok: true });
}
