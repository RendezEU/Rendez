/**
 * POST /api/cron/rendez-event
 *
 * Runs every Monday at 08:00 (Europe/Dublin).
 * Uses Claude to generate a unique community event for Cork, creates an
 * ActivityPost as the Rendez bot user, scheduled for the coming Thursday
 * at 19:00.  The post is visible in the feed with a special "Rendez Event"
 * banner and expires at 21:30 on Thursday.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import type { ActivityCategory, ActivityIntentType } from "@prisma/client";

// ── Auth ──────────────────────────────────────────────────────────────────────
function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
}

// ── Cork venue catalogue ───────────────────────────────────────────────────────
// Passed to Claude so it picks a realistic, specific location.
const CORK_VENUES = [
  "The Elbow Lane, Cork city centre",
  "Franciscan Well Brewery, Cork",
  "Nano Nagle Place, Cork",
  "Fitzgerald's Park, Cork",
  "Bishop Lucey Park, Cork",
  "English Market, Cork",
  "Grand Parade, Cork city",
  "Douglas Village Square, Cork",
  "The Shelbourne Bar, Cork",
  "Blarney Woollen Mills, Cork",
  "Lifetime Lab, Cork",
  "The Mutton Lane Inn, Cork",
  "UCC Quad, Cork",
  "Blackrock Castle, Cork",
  "River Lee Hotel terrace, Cork",
].join("\n");

// ── Theme bank ─────────────────────────────────────────────────────────────────
// Claude picks one per week (using date as seed so it doesn't repeat).
const THEMES = [
  "Expats & internationals living in Cork — casual drinks and introductions",
  "Newly moved to Cork welcome evening — meet locals and fellow newcomers",
  "Group run through Cork city (beginner-friendly, 5 km, scenic route)",
  "Young professionals networking in Cork — no business cards, just people",
  "Language exchange evening — practice any language, all levels welcome",
  "Couples' social evening — meet other couples, board games or trivia",
  "Photography walk around Cork city — bring your phone or camera",
  "Morning coffee and book chat — bring a book or just your curiosity",
  "Cultural exchange dinner — bring a dish or story from your home country",
  "Outdoor beginners' hike at Blarney / Gougane Barra for Cork-based people",
  "Solo travellers & remote workers in Cork — co-working coffee morning",
  "Creative arts evening — sketch, paint, or craft in a relaxed group",
  "Board games night at a Cork pub — teams of 4, all games provided",
  "Sunday morning group cycle along the Lee Fields",
  "Wellness walk & mindful chat around Fitzgerald's Park",
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function nextThursdayAt19(fromMonday: Date): Date {
  // fromMonday should be a Monday; Thursday is 3 days later
  const d = new Date(fromMonday);
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(19, 0, 0, 0);
  return d;
}

function thursdayExpiry(thursday: Date): Date {
  const d = new Date(thursday);
  d.setUTCHours(21, 30, 0, 0);
  return d;
}

/** Upsert the Rendez bot user, return its ID */
async function getBotUserId(): Promise<string> {
  const BOT_EMAIL = "events@rendez.app";

  const existing = await prisma.user.findUnique({
    where: { email: BOT_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Create a minimal bot user — no profile needed because the feed detail page
  // shows special Rendez branding for isRendezEvent posts instead of a real profile.
  const created = await prisma.user.create({
    data: {
      email: BOT_EMAIL,
      name: "Rendez",
      passwordHash: "", // no login — bot account only
      emailVerified: new Date(),
      onboardingComplete: true,
    },
    select: { id: true },
  });

  return created.id;
}

// ── Claude event generation ────────────────────────────────────────────────────
interface GeneratedEvent {
  title: string;
  description: string;
  activityCategory: ActivityCategory;
  locationName: string;
  maxParticipants: number;
  activityIntent: ActivityIntentType;
}

async function generateEvent(weekOffset: number): Promise<GeneratedEvent> {
  const client = new Anthropic();
  const theme = THEMES[weekOffset % THEMES.length];

  const prompt = `You are the community events curator for Rendez, a real-life social activity app launching in Cork, Ireland.

Your task: generate ONE Thursday evening community event (19:00–21:30) based on this week's theme:
"${theme}"

Choose an appropriate location from this list of real Cork venues and spaces:
${CORK_VENUES}

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "title": "Short, warm, specific event title (max 55 characters)",
  "description": "One or two sentences (max 220 chars) describing the vibe, who it's for, and what to expect. Be welcoming and specific.",
  "activityCategory": "<one of: RUNNING | COFFEE_WALK | DRINKS | DOG_WALKING | HIKING | CYCLING | YOGA | COOKING | MUSEUM | PICNIC | CLIMBING | DANCING>",
  "locationName": "<exact venue name from the list above>",
  "maxParticipants": <integer between 8 and 16, choose based on the activity type — 8 for runs/active, 12 for social, 14-16 for networking>,
  "activityIntent": "<one of: FRIENDS | NETWORKING | OPEN>"
}`;

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  // Strip any accidental markdown code fences
  const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as GeneratedEvent;
  return parsed;
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();

  // Only proceed if today is Monday (0 = Sunday, 1 = Monday, ...)
  // Vercel cron fires at 08:00 Mon but allow manual triggers any day for testing
  const isManual = req.headers.get("x-manual-trigger") === "true";
  if (!isManual && now.getUTCDay() !== 1) {
    return NextResponse.json({ skipped: true, reason: "Not Monday" });
  }

  // Deduplicate: skip if there's already a Rendez event scheduled for this Thursday
  const thursday = nextThursdayAt19(now);
  const windowStart = new Date(thursday); windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd   = new Date(thursday); windowEnd.setUTCHours(23, 59, 59, 999);

  const existing = await prisma.activityPost.findFirst({
    where: {
      isRendezEvent: true,
      scheduledAt: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ skipped: true, reason: "Event already exists for this Thursday", eventId: existing.id });
  }

  // Week index (weeks since epoch) used to cycle through themes deterministically
  const weekIndex = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));

  const [botUserId, event] = await Promise.all([
    getBotUserId(),
    generateEvent(weekIndex),
  ]);

  const expiresAt = thursdayExpiry(thursday);

  const post = await prisma.activityPost.create({
    data: {
      userId: botUserId,
      isRendezEvent: true,
      activityCategory: event.activityCategory,
      activityIntent: event.activityIntent,
      title: event.title,
      description: event.description,
      scheduledAt: thursday,
      locationName: event.locationName,
      city: "Cork",
      maxParticipants: event.maxParticipants,
      expiresAt,
    },
    select: { id: true, title: true, scheduledAt: true, maxParticipants: true },
  });

  console.log("[rendez-event] Created weekly event:", post);

  return NextResponse.json({ ok: true, event: post });
}
