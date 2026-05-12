import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { triggerMatchEvent } from "@/lib/pusher/server";
import { sendPushToUser } from "@/lib/push/sendPush";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
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

  const activity = match.activityCategory?.replace(/_/g, " ").toLowerCase() ?? "a date";

  const prompt = `You are crafting ice breaker questions for two people who just matched on Rendez, an activity-based dating app. They'll meet for ${activity}.

Their profiles:

${me.name}:
${me.profile?.promptAnswers.length ? formatAnswers(me.profile.promptAnswers) : "No prompts yet."}
Interests: ${me.profile?.preferredActivities.join(", ") ?? "none"}

${them.name}:
${them.profile?.promptAnswers.length ? formatAnswers(them.profile.promptAnswers) : "No prompts yet."}
Interests: ${them.profile?.preferredActivities.join(", ") ?? "none"}

Generate exactly 5 ice breaker questions that feel fresh and human — not generic dating app clichés.

Mix these styles:
- 1-2 "this or that" binary choices that feel specific to their situation or ${activity}
- 1-2 imaginative reveals (surprising, slightly funny, a little vulnerable — e.g. "What's the last thing you Googled at 2am?", "Best excuse you've ever used to cancel plans?")
- 1 activity-specific question tied directly to their upcoming ${activity}

Rules:
- Each question under 65 characters
- No clichéd questions like "favorite movie" or "what do you do for fun"
- If their profiles hint at something interesting, use it — make it feel personal
- Avoid yes/no questions unless they're "would you rather" style with two options
- Tone: warm, curious, a little playful — like a friend asking, not an interviewer

Respond with a JSON array only, no markdown:
["question 1", "question 2", "question 3", "question 4", "question 5"]`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const found = text.match(/\[[\s\S]*\]/);
    const starters: string[] = found ? JSON.parse(found[0]) : [];

    return NextResponse.json({ starters: starters.slice(0, 5) });
  } catch {
    return NextResponse.json({ starters: [] });
  }
}

const postSchema = z.object({ question: z.string().min(5).max(200) });

export async function POST(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;
  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // 1 icebreaker per user per match
  const existing = await prisma.systemAction.findFirst({
    where: { matchId, initiatorId: userId, actionType: "ICEBREAKER_QUESTION" },
  });
  if (existing) return NextResponse.json({ error: "Already sent an ice breaker." }, { status: 409 });

  const action = await prisma.systemAction.create({
    data: {
      matchId,
      initiatorId: userId,
      actionType: "ICEBREAKER_QUESTION",
      payload: { question: parsed.data.question },
    },
  });

  const recipientId = match.userAId === userId ? match.userBId : match.userAId;
  const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  await triggerMatchEvent(matchId, "system-action", action);
  await sendPushToUser(
    recipientId,
    `${sender?.name ?? "Your match"} sent an ice breaker 🧊`,
    parsed.data.question,
    { matchId, screen: "matches" }
  );

  return NextResponse.json(action, { status: 201 });
}
