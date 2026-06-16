/**
 * POST /api/cron/rendez-event
 *
 * Runs every Monday at 08:00 (Europe/Dublin).
 *
 * Generates 12 Rendez events for the coming week — one per activity category,
 * each on a day/time that fits the activity type (morning runs on Saturday,
 * drinks on Thursday evening, etc.).
 *
 * Users see ALL 12 events in Explore, but the Activities API sorts them so the
 * ones matching the user's preferredActivities float to the top of the carousel.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { geocodeVenueName } from "@/lib/geocode";
import type { ActivityCategory, ActivityIntentType } from "@prisma/client";

// ── Auth ──────────────────────────────────────────────────────────────────────
function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
}

// ── Cork venue catalogue — grouped by the type of activity they suit ──────────
//
// Rule: Claude must only choose from the list provided for the event's category.
// This prevents mismatches like yoga at a brewery or a dinner at a park.
//
const VENUES_BY_CATEGORY: Record<string, string[]> = {
  RUNNING: [
    "Lee Fields, Cork",
    "Fitzgerald's Park, Cork",
    "Ballincollig Regional Park, Cork",
    "Bishop Lucey Park, Cork",
    "Marina Park, Cork",
    "Blackrock Castle, Cork",
    "Tramore Valley Park, Cork",
    "Mardyke Walk, Cork",
    "Sunday's Well, Cork",
    "Cork City Gaol grounds",
  ],
  COFFEE_WALK: [
    "Fitzgerald's Park, Cork",
    "Bishop Lucey Park, Cork",
    "Lee Fields, Cork",
    "Nano Nagle Place gardens, Cork",
    "Ballincollig Regional Park, Cork",
    "Sunday's Well, Cork",
    "Marina Park, Cork",
    "Filter, George's Quay, Cork",
    "SOMA Coffee Company, Tuckey Street, Cork",
    "Good Day Deli, Nano Nagle Place, Cork",
    "Three Fools Coffee, Grand Parade, Cork",
    "Cork Coffee Roasters, French Church Street, Cork",
    "Lab 82 Coffee, Cork",
    "Izz Café, Georges Quay, Cork",
    "Idaho Café, North Main Street, Cork",
  ],
  DRINKS: [
    "The Mutton Lane Inn, Cork",
    "The Long Valley, Winthrop Street, Cork",
    "The Oval, Cork",
    "Le Chateau, Patrick Street, Cork",
    "The Castle Inn, South Main Street, Cork",
    "Sin É, Coburg Street, Cork",
    "Tom Barry's, Barrack Street, Cork",
    "Clancy's, Princes Street, Cork",
    "Dan Lowrey's, MacCurtain Street, Cork",
    "The Roundy, Castle Street, Cork",
    "Franciscan Well Brewery, North Mall, Cork",
    "Bierhaus, Popes Quay, Cork",
    "Cask, MacCurtain Street, Cork",
    "Monk Cocktail Bar, North Mall, Cork",
    "Deep South, Grand Parade, Cork",
    "Impala, Liberty Street, Cork",
    "Sober Lane, Sullivan's Quay, Cork",
    "Goldbergs, Victoria Road, Cork",
    "The Woodford, Cork",
    "Dwyers of Cork, Washington Street, Cork",
    "The Bodega, Cornmarket Street, Cork",
    "The Oliver Plunkett, Oliver Plunkett Street, Cork",
    "Reardens, Washington Street, Cork",
    "Coughlan's, Douglas Street, Cork",
    "The Shelbourne Bar, MacCurtain Street, Cork",
    "Electric Bar & Restaurant, South Mall, Cork",
    "Gallaghers, MacCurtain Street, Cork",
    "Crane Lane Theatre, Cork",
    "The Elbow Lane, Cork city centre",
    "Market Lane, Oliver Plunkett Street, Cork",
    "SpitJack, Washington Street, Cork",
    "Café Mexicana, Carey's Lane, Cork",
    "Goldie, Cook Street, Cork",
    "Jacobs on the Mall, South Mall, Cork",
    "Strasbourg Goose, French Church Street, Cork",
    "Idaho Café, North Main Street, Cork",
    "River Lee Hotel, Cork",
    "Izz Café, Georges Quay, Cork",
  ],
  NETWORKING: [
    "Cask, MacCurtain Street, Cork",
    "Monk Cocktail Bar, North Mall, Cork",
    "Electric Bar & Restaurant, South Mall, Cork",
    "Dwyers of Cork, Washington Street, Cork",
    "Bierhaus, Popes Quay, Cork",
    "Impala, Liberty Street, Cork",
    "The Woodford, Cork",
    "Market Lane, Oliver Plunkett Street, Cork",
    "SpitJack, Washington Street, Cork",
    "River Lee Hotel, Cork",
    "Sophie's Rooftop, The Dean Cork, Horgan's Quay",
    "The Oliver Plunkett, Oliver Plunkett Street, Cork",
    "Goldbergs, Victoria Road, Cork",
    "Sober Lane, Sullivan's Quay, Cork",
  ],
  DOG_WALKING: [
    "Fitzgerald's Park, Cork",
    "Lee Fields, Cork",
    "Ballincollig Regional Park, Cork",
    "Bishop Lucey Park, Cork",
    "Marina Park, Cork",
    "Tramore Valley Park, Cork",
    "Blackrock, Cork",
    "Sunday's Well, Cork",
    "Blarney Castle grounds, Cork",
    "Cork City Gaol grounds",
  ],
  HIKING: [
    "Ballincollig Regional Park, Cork",
    "Lee Fields, Cork",
    "Blackrock Castle, Cork",
    "Cork City Gaol grounds",
    "Marina Park, Cork",
    "Tramore Valley Park, Cork",
    "Blarney Castle grounds, Cork",
    "Sunday's Well, Cork",
    "Fitzgerald's Park, Cork",
    "Old Crosshaven Railway Path, Cork",
  ],
  CYCLING: [
    "Lee Fields, Cork",
    "Ballincollig Regional Park, Cork",
    "Marina Park, Cork",
    "Blackrock, Cork",
    "Mardyke Walk, Cork",
    "Old Crosshaven Railway Path, Cork",
    "Tramore Valley Park, Cork",
  ],
  YOGA: [
    "Fitzgerald's Park, Cork",
    "Bishop Lucey Park, Cork",
    "Lee Fields, Cork",
    "Nano Nagle Place gardens, Cork",
    "Marina Park, Cork",
    "Ballincollig Regional Park, Cork",
    "UCC Quad, Cork",
    "Tramore Valley Park, Cork",
  ],
  DINNER: [
    "The Elbow Lane, Cork city centre",
    "Market Lane, Oliver Plunkett Street, Cork",
    "SpitJack, Washington Street, Cork",
    "Son of a Bun, MacCurtain Street, Cork",
    "Café Mexicana, Carey's Lane, Cork",
    "Goldie, Cook Street, Cork",
    "Jacobs on the Mall, South Mall, Cork",
    "Strasbourg Goose, French Church Street, Cork",
    "Idaho Café, North Main Street, Cork",
    "River Lee Hotel, Cork",
    "Electric Bar & Restaurant, South Mall, Cork",
    "Dwyers of Cork, Washington Street, Cork",
    "Izz Café, Georges Quay, Cork",
    "Franciscan Well Brewery, North Mall, Cork",
    "Gallaghers, MacCurtain Street, Cork",
    "Sober Lane, Sullivan's Quay, Cork",
    "The Mutton Lane Inn, Cork",
    "The Long Valley, Winthrop Street, Cork",
    "Tom Barry's, Barrack Street, Cork",
    "Clancy's, Princes Street, Cork",
    "Impala, Liberty Street, Cork",
    "The Woodford, Cork",
    "The Bodega, Cornmarket Street, Cork",
    "The Oliver Plunkett, Oliver Plunkett Street, Cork",
    "Coughlan's, Douglas Street, Cork",
    "The Shelbourne Bar, MacCurtain Street, Cork",
    "Reardens, Washington Street, Cork",
    "Cask, MacCurtain Street, Cork",
    "Deep South, Grand Parade, Cork",
    "Dan Lowrey's, MacCurtain Street, Cork",
    "Le Chateau, Patrick Street, Cork",
    "The Dean Cork, Horgan's Quay",
    "Montenotte Hotel, Middle Glanmire Road, Cork",
    "The Imperial Hotel, South Mall, Cork",
  ],
  MUSEUM: [
    "The Crawford Art Gallery, Cork",
    "Lifetime Lab, Cork",
    "Blackrock Castle Observatory, Cork",
    "Cork City Gaol, Cork",
    "Nano Nagle Place, Cork",
    "Cork Public Museum, Fitzgerald's Park",
  ],
  PICNIC: [
    "Fitzgerald's Park, Cork",
    "Bishop Lucey Park, Cork",
    "Lee Fields, Cork",
    "Ballincollig Regional Park, Cork",
    "Marina Park, Cork",
    "Tramore Valley Park, Cork",
    "UCC Quad, Cork",
    "Sunday's Well, Cork",
  ],
  DANCING: [
    "Voodoo Rooms, Oliver Plunkett Street, Cork",
    "Cyprus Avenue, Caroline Street, Cork",
    "Dali, Lavitt's Quay, Cork",
    "The Pav, Carey's Lane, Cork",
    "An Bróg, Oliver Plunkett Street, Cork",
    "Chambers, Washington Street, Cork",
    "Club D'Ville, Cork",
    "The Savoy, Patrick Street, Cork",
    "The Bodega, Cornmarket Street, Cork",
    "Crane Lane Theatre, Cork",
    "Coughlan's, Douglas Street, Cork",
    "Reardens, Washington Street, Cork",
    "Sin É, Coburg Street, Cork",
    "The Oliver Plunkett, Oliver Plunkett Street, Cork",
  ],
  BRUNCH: [
    "Filter, George's Quay, Cork",
    "Idaho Café, North Main Street, Cork",
    "Good Day Deli, Nano Nagle Place, Cork",
    "Nano Nagle Place, Cork",
    "SOMA Coffee Company, Tuckey Street, Cork",
    "Izz Café, Georges Quay, Cork",
    "Liberty Grill, Washington Street, Cork",
    "The Farmgate Café, English Market, Cork",
    "Orso, Pembroke Street, Cork",
    "Wildberry Café, Cork",
    "Café Mexicana, Carey's Lane, Cork",
    "Nash 19, Princes Street, Cork",
    "The River Lee Hotel, Cork",
    "Market Lane, Oliver Plunkett Street, Cork",
    "Wagamama Cork, Patrick Street",
    "Elbow Lane, Cork city centre",
    "Naturally Nourished, Cork",
  ],
  LANGUAGE_EXCHANGE: [
    "Filter, George's Quay, Cork",
    "SOMA Coffee Company, Tuckey Street, Cork",
    "Three Fools Coffee, Grand Parade, Cork",
    "Cork Coffee Roasters, French Church Street, Cork",
    "Idaho Café, North Main Street, Cork",
    "Lab 82 Coffee, Cork",
    "Good Day Deli, Nano Nagle Place, Cork",
    "Izz Café, Georges Quay, Cork",
    "Nano Nagle Place, Cork",
    "The River Lee Hotel, Cork",
  ],
};

// ── Event slot definitions ─────────────────────────────────────────────────────
// dayOffset = days after the cron's Monday (1=Tue … 6=Sun)
// hour = UTC hour for scheduled time (Irish time = UTC+1 in summer)
// genderRestriction: null = open to all, "MALE" = men only, "FEMALE" = women only
// isCouplesEvent: participants join as a couple — their +1 partner doesn't need an account
// months: 1–12 array — slot only runs in these months. Omit for year-round events.
//   Cork seasons: outdoor viable Apr–Sep (4–9), summer only Jun–Aug (6–8)
// venueOverrides: use this venue list instead of VENUES_BY_CATEGORY[category].
//   Use when a slot needs specific upscale/themed venues rather than the general list.
const EVENT_SLOTS: Array<{
  category: ActivityCategory;
  intent: ActivityIntentType;
  dayOffset: number;
  hour: number;
  durationHours: number;
  maxParticipants: number;
  themeHint: string;
  genderRestriction?: "MALE" | "FEMALE" | null;
  isCouplesEvent?: boolean;
  months?: number[];
  venueOverrides?: string[];
}> = [
  // ── Open / mixed events ────────────────────────────────────────────────────
  {
    category:  "RUNNING",
    intent:    "FRIENDS",
    dayOffset: 6, hour: 8, durationHours: 1.5,
    maxParticipants: 12,
    // Runners go out year-round in Cork — rain doesn't stop them
    themeHint: "Group Sunday morning run — beginner-friendly 5 km scenic route through Cork",
  },
  {
    category:  "COFFEE_WALK",
    intent:    "OPEN",
    dayOffset: 6, hour: 10, durationHours: 1.5,
    maxParticipants: 8,
    // Year-round — can always duck into a café if it rains
    themeHint: "Casual Sunday morning coffee and walk — meet new people, low pressure",
  },
  {
    category:  "DRINKS",
    intent:    "FRIENDS",
    dayOffset: 3, hour: 19, durationHours: 2.5,
    maxParticipants: 14,
    // Year-round — indoor, weather irrelevant
    themeHint: "Thursday evening social drinks — meet Cork locals, no cliques, easy introductions",
  },
  {
    category:  "DOG_WALKING",
    intent:    "FRIENDS",
    dayOffset: 5, hour: 10, durationHours: 1.5,
    maxParticipants: 10,
    // Year-round — dog owners walk regardless of weather
    themeHint: "Saturday morning group dog walk — bring your dog (or just yourself), meet fellow dog lovers",
  },
  {
    category:  "HIKING",
    intent:    "OPEN",
    dayOffset: 5, hour: 9, durationHours: 3,
    maxParticipants: 12,
    months: [3, 4, 5, 6, 7, 8, 9, 10], // March–October: daylight + reasonable weather
    themeHint: "Saturday morning beginner hike — Cork countryside, scenic views, all welcome",
  },
  {
    category:  "CYCLING",
    intent:    "FRIENDS",
    dayOffset: 5, hour: 9, durationHours: 2,
    maxParticipants: 10,
    months: [4, 5, 6, 7, 8, 9], // April–September: cycling season
    themeHint: "Saturday group cycle — leisurely pace along the River Lee or countryside roads",
  },
  {
    category:  "YOGA",
    intent:    "OPEN",
    dayOffset: 2, hour: 18, durationHours: 1,
    maxParticipants: 12,
    months: [5, 6, 7, 8, 9], // May–September: outdoor yoga only in warm months
    themeHint: "Wednesday evening outdoor yoga — park setting, all levels, bring a mat",
  },
  {
    category:  "DINNER",
    intent:    "FRIENDS",
    dayOffset: 4, hour: 18, durationHours: 2,
    maxParticipants: 8,
    // Year-round — indoor, always relevant
    themeHint: "Friday evening group dinner — shared table, great conversation, meet new people over food",
  },
  {
    category:  "MUSEUM",
    intent:    "OPEN",
    dayOffset: 6, hour: 14, durationHours: 2,
    maxParticipants: 12,
    // Year-round — indoor, always a good option
    themeHint: "Sunday afternoon cultural visit — guided tour or self-guided, great conversation starter",
  },
  {
    category:  "PICNIC",
    intent:    "OPEN",
    dayOffset: 5, hour: 13, durationHours: 2,
    maxParticipants: 16,
    months: [5, 6, 7, 8], // May–August: picnic weather only
    themeHint: "Saturday afternoon community picnic — bring something to share, meet neighbours",
  },
  {
    category:  "DANCING",
    intent:    "OPEN",
    dayOffset: 5, hour: 20, durationHours: 2,
    maxParticipants: 14,
    // Year-round — indoor, great in winter
    themeHint: "Saturday evening social dance — all welcome, no partner needed, no experience required",
  },

  // ── Men's only events ──────────────────────────────────────────────────────
  // Separate slot key: category + genderRestriction so deduplication works
  {
    category:       "RUNNING",
    intent:         "FRIENDS",
    dayOffset:      5, hour: 8, durationHours: 1.5,
    maxParticipants: 12,
    genderRestriction: "MALE",
    // Year-round — runners go out regardless
    themeHint: "Men's only Saturday morning run — motivating group pace, no pressure, all fitness levels welcome",
  },
  {
    category:       "DRINKS",
    intent:         "FRIENDS",
    dayOffset:      4, hour: 20, durationHours: 2.5,
    maxParticipants: 14,
    genderRestriction: "MALE",
    // Year-round — indoor
    themeHint: "Men's social evening — great way to make new mates in Cork without the usual awkward gym small talk",
  },

  // ── Women's only events ────────────────────────────────────────────────────
  {
    category:       "YOGA",
    intent:         "FRIENDS",
    dayOffset:      1, hour: 9, durationHours: 1,
    maxParticipants: 12,
    genderRestriction: "FEMALE",
    months: [5, 6, 7, 8, 9], // May–September: outdoor yoga only
    themeHint: "Women's only Monday morning yoga — calm, welcoming, beginner-friendly, start the week right",
  },
  {
    category:       "COFFEE_WALK",
    intent:         "FRIENDS",
    dayOffset:      2, hour: 10, durationHours: 1.5,
    maxParticipants: 8,
    genderRestriction: "FEMALE",
    // Year-round — coffee indoors if needed
    themeHint: "Women's Wednesday coffee walk — safe relaxed space to chat, share, and meet new people",
  },

  // ── Mums & bumps ──────────────────────────────────────────────────────────
  {
    category:          "COFFEE_WALK",
    intent:            "FRIENDS",
    dayOffset:         1, hour: 10, durationHours: 1.5, // Tuesday 11:00 Irish time
    maxParticipants:   12,
    genderRestriction: "FEMALE",
    // Year-round — indoor café fallback on rainy days
    themeHint: "Mums & bumps morning — a warm, relaxed gathering for new mums and mums-to-be in Cork. Pushchairs and babies very welcome. No agenda, just good coffee and good company.",
    venueOverrides: [
      // Ballincollig — park walk + coffee truck on site, pushchair-friendly paths
      "Ballincollig Regional Park, Cork",
      // Blackrock — waterfront walk + great café options in the village
      "Blackrock Castle, Cork",
      "Blackrock Village, Cork",
      // City centre parks + nearby cafés
      "Fitzgerald's Park, Cork",
      "Marina Park, Cork",
      "Nano Nagle Place, Cork",
      "Bishop Lucey Park, Cork",
      "Sunday's Well, Cork",
      // City centre cafés that work well for buggies and babies
      "Good Day Deli, Nano Nagle Place, Cork",
      "The Farmgate Café, English Market, Cork",
      "Nash 19, Princes Street, Cork",
      "Idaho Café, North Main Street, Cork",
      // South Cork — park + nearby café
      "Carrigaline Town Park, Carrigaline, Cork",
      "Douglas Community Park, Douglas, Cork",
      "Mahon Point Park, Mahon, Cork",
      // East Cork
      "Riverstown Park, Glanmire, Cork",
      "Cobh Promenade, Cobh, Cork",
    ],
  },

  // ── Extra mixed drinks slot (Friday) — most popular night, guaranteed 3 mixed drinks/week ──
  {
    category:  "DRINKS",
    intent:    "FRIENDS",
    dayOffset: 4, hour: 19, durationHours: 2.5, // Friday 20:00 Irish time
    maxParticipants: 14,
    // Year-round — indoor, Friday is the busiest night
    themeHint: "Friday night social drinks — kick off the weekend, meet new people, no cliques, easy vibes",
  },

  // ── Networking / young professionals ──────────────────────────────────────
  {
    category:  "NETWORKING",
    intent:    "NETWORKING",
    dayOffset: 2, hour: 18, durationHours: 2, // Wednesday 19:00 Irish time
    maxParticipants: 16,
    // Year-round — indoor, classic midweek after-work networking slot
    themeHint: "Young professionals midweek drinks — share experiences, swap ideas, grow your Cork network in a relaxed setting. No pitch decks, just good conversation.",
  },

  // ── Upscale social events ──────────────────────────────────────────────────
  {
    category:  "DRINKS",
    intent:    "OPEN",
    dayOffset: 5, hour: 14, durationHours: 2, // Saturday 15:00 Irish time
    maxParticipants: 10,
    themeHint: "Afternoon tea social — elegant setting, good conversation, meet new people over tea and pastries",
    venueOverrides: [
      "The Imperial Hotel, South Mall, Cork",
      "Montenotte Hotel, Middle Glanmire Road, Cork",
      "The Dean Cork, Horgan's Quay",
    ],
  },
  {
    category:  "DRINKS",
    intent:    "OPEN",
    dayOffset: 5, hour: 19, durationHours: 2, // Saturday 20:00 Irish time
    maxParticipants: 12,
    themeHint: "Rooftop cocktails social — stylish evening drinks, meet new people in a relaxed upscale setting",
    venueOverrides: [
      "Sophie's Rooftop, The Dean Cork, Horgan's Quay",
      "Montenotte Hotel, Middle Glanmire Road, Cork",
      "The Imperial Hotel, South Mall, Cork",
    ],
  },

  // ── New activity categories ────────────────────────────────────────────────
  {
    category:  "BRUNCH",
    intent:    "OPEN",
    dayOffset: 6, hour: 11, durationHours: 2, // Sunday 12:00 Irish time
    maxParticipants: 10,
    // Year-round — brunch is always good
    themeHint: "Sunday brunch social — meet new people over good food, relaxed and welcoming, no agenda",
  },
  {
    category:  "BRUNCH",
    intent:    "FRIENDS",
    dayOffset: 5, hour: 10, durationHours: 2, // Saturday 11:00 Irish time
    maxParticipants: 8,
    genderRestriction: "FEMALE",
    // Year-round
    themeHint: "Women's Saturday brunch — casual catch-up energy, good food, meet new people in Cork",
  },
  {
    category:  "LANGUAGE_EXCHANGE",
    intent:    "OPEN",
    dayOffset: 2, hour: 18, durationHours: 1.5, // Wednesday 19:00 Irish time
    maxParticipants: 12,
    // Year-round — Cork has a huge international community
    themeHint: "Language exchange meetup — practice your English, Irish, French, Spanish or whatever you know over coffee",
  },
  {
    category:  "LANGUAGE_EXCHANGE",
    intent:    "FRIENDS",
    dayOffset: 5, hour: 11, durationHours: 2, // Saturday 12:00 Irish time
    maxParticipants: 10,
    // Year-round
    themeHint: "Saturday language café — international crowd, bring your curiosity, leave with new friends and maybe a new phrase",
  },

  // ── Couples events ─────────────────────────────────────────────────────────
  {
    category:       "DINNER",
    intent:         "FRIENDS",
    dayOffset:      5, hour: 18, durationHours: 2.5,
    maxParticipants: 8, // = 8 couple slots (up to 16 people total on the night)
    isCouplesEvent: true,
    // Year-round — indoor
    themeHint: "Couples dinner night — shared table for pairs, relaxed atmosphere, good food and great conversation with other couples.",
  },
  {
    category:       "DRINKS",
    intent:         "FRIENDS",
    dayOffset:      4, hour: 18, durationHours: 2.5,
    maxParticipants: 8, // = 8 couple slots
    isCouplesEvent: true,
    // Year-round — indoor, wine bar setting
    themeHint: "Couples wine evening — intimate shared table for pairs, curated wines, relaxed atmosphere and easy conversation with other couples in a proper wine bar.",
    venueOverrides: [
      "Latitude Wine Bar, Cork",
      "MacCurtain Wine Cellar, MacCurtain Street, Cork",
      "Old Brenna's Wine House, Cork",
      "Moody Café Vin Bar, Cork",
    ],
  },
  {
    category:       "DANCING",
    intent:         "OPEN",
    dayOffset:      6, hour: 19, durationHours: 2,
    maxParticipants: 10, // = 10 couple slots
    isCouplesEvent: true,
    // Year-round — indoor
    themeHint: "Couples dance social — a fun evening of dancing for couples in Cork. No experience needed, just come and enjoy it together.",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function eventDate(fromMonday: Date, dayOffset: number, hour: number): Date {
  const d = new Date(fromMonday);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function expiryDate(start: Date, durationHours: number): Date {
  return new Date(start.getTime() + durationHours * 3600 * 1000);
}

/** Upsert the Rendez bot user, return its ID */
async function getBotUserId(): Promise<string> {
  const BOT_EMAIL = "events@rendez.app";
  const existing = await prisma.user.findUnique({
    where: { email: BOT_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {
      email: BOT_EMAIL,
      name: "Rendez",
      passwordHash: "",
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
  locationName: string;
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

async function generateEvent(
  slot: (typeof EVENT_SLOTS)[number],
  scheduledAt: Date,
  weekIndex: number,
  selectedVenue: string,
): Promise<GeneratedEvent> {
  const client = new Anthropic();

  const dayName   = DAY_NAMES[scheduledAt.getUTCDay()];
  const hourIrish = scheduledAt.getUTCHours() + 1; // UTC+1 (Irish Summer Time)
  const timeStr   = `${String(hourIrish).padStart(2, "0")}:00`;

  const prompt = `You are the community events curator for Rendez, a real-life social activity app in Cork, Ireland.

Generate ONE community event for this exact slot:
Activity: ${slot.category.replace(/_/g, " ")}
Theme: ${slot.themeHint}
Scheduled: ${dayName} at ${timeStr}
Venue (already chosen — do not change): ${selectedVenue}
Week variation seed: ${weekIndex} — vary the angle or hook slightly each week so events feel fresh.

TITLE RULES — read carefully:
- Max 55 characters. Warm and specific.
- Do NOT include any day name (Monday, Tuesday, Wednesday, etc.) or time — the app displays the date separately.
- Do NOT include the venue name or any location — the app shows the venue separately below the title.
- Good: "Morning Group Run", "Evening Social Drinks", "Outdoor Yoga Session", "Sunset Walk & Chat"
- Bad: "Friday Drinks" ← day name, "Drinks at The Franciscan Well" ← venue name in title

DESCRIPTION RULES:
- One or two sentences, max 200 characters.
- Do NOT mention a specific day or time.
- You may naturally reference the venue name to make it feel grounded.
- Be welcoming and describe the vibe.

Return ONLY valid JSON — no markdown, no explanation:
{
  "title": "...",
  "description": "..."
}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
  const parsed  = JSON.parse(cleaned) as { title: string; description: string };

  // Strip day names that slipped through
  const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
  let title = parsed.title.replace(dayPattern, "").replace(/\s{2,}/g, " ").trim();

  // Strip venue name if the AI included it (e.g. "Drinks at The Franciscan Well" → "Drinks")
  const venueEscaped = selectedVenue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const venuePattern = new RegExp(`\\s*(at|@|in|-)\\s+${venueEscaped}`, "gi");
  title = title.replace(venuePattern, "").replace(/\s{2,}/g, " ").trim();

  return { title, description: parsed.description, locationName: selectedVenue };
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const isManual = req.headers.get("x-manual-trigger") === "true";
  // Runs Sunday at 08:00 — creates next week's events so Premium users get
  // 24h early access (Sunday) before free users see them on Monday.
  if (!isManual && now.getUTCDay() !== 0) {
    return NextResponse.json({ skipped: true, reason: "Not Sunday" });
  }

  // Use ISO week number as the variation seed so themes rotate naturally
  const weekIndex = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));

  const botUserId = await getBotUserId();

  // Calculate the NEXT Monday anchor for the coming week's event dates.
  // Running on Saturday (6): next Monday is +2 days.
  // Formula (8 - dayOfWeek) % 7 works for any day of the week.
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = monday.getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilMonday = (8 - dayOfWeek) % 7; // Sat→2, Sun→1, Mon→0, etc.
  monday.setUTCDate(monday.getUTCDate() + daysUntilMonday);

  // freeAccessAt: the moment free users can start seeing these events (Monday 08:00 UTC)
  const freeAccessAt = new Date(monday);
  freeAccessAt.setUTCHours(8, 0, 0, 0);

  // Week window: Monday 00:00 to Sunday 23:59
  const weekEnd = new Date(monday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  // Find which slots already have an event this week (deduplication by category + type)
  // Key format: "CATEGORY" | "CATEGORY:MALE" | "CATEGORY:FEMALE" | "CATEGORY:COUPLES"
  const existingThisWeek = await prisma.activityPost.findMany({
    where: {
      isRendezEvent: true,
      scheduledAt: { gte: monday, lte: weekEnd },
    },
    select: { activityCategory: true, genderRestriction: true, isCouplesEvent: true, locationName: true, scheduledAt: true },
  });

  // Unique key per slot: category + day-of-week + hour + gender/couples suffix.
  // Including day+hour means two different time slots of the same category
  // (e.g. Thursday drinks vs Saturday rooftop drinks) can both run in the same week,
  // while a re-run of the cron still skips slots already created.
  //
  // For EVENT_SLOT entries:  dayOfWeek = (dayOffset + 1) % 7  (Mon dayOffset 0 → UTC day 1)
  // For Prisma DB results:   dayOfWeek = scheduledAt.getUTCDay()
  function slotKey(s: {
    category?: string; activityCategory?: string;
    genderRestriction?: string | null; isCouplesEvent?: boolean;
    dayOffset?: number; hour?: number;
    scheduledAt?: Date | null;
  }) {
    const cat = s.category ?? s.activityCategory ?? "";
    const dow = s.dayOffset !== undefined
      ? (s.dayOffset + 1) % 7
      : (s.scheduledAt?.getUTCDay() ?? 0);
    const hr  = s.hour ?? s.scheduledAt?.getUTCHours() ?? 0;
    const suffix = s.isCouplesEvent ? ":COUPLES" : s.genderRestriction ? `:${s.genderRestriction}` : "";
    return `${cat}:${dow}:${hr}${suffix}`;
  }

  const existingKeys = new Set(existingThisWeek.map(slotKey));

  // ── Venue+time conflict tracking ─────────────────────────────────────────
  // Key: "venueName:YYYY-MM-DDTHH" — prevents two events at the same place at the same time.
  // Pre-seed from events already in the DB this week, then add each new slot as it's assigned.
  const usedVenueTimeKeys = new Set<string>();
  for (const e of existingThisWeek) {
    if (e.locationName && e.scheduledAt) {
      usedVenueTimeKeys.add(`${e.locationName}:${e.scheduledAt.toISOString().slice(0, 13)}`);
    }
  }

  // Pick a venue for a slot, skipping any venue already used at the same hour.
  // Tries venues in rotation order until it finds a free one.
  function pickVenue(slot: (typeof EVENT_SLOTS)[number], scheduledAt: Date): string {
    const approvedVenues = slot.venueOverrides ?? VENUES_BY_CATEGORY[slot.category] ?? [];
    if (!approvedVenues.length) return "Cork city centre";
    const timeKey    = scheduledAt.toISOString().slice(0, 13); // "2026-06-09T10"
    const rotationBase = weekIndex + slot.dayOffset + slot.hour;
    for (let i = 0; i < approvedVenues.length; i++) {
      const venue = approvedVenues[(rotationBase + i) % approvedVenues.length];
      const key   = `${venue}:${timeKey}`;
      if (!usedVenueTimeKeys.has(key)) {
        usedVenueTimeKeys.add(key);
        return venue;
      }
    }
    // All venues at this hour are taken (edge case) — fall back to rotation
    return approvedVenues[rotationBase % approvedVenues.length];
  }

  // Filter by season: skip slots whose months list doesn't include the current month
  const currentMonth = now.getUTCMonth() + 1; // 1 = January … 12 = December
  const slotsToCreate = EVENT_SLOTS.filter(
    (s) => (!s.months || s.months.includes(currentMonth)) && !existingKeys.has(slotKey(s))
  );

  if (slotsToCreate.length === 0) {
    return NextResponse.json({ skipped: true, reason: "All events already exist for this week" });
  }

  // Pre-assign venues sequentially so conflict checking works correctly before
  // we fan out to parallel Claude calls.
  const slotVenues = slotsToCreate.map((slot) => {
    const scheduledAt = eventDate(monday, slot.dayOffset, slot.hour);
    return { slot, scheduledAt, venue: pickVenue(slot, scheduledAt) };
  });

  // Generate all events in parallel (Haiku is fast + cheap)
  const results = await Promise.allSettled(
    slotVenues.map(async ({ slot, scheduledAt, venue }) => {
      const expiresAt = expiryDate(scheduledAt, slot.durationHours);

      const generated = await generateEvent(slot, scheduledAt, weekIndex, venue);

      const coords = geocodeVenueName(generated.locationName);

      return prisma.activityPost.create({
        data: {
          userId:            botUserId,
          isRendezEvent:     true,
          activityCategory:  slot.category,
          activityIntent:    slot.intent,
          title:             generated.title,
          description:       generated.description,
          locationName:      generated.locationName,
          locationLat:       coords?.lat ?? null,
          locationLng:       coords?.lng ?? null,
          city:              "Cork",
          scheduledAt,
          expiresAt,
          maxParticipants:   slot.maxParticipants,
          genderRestriction: slot.genderRestriction ?? null,
          isCouplesEvent:    slot.isCouplesEvent ?? false,
          // Free users see this event from Monday; Premium see it immediately (Saturday)
          freeAccessAt,
        },
        select: { id: true, title: true, activityCategory: true, scheduledAt: true, genderRestriction: true, isCouplesEvent: true },
      });
    })
  );

  const created = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => (r as PromiseFulfilledResult<{ id: string; title: string; activityCategory: string; scheduledAt: Date | null; genderRestriction: string | null; isCouplesEvent: boolean }>).value);

  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r) => String((r as PromiseRejectedResult).reason));

  console.log(`[rendez-event] Created ${created.length} events, ${failed.length} failed`, { created, failed });

  return NextResponse.json({ ok: true, created: created.length, events: created, errors: failed });
}
