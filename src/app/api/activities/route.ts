import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import { moderateText } from "@/lib/content-filter";

// Exact-name → coords for every preset Cork spot + common areas.
// Exact match is tried first; keyword fallback catches free-text entries.
const CORK_EXACT: Record<string, { lat: number; lng: number }> = {
  // ── Preset CORK_SPOTS (from activity creation form) ──────────────────────
  "fitzgerald's park":   { lat: 51.8984, lng: -8.4837 },
  "english market":      { lat: 51.8975, lng: -8.4749 },
  "bishop lucey park":   { lat: 51.8974, lng: -8.4726 },
  "river lee walk":      { lat: 51.8962, lng: -8.4698 },
  "shandon":             { lat: 51.9019, lng: -8.4793 },
  "the elbow lane":      { lat: 51.8984, lng: -8.4716 },
  "nano nagle place":    { lat: 51.8998, lng: -8.4819 },
  "douglas village":     { lat: 51.8690, lng: -8.4539 },
  "lifetime lab":        { lat: 51.9012, lng: -8.4936 },
  "blarney castle":      { lat: 51.9395, lng: -8.5584 },
  // ── City centre landmarks ─────────────────────────────────────────────────
  "grand parade":        { lat: 51.8975, lng: -8.4730 },
  "washington street":   { lat: 51.8978, lng: -8.4760 },
  "oliver plunkett street": { lat: 51.8984, lng: -8.4720 },
  "st. patrick's street": { lat: 51.8985, lng: -8.4712 },
  "paul street":         { lat: 51.8992, lng: -8.4748 },
  "north main street":   { lat: 51.8990, lng: -8.4810 },
  "mardyke":             { lat: 51.8985, lng: -8.4820 },
  "cork city centre":    { lat: 51.8985, lng: -8.4730 },
  "city centre":         { lat: 51.8985, lng: -8.4730 },
  // ── Parks & outdoor ───────────────────────────────────────────────────────
  "victorian quarter":   { lat: 51.8980, lng: -8.4700 },
  "sunday's well":       { lat: 51.9012, lng: -8.4936 },
  "ballincollig park":   { lat: 51.8876, lng: -8.5816 },
  "ballincollig":        { lat: 51.8876, lng: -8.5816 },
  "tramore valley park": { lat: 51.8710, lng: -8.4490 },
  // ── Neighbourhoods ────────────────────────────────────────────────────────
  "douglas":             { lat: 51.8690, lng: -8.4539 },
  "blackrock":           { lat: 51.8900, lng: -8.4220 },
  "rochestown":          { lat: 51.8730, lng: -8.3970 },
  "mahon":               { lat: 51.8824, lng: -8.4367 },
  "ballintemple":        { lat: 51.8870, lng: -8.4100 },
  "monkstown":           { lat: 51.8610, lng: -8.3790 },
  "passage west":        { lat: 51.8690, lng: -8.3380 },
  "carrigaline":         { lat: 51.8130, lng: -8.3940 },
  "cobh":                { lat: 51.8510, lng: -8.2960 },
  "midleton":            { lat: 51.9140, lng: -8.1710 },
  "blarney":             { lat: 51.9395, lng: -8.5584 },
  "bishopstown":         { lat: 51.8850, lng: -8.5000 },
  "wilton":              { lat: 51.8820, lng: -8.5020 },
  "ucc":                 { lat: 51.8932, lng: -8.4956 },
  "western road":        { lat: 51.8945, lng: -8.4970 },
  "togher":              { lat: 51.8730, lng: -8.5010 },
  "turners cross":       { lat: 51.8770, lng: -8.4810 },
  "glasheen":            { lat: 51.8870, lng: -8.5080 },
  "model farm road":     { lat: 51.8900, lng: -8.5120 },
};

const CORK_KEYWORDS: Array<{ keywords: string[]; lat: number; lng: number }> = [
  { keywords: ["fitzgerald", "mardyke"],              lat: 51.8984, lng: -8.4837 },
  { keywords: ["english market", "grand parade"],     lat: 51.8975, lng: -8.4749 },
  { keywords: ["bishop lucey", "lucey park"],         lat: 51.8974, lng: -8.4726 },
  { keywords: ["river lee", "lee walk"],              lat: 51.8962, lng: -8.4698 },
  { keywords: ["shandon"],                            lat: 51.9019, lng: -8.4793 },
  { keywords: ["elbow", "oliver plunkett"],           lat: 51.8984, lng: -8.4716 },
  { keywords: ["nano nagle", "north main"],           lat: 51.8998, lng: -8.4819 },
  { keywords: ["lifetime", "sunday"],                 lat: 51.9012, lng: -8.4936 },
  { keywords: ["blarney"],                            lat: 51.9395, lng: -8.5584 },
  { keywords: ["douglas"],                            lat: 51.8690, lng: -8.4539 },
  { keywords: ["blackrock", "rochestown"],            lat: 51.8900, lng: -8.4220 },
  { keywords: ["ballincollig"],                       lat: 51.8876, lng: -8.5816 },
  { keywords: ["mahon"],                              lat: 51.8824, lng: -8.4367 },
  { keywords: ["ucc", "western road", "wilton"],      lat: 51.8932, lng: -8.4956 },
  { keywords: ["patrick street", "paul street"],      lat: 51.8985, lng: -8.4720 },
  { keywords: ["centre", "center"],                   lat: 51.8985, lng: -8.4730 },
];

function geocodeLocationName(name: string | null | undefined): { lat: number; lng: number } | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  // 1. Exact match
  if (CORK_EXACT[lower]) return CORK_EXACT[lower];
  // 2. Keyword fallback
  for (const entry of CORK_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return { lat: entry.lat, lng: entry.lng };
  }
  return null;
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { searchParams } = new URL(req.url);
  const cityParam = searchParams.get("city")?.trim() || null;

  // Fetch IDs the user has blocked AND users who have blocked them
  const [blockedByMe, blockedMe] = await Promise.all([
    prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
  ]);
  const hiddenUserIds = [
    ...blockedByMe.map((b) => b.blockedId),
    ...blockedMe.map((b) => b.blockerId),
  ];

  const [posts, myRequests] = await Promise.all([
    prisma.activityPost.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: new Date() },
        userId: { not: userId, notIn: hiddenUserIds.length > 0 ? hiddenUserIds : undefined },
        ...(cityParam ? { city: { contains: cityParam, mode: "insensitive" } } : {}),
      },
      orderBy: [{ isFlexible: "asc" }, { scheduledAt: "asc" }],
      take: 30,
      include: {
        user: {
          select: {
            id: true, name: true,
            profile: {
              select: {
                gender: true, birthDate: true, city: true,
                preferredActivities: true, bio: true, intents: true, photoVerified: true,
                promptAnswers: { orderBy: { displayOrder: "asc" }, take: 2 },
                photos: { where: { isPrimary: true }, take: 1 },
              },
            },
          },
        },
        _count: { select: { matchRequests: true } },
      },
    }),
    prisma.feedMatchRequest.findMany({
      where: { requesterId: userId },
      select: { activityPostId: true },
    }),
  ]);

  const myRequestedIds = new Set(myRequests.map((r) => r.activityPostId));

  return NextResponse.json(
    posts.map((p) => ({
      id: p.id,
      activityCategory: p.activityCategory,
      title: p.title,
      description: p.description,
      city: p.city,
      scheduledAt: p.scheduledAt,
      locationName: p.locationName,
      locationLat: p.locationLat,
      locationLng: p.locationLng,
      isSpontaneous: p.isSpontaneous,
      isFlexible: p.isFlexible,
      isRecurring: p.isRecurring,
      recurringDayOfWeek: p.recurringDayOfWeek,
      maxParticipants: p.maxParticipants,
      activityIntent: p.activityIntent,
      createdAt: p.createdAt,
      creator: p.user,
      requestCount: p._count.matchRequests,
      myRequest: myRequestedIds.has(p.id),
    }))
  );
}

const VALID_ACTIVITIES = ["RUNNING","COFFEE_WALK","DRINKS","DOG_WALKING","HIKING","CYCLING","YOGA","COOKING","MUSEUM","PICNIC","CLIMBING","DANCING"] as const;
const VALID_INTENTS = ["DATING","FRIENDS","NETWORKING","OPEN"] as const;
const VALID_DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"] as const;

const schema = z.object({
  activityCategory: z.enum(VALID_ACTIVITIES),
  activityIntent: z.enum(VALID_INTENTS).optional().default("OPEN"),
  title: z.string().min(1).max(100).transform((s) => s.trim()),
  description: z.string().max(600).nullish().transform((v) => v ?? undefined),
  scheduledAt: z.string().nullish().transform((v) => v ?? undefined),
  locationName: z.string().nullish().transform((v) => v ?? undefined),
  city: z.string().min(1).transform((s) => s.trim()),
  isSpontaneous: z.boolean().optional().default(false),
  isFlexible: z.boolean().optional().default(false),
  isRecurring: z.boolean().optional().default(false),
  recurringDayOfWeek: z.enum(VALID_DAYS).nullish().transform((v) => v ?? undefined),
  maxParticipants: z.number().int().min(1).max(6).optional().default(1),
});

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error("POST /api/activities validation error", JSON.stringify(parsed.error.flatten()));
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // Content moderation — check title and description
  for (const field of [parsed.data.title, parsed.data.description]) {
    const mod = moderateText(field);
    if (!mod.ok) return NextResponse.json({ error: mod.reason }, { status: 422 });
  }

  const isSpontaneous = parsed.data.isSpontaneous ?? false;
  const isFlexible = parsed.data.isFlexible ?? false;
  const isRecurring = parsed.data.isRecurring ?? false;
  const now = new Date();

  let scheduled: Date | undefined;
  let expiresAt: Date;
  if (isSpontaneous) {
    scheduled = now;
    expiresAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  } else if (isRecurring) {
    if (!parsed.data.recurringDayOfWeek) {
      return NextResponse.json({ error: "recurringDayOfWeek required for recurring posts." }, { status: 400 });
    }
    scheduled = undefined;
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // refreshed weekly by cron
  } else if (isFlexible) {
    scheduled = undefined;
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else {
    if (!parsed.data.scheduledAt) return NextResponse.json({ error: "scheduledAt required." }, { status: 400 });
    scheduled = new Date(parsed.data.scheduledAt);
    expiresAt = scheduled;
  }

  // Geocode locationName to approximate coords so the map can pin it correctly
  const coords = geocodeLocationName(parsed.data.locationName);

  const post = await prisma.activityPost.create({
    data: {
      userId: userId,
      activityCategory: parsed.data.activityCategory,
      activityIntent: parsed.data.activityIntent,
      title: parsed.data.title,
      description: parsed.data.description,
      scheduledAt: scheduled ?? null,
      locationName: parsed.data.locationName,
      locationLat: coords?.lat ?? null,
      locationLng: coords?.lng ?? null,
      city: parsed.data.city,
      isSpontaneous,
      isFlexible,
      isRecurring,
      recurringDayOfWeek: parsed.data.recurringDayOfWeek ?? null,
      maxParticipants: parsed.data.maxParticipants ?? 1,
      expiresAt,
    },
  });

  return NextResponse.json(post, { status: 201 });
}
