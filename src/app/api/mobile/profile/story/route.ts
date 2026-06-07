import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { verifyMobileToken, extractBearerToken } from "@/lib/auth/mobile";
import { z } from "zod";

const VALID_KEYS = [
  "perfect_sunday", "enjoy_meeting", "surprisingly_good", "conversation_starter",
  "weekend_ritual", "deal_breaker", "hidden_talent", "bucket_list",
  "comfort_zone", "life_motto",
];

const answerSchema = z.object({
  promptKey: z.string().refine((k) => VALID_KEYS.includes(k), { message: "Invalid prompt key" }),
  answer: z.string().min(1).max(200),
  displayOrder: z.number().int().min(0),
});

const schema = z.object({ answers: z.array(answerSchema).min(1) });

export async function POST(req: Request) {
  try {
    const token = extractBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const userId = await verifyMobileToken(token);
    if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Add at least one prompt answer." }, { status: 400 });

    const profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

    for (const a of parsed.data.answers) {
      await prisma.promptAnswer.upsert({
        where: { profileId_promptKey: { profileId: profile.id, promptKey: a.promptKey } },
        create: { profileId: profile.id, promptKey: a.promptKey, answer: a.answer, displayOrder: a.displayOrder },
        update: { answer: a.answer, displayOrder: a.displayOrder },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[profile/story]", err);
    return NextResponse.json({ error: "Failed to save story. Please try again." }, { status: 500 });
  }
}
