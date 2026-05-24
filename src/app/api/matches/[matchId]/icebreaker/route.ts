import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerMatchEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      userA: {
        select: {
          name: true,
          profile: { select: { promptAnswers: true, preferredActivities: true, intents: true } },
        },
      },
      userB: {
        select: {
          name: true,
          profile: { select: { promptAnswers: true, preferredActivities: true, intents: true } },
        },
      },
    },
  });

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const me = match.userAId === userId ? match.userA : match.userB;
  const them = match.userAId === userId ? match.userB : match.userA;

  const formatAnswers = (answers: { promptKey: string; answer: string }[]) =>
    answers.map((a) => `"${a.promptKey}": ${a.answer}`).join("\n");

  const activity = match.activityCategory?.replace(/_/g, " ").toLowerCase() ?? "a Rendez";

  const prompt = `You are writing ice breaker questions for two people who matched on Rendez, an activity-based social app. They'll meet for ${activity}.

Their profiles:

${me.name}:
${me.profile?.promptAnswers.length ? formatAnswers(me.profile.promptAnswers) : "No prompts yet."}
Interests: ${me.profile?.preferredActivities.join(", ") ?? "none"}

${them.name}:
${them.profile?.promptAnswers.length ? formatAnswers(them.profile.promptAnswers) : "No prompts yet."}
Interests: ${them.profile?.preferredActivities.join(", ") ?? "none"}

Generate exactly 5 "this or that" ice breaker questions. Each must have exactly 2 answer options the recipient can tap.

Rules:
- Question text under 55 characters
- Each option under 20 characters (label only, no sentence)
- At least 1 tied to their upcoming ${activity}
- At least 1 referencing something from the profiles above
- Make them feel fresh and specific — avoid "favorite movie", "pets or no pets", obvious clichés
- Add a relevant emoji to each option
- Tone: playful, a little revealing, light

Return a JSON array only, no markdown:
[
  { "question": "Tea or coffee?", "options": ["Tea ☕", "Coffee ☕"] },
  ...
]`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const found = text.match(/\[[\s\S]*\]/);
    const raw: { question: string; options: string[] }[] = found ? JSON.parse(found[0]) : [];
    const questions = raw
      .filter((q) => q.question && Array.isArray(q.options) && q.options.length === 2)
      .slice(0, 5);

    return NextResponse.json({ questions });
  } catch {
    return NextResponse.json({ questions: [] });
  }
}

const postSchema = z.object({
  question: z.string().min(5).max(200),
  options: z.array(z.string().min(1).max(60)).length(2),
});

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { matchId } = await params;
  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // 1 icebreaker question per user per match
  const existing = await prisma.systemAction.findFirst({
    where: { matchId, initiatorId: userId, actionType: "ICEBREAKER_QUESTION" },
  });
  if (existing) return NextResponse.json({ error: "Already sent an ice breaker." }, { status: 409 });

  const action = await prisma.systemAction.create({
    data: {
      matchId,
      initiatorId: userId,
      actionType: "ICEBREAKER_QUESTION",
      payload: { question: parsed.data.question, options: parsed.data.options },
    },
  });

  const recipientId = match.userAId === userId ? match.userBId : match.userAId;
  const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  await triggerMatchEvent(matchId, "system-action", action);
  await sendPushToUser(
    recipientId,
    `${sender?.name ?? "Your match"} sent an ice breaker 🧊`,
    `${parsed.data.question} (${parsed.data.options.join(" or ")})`,
    { matchId, screen: "matches" }
  );

  return NextResponse.json(action, { status: 201 });
}
