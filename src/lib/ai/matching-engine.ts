import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { findOverlap, haversineDistance } from "@/lib/matching/availability-overlap";
import { sendPushToUser } from "@/lib/push/sendPush";
import type { ActivityCategory, Gender, IntentType, AvailabilitySlot } from "@prisma/client";

const client = new Anthropic();

// ─── Types ────────────────────────────────────────────────────────────────────

interface TasteProfile {
  totalDecisions: number;
  acceptanceRate: number;
  likedActivities: ActivityCategory[];
  dislikedActivities: ActivityCategory[];
  likedIntents: IntentType[];
  avgAcceptedPersonality: number | null;
  avgAcceptedAge: number | null;
}

interface MatchingProfile {
  userId: string;
  name: string;
  age: number;
  gender: Gender;
  genderPreferences: Gender[];
  intent: IntentType;
  personalityScore: number;
  preferredActivities: ActivityCategory[];
  city: string;
  latitude: number | null;
  longitude: number | null;
  maxDistanceKm: number;
  reliabilityScore: number;
  availabilitySlots: AvailabilitySlot[];
  promptAnswers: { promptKey: string; answer: string }[];
  freeCreditsRemaining: number;
  purchasedCredits: number;
  tier: string;
  taste: TasteProfile;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(birthDate: Date): number {
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  return m < 0 || (m === 0 && today.getDate() < birthDate.getDate()) ? age - 1 : age;
}

async function buildTasteProfile(userId: string): Promise<TasteProfile> {
  const pastMatches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { notIn: ["PENDING_BOTH_DECISIONS", "PENDING_OTHER_DECISION"] },
    },
    include: {
      userA: { include: { profile: true } },
      userB: { include: { profile: true } },
    },
  });

  const accepted: { activities: ActivityCategory[]; intent: IntentType; personality: number; age: number }[] = [];
  const rejected: { activities: ActivityCategory[]; intent: IntentType }[] = [];

  for (const m of pastMatches) {
    const isA = m.userAId === userId;
    const decision = isA ? m.userADecision : m.userBDecision;
    const other = isA ? m.userB.profile : m.userA.profile;
    if (!other || decision === null) continue;

    const age = calcAge(other.birthDate);
    if (decision) {
      accepted.push({ activities: other.preferredActivities, intent: other.intent, personality: other.personalityScore, age });
    } else {
      rejected.push({ activities: other.preferredActivities, intent: other.intent });
    }
  }

  const actAcc: Record<string, number> = {};
  const actRej: Record<string, number> = {};
  accepted.forEach((a) => a.activities.forEach((act) => { actAcc[act] = (actAcc[act] ?? 0) + 1; }));
  rejected.forEach((r) => r.activities.forEach((act) => { actRej[act] = (actRej[act] ?? 0) + 1; }));

  const likedActivities = (Object.entries(actAcc) as [ActivityCategory, number][])
    .filter(([act, n]) => n >= 1 && n > (actRej[act] ?? 0))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([act]) => act);

  const dislikedActivities = (Object.entries(actRej) as [ActivityCategory, number][])
    .filter(([act, n]) => n >= 1 && n > (actAcc[act] ?? 0))
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([act]) => act);

  const intentAcc: Partial<Record<IntentType, number>> = {};
  accepted.forEach((a) => { intentAcc[a.intent] = (intentAcc[a.intent] ?? 0) + 1; });
  const likedIntents = (Object.entries(intentAcc) as [IntentType, number][])
    .sort((a, b) => b[1] - a[1]).map(([i]) => i);

  const avgAcceptedPersonality = accepted.length > 0
    ? accepted.reduce((s, a) => s + a.personality, 0) / accepted.length : null;

  const avgAcceptedAge = accepted.length > 0
    ? accepted.reduce((s, a) => s + a.age, 0) / accepted.length : null;

  return {
    totalDecisions: pastMatches.length,
    acceptanceRate: accepted.length / Math.max(pastMatches.length, 1),
    likedActivities,
    dislikedActivities,
    likedIntents,
    avgAcceptedPersonality,
    avgAcceptedAge,
  };
}

// ─── Pre-scoring (fast, no Claude) ───────────────────────────────────────────
//
// Weights (sum to ~1.0):
//   Activities    0.30  — shared interests = real-world meetup potential
//   Intent        0.25  — serious/casual mismatch kills dates before they start
//   Age           0.12  — proximity matters, but overrideable by taste
//   Availability  0.10  — soft nudge toward people who can actually meet
//   Personality   0.10  — complement is good, but weaker predictor than people think
//   Taste history 0.10  — behavioral signal; small so we don't create filter bubbles
//   (leaving ~0.03 slack for float)

function preScore(a: MatchingProfile, b: MatchingProfile): number {
  let score = 0;

  // Activities (0.30)
  const actOverlap = a.preferredActivities.filter((act) => b.preferredActivities.includes(act)).length;
  score += Math.min(actOverlap / 3, 1) * 0.30;

  // Intent (0.25)
  if (a.intent === b.intent) {
    score += a.intent === "SERIOUS" ? 0.25 : 0.16;
  } else if (a.intent === "OPEN" || b.intent === "OPEN") {
    score += 0.10;
  } else {
    score -= 0.18; // SERIOUS ↔ CASUAL is a real incompatibility
  }

  // Age (0.12)
  const ageDiff = Math.abs(a.age - b.age);
  if (ageDiff <= 3)       score += 0.12;
  else if (ageDiff <= 6)  score += 0.08;
  else if (ageDiff <= 10) score += 0.04;
  else                    score -= 0.04;

  // Availability overlap (0.10) — soft signal; zero overlap gets a small penalty
  // because it dramatically reduces real meeting probability even if everything else fits
  const overlap = findOverlap(a.availabilitySlots, b.availabilitySlots);
  if (overlap.length === 0) {
    score -= 0.05;
  } else {
    score += Math.min(overlap.length / 3, 1) * 0.10;
  }

  // Personality complement (0.10) — slight difference tends to work well
  const pDiff = Math.abs(a.personalityScore - b.personalityScore);
  if (pDiff <= 2)       score += 0.05;
  else if (pDiff <= 5)  score += 0.10;
  else if (pDiff <= 8)  score += 0.05;

  // Taste history (0.10) — does each person match the other's behavioral pattern?
  const tasteBonus = (user: MatchingProfile, candidate: MatchingProfile): number => {
    const t = user.taste;
    if (t.totalDecisions < 3) return 0; // need enough data to be meaningful
    let b = 0;
    if (t.likedActivities.some((a) => candidate.preferredActivities.includes(a))) b += 0.03;
    if (t.dislikedActivities.some((a) => candidate.preferredActivities.includes(a))) b -= 0.02;
    if (t.likedIntents.includes(candidate.intent)) b += 0.02;
    if (t.avgAcceptedPersonality !== null) {
      if (Math.abs(t.avgAcceptedPersonality - candidate.personalityScore) <= 2) b += 0.01;
    }
    return b;
  };
  score += tasteBonus(a, b) + tasteBonus(b, a);

  return score;
}

// ─── Exploration: pick a mix of top-scored + random ──────────────────────────
//
// 70% of candidates are selected by pre-score (taste-aligned).
// 30% are random picks from the broader eligible pool.
// This prevents filter bubbles while keeping quality high.
// Claude still scores everyone — random picks only become matches if Claude agrees.

function selectCandidates(
  candidates: { profile: MatchingProfile; score: number }[],
  maxTotal: number
): { profile: MatchingProfile; score: number; isExploration: boolean }[] {
  const nAligned = Math.ceil(maxTotal * 0.70);
  const nExplore = maxTotal - nAligned;

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const aligned = sorted.slice(0, nAligned).map((c) => ({ ...c, isExploration: false }));

  // Exploration pool: everything not already in the top nAligned
  const explorationPool = sorted.slice(nAligned);
  const explored: typeof aligned = [];
  const used = new Set<string>();
  while (explored.length < nExplore && explorationPool.length > 0) {
    const idx = Math.floor(Math.random() * explorationPool.length);
    const pick = explorationPool.splice(idx, 1)[0];
    if (!used.has(pick.profile.userId)) {
      used.add(pick.profile.userId);
      explored.push({ ...pick, isExploration: true });
    }
  }

  return [...aligned, ...explored];
}

// ─── Claude scoring ───────────────────────────────────────────────────────────

function describeTaste(t: TasteProfile): string {
  if (t.totalDecisions < 3) return "Not enough history yet to identify a pattern.";
  const parts: string[] = [
    `${t.totalDecisions} decisions, ${Math.round(t.acceptanceRate * 100)}% acceptance rate`,
  ];
  if (t.likedActivities.length) parts.push(`gravitates toward: ${t.likedActivities.join(", ")}`);
  if (t.dislikedActivities.length) parts.push(`tends to pass on: ${t.dislikedActivities.join(", ")}`);
  if (t.likedIntents.length) parts.push(`preferred intent: ${t.likedIntents[0]}`);
  if (t.avgAcceptedPersonality !== null) parts.push(`avg accepted personality: ${t.avgAcceptedPersonality.toFixed(1)}/10`);
  if (t.avgAcceptedAge !== null) parts.push(`avg accepted age: ${t.avgAcceptedAge.toFixed(0)}`);
  return parts.join(" · ");
}

async function scoreWithClaude(
  a: MatchingProfile,
  b: MatchingProfile,
  overlapActivities: ActivityCategory[],
  overlapSlots: number,
  isExploration: boolean
): Promise<{
  compatibilityScore: number;
  suggestedActivity: ActivityCategory;
  reasoning: string;
  summaryA: string;
  summaryB: string;
  redFlags: boolean;
} | null> {
  const explorationNote = isExploration
    ? `\nNOTE: This is an exploratory suggestion — the candidate is slightly outside this user's usual pattern. Consider whether the differences could create a refreshing, unexpected encounter rather than penalising the score for novelty alone.`
    : "";

  const prompt = `You are the matching AI for Rendez, an activity-based dating app. Your goal is not just to find people who are similar — it is to predict who will actually meet, enjoy the experience, and potentially date.

Optimise for: real-world meetup potential, not just profile similarity.${explorationNote}

─── PROFILE A: ${a.name} ───
Age: ${a.age} | Gender: ${a.gender} | City: ${a.city}
Relationship intent: ${a.intent}
Personality (1=introvert → 10=extrovert): ${a.personalityScore}
Preferred activities: ${a.preferredActivities.join(", ")}
Availability overlap with candidate: ${overlapSlots > 0 ? `${overlapSlots} shared time slot${overlapSlots > 1 ? "s" : ""}` : "no direct overlap — scheduling would need coordination"}
Prompt answers:
${a.promptAnswers.map((p) => `  "${p.promptKey}": ${p.answer}`).join("\n")}
Behavioral taste pattern: ${describeTaste(a.taste)}

─── PROFILE B: ${b.name} ───
Age: ${b.age} | Gender: ${b.gender} | City: ${b.city}
Relationship intent: ${b.intent}
Personality (1=introvert → 10=extrovert): ${b.personalityScore}
Preferred activities: ${b.preferredActivities.join(", ")}
Availability overlap with candidate: (same ${overlapSlots} shared slot${overlapSlots !== 1 ? "s" : ""})
Prompt answers:
${b.promptAnswers.map((p) => `  "${p.promptKey}": ${p.answer}`).join("\n")}
Behavioral taste pattern: ${describeTaste(b.taste)}

─── SHARED CONTEXT ───
Activities both enjoy: ${overlapActivities.join(", ") || "none in common — but a new shared experience can still work"}

─── REASONING CHECKLIST ───
1. Intent alignment — SERIOUS/CASUAL mismatch is a hard red flag
2. Does B match A's demonstrated behavioral type? Does A match B's?
3. Would their personalities create good energy together in person?
4. Do their prompt answers hint at real conversational or lifestyle chemistry?
5. Is scheduling realistic? (no overlap = friction, not a deal-breaker)
6. For exploration matches: could the difference be a source of pleasant surprise?

Respond ONLY with valid JSON (no markdown):
{
  "compatibilityScore": <float 0.0–1.0>,
  "suggestedActivity": "<best first-date activity — prefer from shared list if any: ${overlapActivities.length ? overlapActivities.join(", ") : a.preferredActivities[0]}>",
  "reasoning": "<2–3 sentences explaining why they would enjoy meeting, referencing specific traits>",
  "summaryA": "<one sentence for ${a.name} about why ${b.name} is worth meeting>",
  "summaryB": "<one sentence for ${b.name} about why ${a.name} is worth meeting>",
  "redFlags": <true only for serious incompatibility: intent mismatch, strong taste conflict, etc.>
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      compatibilityScore: parsed.compatibilityScore,
      suggestedActivity: parsed.suggestedActivity as ActivityCategory,
      reasoning: parsed.reasoning,
      summaryA: parsed.summaryA,
      summaryB: parsed.summaryB,
      redFlags: parsed.redFlags,
    };
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateWeeklyMatches(batchId?: string) {
  const weekBatchId = batchId ?? `batch-${Date.now()}`;

  const users = await prisma.user.findMany({
    where: { onboardingComplete: true },
    include: {
      profile: { include: { promptAnswers: true } },
      availabilitySlots: { where: { isActive: true } },
      reputation: true,
      billing: true,
    },
  });

  // Build taste profiles in parallel
  const tasteMap = new Map<string, TasteProfile>();
  await Promise.all(users.map(async (u) => {
    tasteMap.set(u.id, await buildTasteProfile(u.id));
  }));

  const emptyTaste: TasteProfile = {
    totalDecisions: 0, acceptanceRate: 0,
    likedActivities: [], dislikedActivities: [], likedIntents: [],
    avgAcceptedPersonality: null, avgAcceptedAge: null,
  };

  const profiles: MatchingProfile[] = users
    .filter((u) => u.profile)
    .map((u) => ({
      userId: u.id,
      name: u.name ?? "User",
      age: calcAge(u.profile!.birthDate),
      gender: u.profile!.gender,
      genderPreferences: u.profile!.genderPreferences,
      intent: u.profile!.intent,
      personalityScore: u.profile!.personalityScore,
      preferredActivities: u.profile!.preferredActivities,
      city: u.profile!.city,
      latitude: u.profile!.latitude,
      longitude: u.profile!.longitude,
      maxDistanceKm: u.profile!.maxDistanceKm,
      reliabilityScore: u.reputation?.reliabilityScore ?? 1.0,
      availabilitySlots: u.availabilitySlots,
      promptAnswers: u.profile!.promptAnswers.map((p) => ({ promptKey: p.promptKey, answer: p.answer })),
      freeCreditsRemaining: u.billing?.freeCreditsRemaining ?? 0,
      purchasedCredits: u.billing?.purchasedCredits ?? 0,
      tier: u.billing?.tier ?? "FREE",
      taste: tasteMap.get(u.id) ?? emptyTaste,
    }))
    // High-reliability users are processed first → they see the best remaining candidates
    .sort((a, b) => b.reliabilityScore - a.reliabilityScore);

  const processedPairs = new Set<string>();
  const matchesCreated: string[] = [];

  for (const userA of profiles) {
    const hasCredit =
      userA.tier === "PREMIUM" || userA.freeCreditsRemaining > 0 || userA.purchasedCredits > 0;
    if (!hasCredit) continue;
    if (userA.reliabilityScore < 0.3) continue;

    // Hard filters: gender preference, location, reputation
    const eligibleCandidates = profiles.filter((b) => {
      if (b.userId === userA.userId) return false;
      const pairKey = [userA.userId, b.userId].sort().join("-");
      if (processedPairs.has(pairKey)) return false;
      if (!userA.genderPreferences.includes(b.gender)) return false;
      if (!b.genderPreferences.includes(userA.gender)) return false;
      if (b.reliabilityScore < 0.5) return false;
      // Trust pool separation: high-trust users (≥0.75) are shielded from low-trust candidates
      if (userA.reliabilityScore >= 0.75 && b.reliabilityScore < 0.5) return false;
      if (userA.latitude && userA.longitude && b.latitude && b.longitude) {
        const dist = haversineDistance(userA.latitude, userA.longitude, b.latitude, b.longitude);
        if (dist > Math.min(userA.maxDistanceKm, b.maxDistanceKm)) return false;
      } else if (userA.city !== b.city) {
        return false;
      }
      return true;
    });

    // Pre-score all eligible candidates
    const scoredCandidates = eligibleCandidates.map((b) => ({
      profile: b,
      score: preScore(userA, b),
    }));

    // Reliability-based tiers: high-trust users get more matches, low-trust get fewer
    const rel = userA.reliabilityScore;
    const relTier = rel >= 0.8 ? "HIGH" : rel >= 0.6 ? "MEDIUM" : rel >= 0.4 ? "LOW" : "VERY_LOW";
    const baseMaxMatches = relTier === "HIGH" ? 4 : relTier === "MEDIUM" ? 3 : relTier === "LOW" ? 2 : 1;
    const maxMatches = userA.tier === "PREMIUM" ? Math.max(baseMaxMatches, 5) : baseMaxMatches;
    // Lower trust → higher quality bar (they get fewer but we demand more confidence)
    const minScore = relTier === "HIGH" ? 0.38 : relTier === "MEDIUM" ? 0.42 : relTier === "LOW" ? 0.48 : 0.55;
    const maxCandidates = userA.tier === "PREMIUM" ? 30 : relTier === "HIGH" ? 20 : relTier === "MEDIUM" ? 15 : 10;

    // Select a mix: 70% top-scored (aligned) + 30% exploratory
    const selected = selectCandidates(scoredCandidates, maxCandidates);

    // Exploration matches get a lower threshold — Claude decides if the spark is there
    const minScoreExploration = minScore - 0.12;

    let matchesForUser = 0;

    for (const { profile: b, score, isExploration } of selected) {
      if (matchesForUser >= maxMatches) break;

      const threshold = isExploration ? minScoreExploration : minScore;
      if (score < threshold) continue;

      const pairKey = [userA.userId, b.userId].sort().join("-");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const overlapActivities = userA.preferredActivities.filter((a) =>
        b.preferredActivities.includes(a)
      );
      const overlapSlots = findOverlap(userA.availabilitySlots, b.availabilitySlots).length;

      const result = await scoreWithClaude(userA, b, overlapActivities, overlapSlots, isExploration);
      if (!result) continue;
      if (result.redFlags || result.compatibilityScore < (isExploration ? 0.42 : 0.50)) continue;

      const existing = await prisma.match.findFirst({
        where: {
          OR: [
            { userAId: userA.userId, userBId: b.userId },
            { userAId: b.userId, userBId: userA.userId },
          ],
          NOT: { status: "EXPIRED" },
        },
      });
      if (existing) continue;

      await prisma.match.create({
        data: {
          userAId: userA.userId,
          userBId: b.userId,
          source: "AI_SUGGESTED",
          status: "PENDING_BOTH_DECISIONS",
          activityCategory: result.suggestedActivity,
          compatibilityScore: result.compatibilityScore,
          aiReasoning: result.reasoning,
          aiSummaryA: result.summaryA,
          aiSummaryB: result.summaryB,
          weekBatchId,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
      });

      matchesCreated.push(`${userA.userId}-${b.userId}`);
      matchesForUser++;

      // Notify both users of their new suggestion
      await sendPushToUser(userA.userId, "New match suggestion 💛", "Someone compatible is waiting — check your Matches!", { screen: "matches" });
      await sendPushToUser(b.userId,     "New match suggestion 💛", "Someone compatible is waiting — check your Matches!", { screen: "matches" });
    }
  }

  return { batchId: weekBatchId, matchesCreated: matchesCreated.length };
}
