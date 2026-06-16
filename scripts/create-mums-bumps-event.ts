/**
 * One-off script: create a Mums & Bumps Rendez event for this week
 * so it can be previewed in the app without waiting for the Sunday cron.
 *
 * Run with:  npx tsx scripts/create-mums-bumps-event.ts
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

const prisma = new PrismaClient();

const VENUES = [
  "Fitzgerald's Park, Cork",
  "Good Day Deli, Nano Nagle Place, Cork",
  "Idaho Café, North Main Street, Cork",
  "The River Lee Hotel, Cork",
  "Marina Park, Cork",
  "Ballincollig Regional Park, Cork",
  "Naturally Nourished, Cork",
  "Nano Nagle Place, Cork",
  "Bishop Lucey Park, Cork",
  "Sunday's Well, Cork",
  "The Farmgate Café, English Market, Cork",
  "Nash 19, Princes Street, Cork",
  "Carrigaline Court Hotel, Carrigaline, Cork",
  "Carrigaline Town Park, Carrigaline, Cork",
  "Douglas Community Park, Douglas, Cork",
  "Blackrock Village, Cork",
  "Mahon Point Park, Mahon, Cork",
  "Riverstown Park, Glanmire, Cork",
  "Cobh Promenade, Cobh, Cork",
  "The Baking House, Ballincollig, Cork",
];

async function main() {
  // ── Bot user ──────────────────────────────────────────────────────────────
  const BOT_EMAIL = "events@rendez.app";
  let bot = await prisma.user.findUnique({ where: { email: BOT_EMAIL }, select: { id: true } });
  if (!bot) {
    bot = await prisma.user.create({
      data: { email: BOT_EMAIL, name: "Rendez", passwordHash: "", emailVerified: new Date(), onboardingComplete: true },
      select: { id: true },
    });
  }

  // ── Schedule: next Tuesday at 11:00 Irish time (10:00 UTC) ────────────────
  const now = new Date();
  const daysUntilTuesday = (2 - now.getUTCDay() + 7) % 7 || 7; // next Tuesday
  const scheduledAt = new Date(now);
  scheduledAt.setUTCDate(now.getUTCDate() + daysUntilTuesday);
  scheduledAt.setUTCHours(10, 0, 0, 0);

  const expiresAt = new Date(scheduledAt.getTime() + 1.5 * 3600 * 1000);

  // freeAccessAt: now (manually created events are immediately visible to all)
  const freeAccessAt = new Date();

  // ── Venue: pick based on week index ───────────────────────────────────────
  const weekIndex = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
  const venue = VENUES[weekIndex % VENUES.length];

  // ── Generate title + description with Claude Haiku ────────────────────────
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `You are the community events curator for Rendez, a real-life social activity app in Cork, Ireland.

Generate ONE community event for this slot:
Activity: COFFEE WALK
Theme: Mums & bumps morning — a warm, relaxed gathering for new mums and mums-to-be in Cork. Pushchairs and babies very welcome. No agenda, just good coffee and good company.
Venue (already chosen — do not change): ${venue}

TITLE RULES:
- Max 55 characters. Warm and specific.
- Do NOT include any day name or time.

DESCRIPTION RULES:
- One or two sentences, max 200 characters.
- Do NOT mention a specific day or time.
- Reference the venue naturally.
- Be welcoming.

Return ONLY valid JSON:
{ "title": "...", "description": "..." }`,
    }],
  });

  const raw     = (message.content[0] as { type: string; text: string }).text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
  const parsed  = JSON.parse(cleaned) as { title: string; description: string };

  // ── Create the post ───────────────────────────────────────────────────────
  const post = await prisma.activityPost.create({
    data: {
      userId:            bot.id,
      isRendezEvent:     true,
      activityCategory:  "COFFEE_WALK",
      activityIntent:    "FRIENDS",
      title:             parsed.title,
      description:       parsed.description,
      locationName:      venue,
      city:              "Cork",
      scheduledAt,
      expiresAt,
      maxParticipants:   12,
      genderRestriction: "FEMALE",
      isCouplesEvent:    false,
      freeAccessAt,
    },
  });

  console.log("\n✅ Mums & Bumps event created:");
  console.log(`   Title:       ${post.title}`);
  console.log(`   Description: ${post.description}`);
  console.log(`   Venue:       ${venue}`);
  console.log(`   Scheduled:   ${scheduledAt.toISOString()} (${scheduledAt.toUTCString()})`);
  console.log(`   ID:          ${post.id}\n`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
