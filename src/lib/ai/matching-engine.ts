import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { findOverlap, haversineDistance } from "@/lib/matching/availability-overlap";
import type { ActivityCategory, Gender, IntentType } from "@prisma/client";
import { addDays, startOfWeek } from "date-fns";

const client = new Anthropic();

interface MatchingProfile {
  userId: string;
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
  availableSlots: string[];
  promptAnswers: { promptKey: string; answer: string }[];
  freeCreditsRemaining: number;
  purchasedCredits: number;
  tier: string;
}

function calcAge(birthDate: Date): number {
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  return m < 0 || (m === 0 && today.getDate() < birthDate.getDate()) ? age - 1 : age;
}

function preScore(a: MatchingProfile, b: MatchingProfile, overlapCount: number): number {
  let score = 0;

  // Activity overlap
  const actOverlap = a.preferredActivities.filter((act) =>
    b.preferredActivities.includes(act)
  ).length;
  score += Math.min(actOverlap / 3, 1) * 0.35;

  // Availability overlap
  score += Math.min(overlapCount / 4, 1) * 0.20;

  // Personality complement (3-5 diff is best)
  const diff = Math.abs(a.personalityScore - b.personalityScore);
  if (diff <= 2) score += 0.10;
  else if (diff <= 5) score += 0.15;
  else score -= 0.05;

  // Intent alignment
  if (a.intent === b.intent) {
    score += a.intent === "SERIOUS" ? 0.20 : 0.10;
  } else if (a.intent === "OPEN" || b.intent === "OPEN") {
    score += 0.05;
  } else if (
    (a.intent === "SERIOUS" && b.intent === "CASUAL") ||
    (a.intent === "CASUAL" && b.intent === "SERIOUS")
  ) {
    score -= 0.30;
  }

  return score;
}

async function scoreWithClaude(
  a: MatchingProfile,
  b: MatchingProfile,
  overlapSlots: string[],
  overlapActivities: ActivityCategory[]
): Promise<{
  compatibilityScore: number;
  suggestedActivity: ActivityCategory;
  reasoning: string;
  summaryA: string;
  summaryB: string;
  redFlags: boolean;
} | null> {
  const prompt = `You are a compatibility analyst for Rendez, an activity-based dating app.
Analyze these two profiles and score their compatibility for a real-world date.

PROFILE A:
- Age: ${a.age}, Gender: ${a.gender}
- Intent: ${a.intent}
- Personality (1=introvert, 10=extrovert): ${a.personalityScore}
- Preferred activities: ${a.preferredActivities.join(", ")}
- Available slots this week: ${a.availableSlots.slice(0, 5).join(", ")}
- Profile answers:
${a.promptAnswers.map((p) => `  [${p.promptKey}]: "${p.answer}"`).join("\n")}
- Reliability score: ${a.reliabilityScore.toFixed(2)}

PROFILE B:
- Age: ${b.age}, Gender: ${b.gender}
- Intent: ${b.intent}
- Personality (1=introvert, 10=extrovert): ${b.personalityScore}
- Preferred activities: ${b.preferredActivities.join(", ")}
- Available slots this week: ${b.availableSlots.slice(0, 5).join(", ")}
- Profile answers:
${b.promptAnswers.map((p) => `  [${p.promptKey}]: "${p.answer}"`).join("\n")}
- Reliability score: ${b.reliabilityScore.toFixed(2)}

Overlapping activities: ${overlapActivities.join(", ") || "none"}
Overlapping time slots: ${overlapSlots.join(", ") || "none"}

Respond ONLY with this exact JSON:
{
  "compatibilityScore": <float 0.0-1.0>,
  "suggestedActivity": "<one of: ${overlapActivities.join(", ") || a.preferredActivities[0]}>",
  "reasoning": "<2-3 sentences explaining why they'd enjoy a date together>",
  "summaryA": "<one sentence for User A describing User B>",
  "summaryB": "<one sentence for User B describing User A>",
  "redFlags": <true if serious incompatibility, else false>
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
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

export async function generateWeeklyMatches(batchId?: string) {
  const weekBatchId = batchId ?? `batch-${Date.now()}`;
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 7);

  // Load all eligible users with profiles, availability, and billing
  const users = await prisma.user.findMany({
    where: { onboardingComplete: true },
    include: {
      profile: { include: { promptAnswers: true } },
      availabilitySlots: { where: { isActive: true } },
      reputation: true,
      billing: true,
    },
  });

  const profiles: MatchingProfile[] = users
    .filter((u) => u.profile)
    .map((u) => ({
      userId: u.id,
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
      availableSlots: u.availabilitySlots.map((s) => `${s.dayOfWeek}-${s.timeBlock}`),
      promptAnswers: u.profile!.promptAnswers.map((p) => ({
        promptKey: p.promptKey,
        answer: p.answer,
      })),
      freeCreditsRemaining: u.billing?.freeCreditsRemaining ?? 0,
      purchasedCredits: u.billing?.purchasedCredits ?? 0,
      tier: u.billing?.tier ?? "FREE",
    }));

  // Track which pairs have been processed and which matches were created
  const processedPairs = new Set<string>();
  const matchesCreated: string[] = [];

  for (const userA of profiles) {
    // Check if user has credits
    const hasCredit =
      userA.tier === "PREMIUM" ||
      userA.freeCreditsRemaining > 0 ||
      userA.purchasedCredits > 0;
    if (!hasCredit) continue;

    // Reputation gate
    if (userA.reliabilityScore < 0.3) continue;

    // Filter candidates
    const candidates = profiles.filter((b) => {
      if (b.userId === userA.userId) return false;

      const pairKey = [userA.userId, b.userId].sort().join("-");
      if (processedPairs.has(pairKey)) return false;

      // Gender preference mutual check
      if (!userA.genderPreferences.includes(b.gender)) return false;
      if (!b.genderPreferences.includes(userA.gender)) return false;

      // Reputation gate
      if (b.reliabilityScore < 0.5) return false;

      // Distance check
      if (userA.latitude && userA.longitude && b.latitude && b.longitude) {
        const dist = haversineDistance(
          userA.latitude,
          userA.longitude,
          b.latitude,
          b.longitude
        );
        if (dist > Math.min(userA.maxDistanceKm, b.maxDistanceKm)) return false;
      } else if (userA.city !== b.city) {
        return false;
      }

      // Must have availability overlap
      const overlap = findOverlap(
        userA.availableSlots.map((s) => {
          const [day, block] = s.split("-");
          return { dayOfWeek: day, timeBlock: block, isActive: true } as never;
        }),
        b.availableSlots.map((s) => {
          const [day, block] = s.split("-");
          return { dayOfWeek: day, timeBlock: block, isActive: true } as never;
        })
      );
      if (overlap.length === 0) return false;

      return true;
    });

    // Pre-score and take top candidates
    const maxCandidates = userA.tier === "PREMIUM" ? 30 : 15;
    const scored = candidates
      .map((b) => {
        const overlap = findOverlap(
          userA.availableSlots.map((s) => {
            const [day, block] = s.split("-");
            return { dayOfWeek: day, timeBlock: block, isActive: true } as never;
          }),
          b.availableSlots.map((s) => {
            const [day, block] = s.split("-");
            return { dayOfWeek: day, timeBlock: block, isActive: true } as never;
          })
        );
        return { profile: b, preScore: preScore(userA, b, overlap.length), overlapSlots: overlap };
      })
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, maxCandidates);

    // Claude scoring for top candidates (rate-limited)
    const minScore = userA.tier === "PREMIUM" ? 0.45 : 0.55;
    let matchesForUser = 0;
    const maxMatches = userA.tier === "PREMIUM" ? 4 : 3;

    for (const { profile: b, overlapSlots } of scored) {
      if (matchesForUser >= maxMatches) break;

      const pairKey = [userA.userId, b.userId].sort().join("-");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const overlapActivities = userA.preferredActivities.filter((a) =>
        b.preferredActivities.includes(a)
      );

      const result = await scoreWithClaude(userA, b, overlapSlots, overlapActivities);
      if (!result) continue;
      if (result.redFlags || result.compatibilityScore < minScore) continue;

      // Check no existing match
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
    }
  }

  return { batchId: weekBatchId, matchesCreated: matchesCreated.length };
}
