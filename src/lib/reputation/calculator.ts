import { prisma } from "@/lib/db/client";

const WEIGHTS = { showUp: 0.4, punctuality: 0.3, experience: 0.3 };

export async function recalculateReputation(userId: string) {
  const events = await prisma.reputationEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  let showUp = 1.0;
  let punctuality = 1.0;
  let experience = 1.0;
  let totalDates = 0;
  let totalNoShows = 0;
  let totalLate = 0;

  for (const ev of events) {
    switch (ev.eventType) {
      case "NO_SHOW":
        showUp = Math.max(0, showUp - 0.15);
        totalNoShows++;
        break;
      case "DATE_COMPLETED":
        showUp = Math.min(1, showUp + 0.05);
        totalDates++;
        break;
      case "LATE_ARRIVAL":
        punctuality = Math.max(0, punctuality - 0.1);
        totalLate++;
        break;
      case "ON_TIME":
        punctuality = Math.min(1, punctuality + 0.03);
        break;
      case "CONNECT_RECEIVED":
        experience = Math.min(1, experience + 0.05);
        break;
      case "PASS_RECEIVED":
        experience = Math.max(0, experience - 0.03);
        break;
    }
  }

  const reliability =
    showUp * WEIGHTS.showUp +
    punctuality * WEIGHTS.punctuality +
    experience * WEIGHTS.experience;

  await prisma.reputation.upsert({
    where: { userId },
    create: {
      userId,
      showUpScore: showUp,
      punctualityScore: punctuality,
      experienceScore: experience,
      reliabilityScore: reliability,
      totalDates,
      totalNoShows,
      totalLateArrivals: totalLate,
    },
    update: {
      showUpScore: showUp,
      punctualityScore: punctuality,
      experienceScore: experience,
      reliabilityScore: reliability,
      totalDates,
      totalNoShows,
      totalLateArrivals: totalLate,
    },
  });

  return reliability;
}

export async function addReputationEvent(
  userId: string,
  eventType: string,
  matchId?: string,
  notes?: string
) {
  const deltaMap: Record<string, number> = {
    NO_SHOW: -0.15,
    DATE_COMPLETED: 0.05,
    LATE_ARRIVAL: -0.1,
    ON_TIME: 0.03,
    CONNECT_RECEIVED: 0.05,
    PASS_RECEIVED: -0.03,
  };

  await prisma.reputationEvent.create({
    data: {
      userId,
      matchId,
      eventType,
      delta: deltaMap[eventType] ?? 0,
      notes,
    },
  });

  return recalculateReputation(userId);
}
