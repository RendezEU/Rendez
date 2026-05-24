/**
 * One-time backfill: for every FEED_REQUEST match that has no finalizedPlan,
 * look up the originating ActivityPost via FeedMatchRequest and — if the post
 * had a scheduledAt — create the FinalizedPlan automatically.
 *
 * Run with:  npx tsx scripts/backfill-finalized-plans.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find all accepted feed requests whose match still has no finalizedPlan
  const feedRequests = await prisma.feedMatchRequest.findMany({
    where: {
      status: "ACCEPTED",
      matchId: { not: null },
      activityPost: { scheduledAt: { not: null } },
    },
    include: {
      activityPost: { select: { scheduledAt: true, locationName: true, activityCategory: true } },
    },
  });

  let fixed = 0;

  for (const fr of feedRequests) {
    if (!fr.matchId || !fr.activityPost.scheduledAt) continue;

    // Skip if a finalizedPlan already exists
    const existing = await prisma.finalizedPlan.findUnique({ where: { matchId: fr.matchId } });
    if (existing) continue;

    await prisma.$transaction([
      prisma.finalizedPlan.create({
        data: {
          matchId: fr.matchId,
          scheduledAt: fr.activityPost.scheduledAt,
          locationName: fr.activityPost.locationName ?? "",
          activityCategory: fr.activityPost.activityCategory,
        },
      }),
      prisma.match.update({
        where: { id: fr.matchId },
        data: { status: "CONFIRMED" },
      }),
    ]);

    console.log(`✅ Fixed match ${fr.matchId}`);
    fixed++;
  }

  console.log(`\nDone — ${fixed} match(es) backfilled.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
