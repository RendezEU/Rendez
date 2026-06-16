/**
 * GET /api/diary
 *
 * Returns a unified social diary for the authenticated user:
 *   - Completed / Connected 1:1 matches
 *   - Rendez Events the user attended (accepted FeedMatchRequests on past events)
 *   - Activity posts the user hosted that had at least one participant
 *
 * Also returns:
 *   - stats:      aggregate counts (total activities, events attended, etc.)
 *   - milestones: computed achievements (no DB table needed — derived from stats)
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const now = new Date();

  // ── 1. Completed / Connected 1:1 matches ─────────────────────────────────
  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { in: ["COMPLETED", "CONNECTED"] },
    },
    include: {
      userA: {
        select: {
          id: true, name: true,
          profile: { select: { photos: { where: { isPrimary: true }, take: 1 }, allowShareCard: true } },
        },
      },
      userB: {
        select: {
          id: true, name: true,
          profile: { select: { photos: { where: { isPrimary: true }, take: 1 }, allowShareCard: true } },
        },
      },
      finalizedPlan: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Resolve activityIntent + isRendezEvent from linked feed requests
  const matchIds = matches.map((m) => m.id);
  const feedRequestsForMatches = matchIds.length > 0
    ? await prisma.feedMatchRequest.findMany({
        where: { matchId: { in: matchIds } },
        select: { matchId: true, activityPost: { select: { activityIntent: true, isRendezEvent: true } } },
      })
    : [];
  const intentByMatchId   = new Map(feedRequestsForMatches.map((fr) => [fr.matchId, fr.activityPost?.activityIntent ?? null]));
  const isRendezByMatchId = new Map(feedRequestsForMatches.map((fr) => [fr.matchId, fr.activityPost?.isRendezEvent ?? false]));

  // ── 2. Rendez Events attended ─────────────────────────────────────────────
  const rendezAttendances = await prisma.feedMatchRequest.findMany({
    where: {
      requesterId: userId,
      status: { not: "PENDING" },
      activityPost: { isRendezEvent: true, scheduledAt: { lt: now } },
    },
    include: {
      activityPost: {
        select: {
          id: true, title: true, activityCategory: true, activityIntent: true,
          scheduledAt: true, locationName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── 3. User's own hosted posts with at least one accepted participant ─────
  const hostedPosts = await prisma.activityPost.findMany({
    where: {
      userId,
      isRendezEvent: false,
      scheduledAt: { lt: now },
      matchRequests: { some: { status: { not: "PENDING" } } },
    },
    select: {
      id: true, title: true, activityCategory: true, activityIntent: true,
      scheduledAt: true, locationName: true,
      _count: { select: { matchRequests: true } },
      matchRequests: {
        where: { status: { not: "PENDING" } },
        select: { requester: { select: { id: true, name: true, profile: { select: { photos: { where: { isPrimary: true }, take: 1 }, allowShareCard: true } } } } },
        orderBy: { createdAt: "asc" },
        take: 3,
      },
    },
    orderBy: { scheduledAt: "desc" },
    take: 30,
  });

  // ── Build unified entry list ──────────────────────────────────────────────
  type DiaryEntry = {
    id: string;
    type: "MATCH" | "RENDEZ_EVENT" | "OWN_POST";
    status?: string;
    activityCategory: string;
    activityIntent?: string | null;
    isRendezEvent: boolean;
    title: string;
    otherUser: { id: string; name: string; profile?: { photos: { url: string }[]; allowShareCard: boolean | null } | null };
    // Only on OWN_POST: participants who enabled allowShareCard (for avatar stack)
    participants?: { id: string; name: string; photo: string | null }[];
    finalizedPlan?: { scheduledAt: string; locationName: string } | null;
    attendedAt: string;
    createdAt: string;
    updatedAt: string;
  };

  const entries: DiaryEntry[] = [];

  for (const m of matches) {
    const other = m.userAId === userId ? m.userB : m.userA;
    entries.push({
      id: m.id,
      type: "MATCH",
      status: m.status,
      activityCategory: m.activityCategory,
      activityIntent: intentByMatchId.get(m.id) ?? null,
      isRendezEvent: isRendezByMatchId.get(m.id) ?? false,
      title: other?.name ?? "Someone",
      otherUser: {
        id: other?.id ?? "",
        name: other?.name ?? "",
        profile: other?.profile
          ? { photos: other.profile.photos, allowShareCard: other.profile.allowShareCard }
          : null,
      },
      finalizedPlan: m.finalizedPlan
        ? { scheduledAt: m.finalizedPlan.scheduledAt.toISOString(), locationName: m.finalizedPlan.locationName }
        : null,
      attendedAt: m.finalizedPlan?.scheduledAt?.toISOString() ?? m.updatedAt.toISOString(),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    });
  }

  for (const r of rendezAttendances) {
    const post = r.activityPost;
    if (!post) continue;
    entries.push({
      id: `rendez-${r.id}`,
      type: "RENDEZ_EVENT",
      activityCategory: post.activityCategory,
      activityIntent: post.activityIntent,
      isRendezEvent: true,
      title: post.title,
      otherUser: { id: "rendez-event", name: post.title },
      finalizedPlan: post.scheduledAt
        ? { scheduledAt: post.scheduledAt.toISOString(), locationName: post.locationName ?? "" }
        : null,
      attendedAt: post.scheduledAt?.toISOString() ?? r.createdAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.createdAt.toISOString(),
    });
  }

  for (const p of hostedPosts) {
    const participants = p.matchRequests.map((r) => r.requester).filter(Boolean);
    const first = participants[0];
    const total = p._count.matchRequests;
    const participantLabel =
      total === 0 ? "No participants"
      : total === 1 ? (first?.name ?? "1 person")
      : total === 2 ? `${first?.name ?? "Someone"} & ${participants[1]?.name ?? "1 other"}`
      : `${first?.name ?? "Someone"} & ${total - 1} others`;

    // Only share profile pictures of participants who opted in to share cards
    const sharedParticipants = participants
      .filter((u) => u?.profile?.allowShareCard !== false)
      .map((u) => ({
        id: u!.id,
        name: u!.name ?? "",
        photo: u?.profile?.photos?.[0]?.url ?? null,
      }));

    entries.push({
      id: `post-${p.id}`,
      type: "OWN_POST",
      activityCategory: p.activityCategory,
      activityIntent: p.activityIntent,
      isRendezEvent: false,
      title: p.title,
      otherUser: {
        id: "hosted",
        name: participantLabel,
        profile: first?.profile ? { photos: first.profile.photos, allowShareCard: first.profile.allowShareCard } : null,
      },
      participants: sharedParticipants,
      finalizedPlan: p.scheduledAt
        ? { scheduledAt: p.scheduledAt.toISOString(), locationName: p.locationName ?? "" }
        : null,
      attendedAt: p.scheduledAt?.toISOString() ?? new Date().toISOString(),
      createdAt: p.scheduledAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: p.scheduledAt?.toISOString() ?? new Date().toISOString(),
    });
  }

  // Sort newest first
  entries.sort((a, b) => new Date(b.attendedAt).getTime() - new Date(a.attendedAt).getTime());

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalActivities    = entries.length;
  const rendezEventsCount  = entries.filter((e) => e.type === "RENDEZ_EVENT").length;
  const connectedCount     = entries.filter((e) => e.status === "CONNECTED").length;
  const postsHostedCount   = entries.filter((e) => e.type === "OWN_POST").length;

  const activityCount: Record<string, number> = {};
  for (const e of entries) {
    activityCount[e.activityCategory] = (activityCount[e.activityCategory] ?? 0) + 1;
  }
  const favouriteActivity = Object.entries(activityCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const activeSince       = entries.length > 0 ? entries[entries.length - 1].attendedAt : null;

  // Each bucket is mutually exclusive — no overlapping counts
  const matchesOnly = entries.filter((e) => e.type === "MATCH").length;

  const stats = {
    totalActivities,          // all combined (for milestones)
    meetups:                  matchesOnly,          // 1:1 matches only
    rendezEventsAttended:     rendezEventsCount,    // group Rendez events only
    peopleConnected:          connectedCount,       // post-date connections
    postsHosted:              postsHostedCount,     // activities you hosted
    favouriteActivity,
    activeSince,
  };

  // ── Milestones (computed from stats — no DB table needed for now) ─────────
  const milestones = [
    {
      type: "FIRST_RENDEZ",
      label: "First Rendez",
      emoji: "🌟",
      desc: "Attended your first activity",
      achieved: totalActivities >= 1,
    },
    {
      type: "FIRST_EVENT",
      label: "First Rendez Event",
      emoji: "🎟️",
      desc: "Attended your first Rendez community event",
      achieved: rendezEventsCount >= 1,
    },
    {
      type: "ACTIVITIES_5",
      label: "Getting Social",
      emoji: "🤝",
      desc: "5 activities attended",
      achieved: totalActivities >= 5,
    },
    {
      type: "ACTIVITIES_10",
      label: "Social Butterfly",
      emoji: "🦋",
      desc: "10 activities attended",
      achieved: totalActivities >= 10,
    },
    {
      type: "ACTIVITIES_25",
      label: "Cork Legend",
      emoji: "🏆",
      desc: "25 activities attended",
      achieved: totalActivities >= 25,
    },
    {
      type: "CONNECTED_3",
      label: "Well Connected",
      emoji: "💫",
      desc: "Connected with 3 people",
      achieved: connectedCount >= 3,
    },
    {
      type: "FIRST_HOST",
      label: "First Host",
      emoji: "🎯",
      desc: "Hosted your first activity",
      achieved: postsHostedCount >= 1,
    },
  ];

  return NextResponse.json({ entries, stats, milestones });
}
