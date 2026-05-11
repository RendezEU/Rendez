import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

interface WeatherData {
  current_weather?: { temperature?: number; weathercode?: number };
}

const WMO_CODES: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Rain showers", 81: "Rain showers", 82: "Violent showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const userId = await getRequestUserId(req);
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      finalizedPlan: true,
      userA: { select: { name: true, profile: { select: { promptAnswers: true, preferredActivities: true, latitude: true, longitude: true } } } },
      userB: { select: { name: true, profile: { select: { promptAnswers: true, preferredActivities: true, latitude: true, longitude: true } } } },
    },
  });

  if (!match) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (match.userAId !== userId && match.userBId !== userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (!match.finalizedPlan) return NextResponse.json({ error: "No plan yet." }, { status: 400 });

  const me = match.userAId === userId ? match.userA : match.userB;
  const them = match.userAId === userId ? match.userB : match.userA;
  const activity = match.activityCategory?.replace(/_/g, " ").toLowerCase() ?? "date";

  // Weather fetch — use my location if available, else skip
  let weather: string | null = null;
  const lat = me.profile?.latitude ?? them.profile?.latitude;
  const lon = me.profile?.longitude ?? them.profile?.longitude;
  if (lat && lon) {
    try {
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`
      );
      const weatherData = (await weatherRes.json()) as WeatherData;
      const cw = weatherData.current_weather;
      if (cw) {
        const desc = WMO_CODES[cw.weathercode ?? 0] ?? "Unknown";
        weather = `${desc}, ${Math.round(cw.temperature ?? 0)}°C`;
      }
    } catch { /* skip */ }
  }

  // Claude — generate conversation topics
  const formatAnswers = (answers: { promptKey: string; answer: string }[]) =>
    answers.map((a) => `"${a.promptKey}": ${a.answer}`).join("\n");

  const prompt = `You are helping two people prepare for their ${activity} date on Rendez.

${me.name}'s profile:
${me.profile?.promptAnswers?.length ? formatAnswers(me.profile.promptAnswers) : "No prompts."}

${them.name}'s profile:
${them.profile?.promptAnswers?.length ? formatAnswers(them.profile.promptAnswers) : "No prompts."}

Generate exactly 3 conversation starter topics for their date. Make them:
- Specific to their shared interests or profile answers if possible
- Warm, natural, and not interview-like
- Each topic should be 1 sentence framing the subject, not a question
- Keep each under 60 characters

Respond with a JSON array only, no markdown:
["topic 1", "topic 2", "topic 3"]`;

  let topics: string[] = [];
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const m = text.match(/\[[\s\S]*\]/);
    topics = m ? JSON.parse(m[0]) : [];
  } catch { /* ignore */ }

  return NextResponse.json({
    scheduledAt: match.finalizedPlan.scheduledAt,
    locationName: match.finalizedPlan.locationName,
    locationUrl: match.finalizedPlan.locationUrl,
    activity: match.activityCategory,
    otherName: them.name,
    weather,
    topics: topics.slice(0, 3),
  });
}
