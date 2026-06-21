import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";
import { moderateText } from "@/lib/content-filter";
import { geocodeVenueName } from "@/lib/geocode";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { searchParams } = new URL(req.url);
  const cityParam = searchParams.get("city")?.trim() || null;

  // Fetch blocks + requesting user's preferred activities in parallel
  const [blockedByMe, blockedMe, requestingUser] = await Promise.all([
    prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { preferredActivities: true } } },
    }),
  ]);

  const hiddenUserIds = [
    ...blockedByMe.map((b) => b.blockedId),
    ...blockedMe.map((b) => b.blockerId),
  ];

  // User's saved activity interests (e.g. ["RUNNING", "COFFEE_WALK"])
  const userInterests = new Set<string>(
    requestingUser?.profile?.preferredActivities ?? []
  );

  const [posts, myRequests] = await Promise.all([
    prisma.activityPost.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: new Date() },
        userId: { not: userId, notIn: hiddenUserIds.length > 0 ? hiddenUserIds : undefined },
        ...(cityParam ? { city: { contains: cityParam, mode: "insensitive" } } : {}),
      },
      // Fetch up to 50 so we have enough to personalise; we'll trim to 30 after sorting
      orderBy: [{ isSpontaneous: "desc" }, { scheduledAt: "asc" }],
      take: 50,
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
        // Accepted-only subset — used for isFull (pending/declined must not block a spot)
        matchRequests: {
          where: { status: "ACCEPTED" },
          select: { id: true },
        },
      },
    }),
    prisma.feedMatchRequest.findMany({
      where: { requesterId: userId },
      select: { activityPostId: true },
    }),
  ]);

  const myRequestedIds = new Set(myRequests.map((r) => r.activityPostId));

  // ── Type-augment posts with new schema fields ─────────────────────────────
  // The Prisma client was just regenerated (db push) but the TS server may
  // still be using its in-memory cache of the old types.  Casting here makes
  // all downstream code compile cleanly without relying on the stale cache.
  type PostWithEventType = (typeof posts)[number] & {
    genderRestriction: string | null;
    isCouplesEvent:    boolean;
  };
  const typedPosts = posts as PostWithEventType[];

  // ── Gender counts for Rendez events ──────────────────────────────────────
  // Batch-fetch in one query rather than N+1 per event
  const rendezIds = typedPosts.filter((p) => p.isRendezEvent).map((p) => p.id);

  type GenderRow = { activityPostId: string; gender: string | null; cnt: bigint };

  let genderRows: GenderRow[] = [];
  if (rendezIds.length > 0) {
    // Raw query: join FeedMatchRequest → Profile → count by gender
    genderRows = await prisma.$queryRaw<GenderRow[]>`
      SELECT r."activityPostId", pr."gender", COUNT(*)::bigint AS cnt
      FROM "FeedMatchRequest" r
      JOIN "Profile" pr ON pr."userId" = r."requesterId"
      WHERE r."activityPostId" = ANY(${rendezIds}::text[])
        AND pr."gender" IN ('MALE', 'FEMALE')
      GROUP BY r."activityPostId", pr."gender"
    `;
  }

  // Build a map: eventId → { maleCount, femaleCount }
  const genderMap = new Map<string, { maleCount: number; femaleCount: number }>();
  for (const row of genderRows) {
    const entry = genderMap.get(row.activityPostId) ?? { maleCount: 0, femaleCount: 0 };
    if (row.gender === "MALE")   entry.maleCount   = Number(row.cnt);
    if (row.gender === "FEMALE") entry.femaleCount = Number(row.cnt);
    genderMap.set(row.activityPostId, entry);
  }

  // ── Personalised sort ─────────────────────────────────────────────────────
  // Priority tiers (lower number = shown first):
  //   0 — Rendez event matching user's interests
  //   1 — Rendez event not matching user's interests
  //   2 — Community post matching user's interests (spontaneous first)
  //   3 — Community post not matching user's interests
  function sortTier(p: PostWithEventType): number {
    const isRendez   = p.isRendezEvent;
    const isMatch    = userInterests.size === 0 || userInterests.has(p.activityCategory);
    if (isRendez && isMatch)   return 0;
    if (isRendez && !isMatch)  return 1;
    if (!isRendez && isMatch)  return 2;
    return 3;
  }

  const sorted = [...typedPosts].sort((a, b) => {
    const tierDiff = sortTier(a) - sortTier(b);
    if (tierDiff !== 0) return tierDiff;
    // Within same tier: spontaneous first, then by scheduledAt ascending
    if (a.isSpontaneous !== b.isSpontaneous) return a.isSpontaneous ? -1 : 1;
    const aTime = a.scheduledAt?.getTime() ?? 0;
    const bTime = b.scheduledAt?.getTime() ?? 0;
    return aTime - bTime;
  }).slice(0, 30);

  return NextResponse.json(
    sorted.map((p) => ({
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
      isRendezEvent: p.isRendezEvent,
      recurringDayOfWeek: p.recurringDayOfWeek,
      maxParticipants: p.maxParticipants,
      activityIntent: p.activityIntent,
      createdAt: p.createdAt,
      creator: p.user,
      requestCount: p._count.matchRequests,
      // isFull is true only when accepted (not pending/declined) requests fill all spots
      isFull: p.matchRequests.length >= (p.maxParticipants ?? 1),
      myRequest: myRequestedIds.has(p.id),
      // Gender balance fields — only meaningful for open Rendez events
      maleCount:         p.isRendezEvent && !p.genderRestriction && !p.isCouplesEvent
                           ? (genderMap.get(p.id)?.maleCount   ?? 0) : undefined,
      femaleCount:       p.isRendezEvent && !p.genderRestriction && !p.isCouplesEvent
                           ? (genderMap.get(p.id)?.femaleCount  ?? 0) : undefined,
      genderSlotMax:     p.isRendezEvent && !p.genderRestriction && !p.isCouplesEvent
                           ? Math.floor(p.maxParticipants / 2)        : undefined,
      // Event type flags
      genderRestriction: p.genderRestriction ?? null,
      isCouplesEvent:    p.isCouplesEvent,
    }))
  );
}

const VALID_ACTIVITIES = ["RUNNING","COFFEE_WALK","DRINKS","DOG_WALKING","HIKING","CYCLING","YOGA","DINNER","MUSEUM","PICNIC","DANCING","BRUNCH","LANGUAGE_EXCHANGE"] as const;
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
    // Keep the post alive for 24 hours after the event starts so last-minute joiners
    // can still see it and it moves to memories cleanly after
    expiresAt = new Date(scheduled.getTime() + 24 * 60 * 60 * 1000);
  }

  // Geocode locationName to approximate coords so the map can pin it correctly
  const coords = geocodeVenueName(parsed.data.locationName);

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
