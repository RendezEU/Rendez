import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Anthropic from "@anthropic-ai/sdk";

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

  const prompt = `You are generating "this or that" icebreaker questions for two people who matched on Rendez, an activity-based dating app. They are about to meet for ${activity}.

Their profiles:

${me.name}:
${me.profile?.promptAnswers.length ? formatAnswers(me.profile.promptAnswers) : "No prompts answered yet."}
Interests: ${me.profile?.preferredActivities.join(", ") ?? "none listed"}

${them.name}:
${them.profile?.promptAnswers.length ? formatAnswers(them.profile.promptAnswers) : "No prompts answered yet."}
Interests: ${them.profile?.preferredActivities.join(", ") ?? "none listed"}

Generate exactly 4 "this or that" style questions that ${me.name} could ask ${them.name}.
Rules:
- Each must be a binary choice question with exactly two options, e.g. "Tea or coffee?", "Early bird or night owl?", "Mountains or beach?"
- At least one should be tied to their upcoming ${activity} activity
- At least one should reference something from ${them.name}'s profile answers or interests
- Keep each question under 50 characters
- Fun, light, no pressure — these are conversation sparks not interview questions
- Format: "Option A or Option B?" — always end with a question mark

Respond with a JSON array only, no markdown:
["question 1", "question 2", "question 3", "question 4"]`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const match2 = text.match(/\[[\s\S]*\]/);
    const starters: string[] = match2 ? JSON.parse(match2[0]) : [];

    return NextResponse.json({ starters: starters.slice(0, 4) });
  } catch {
    return NextResponse.json({ starters: [] });
  }
}
