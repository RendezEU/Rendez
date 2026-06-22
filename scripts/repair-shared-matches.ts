/**
 * One-time repair: find FeedMatchRequests where the same matchId is shared
 * across multiple requests (i.e. two different activities with the same person
 * were incorrectly linked to the same Match). For each duplicate, create a new
 * Match seeded from the activity's data so both chats become independent.
 *
 * Run: npx tsx scripts/repair-shared-matches.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Find all matchIds referenced by more than one accepted FeedMatchRequest
  const rows = await prisma.$queryRaw<{ matchId: string; cnt: bigint }[]>`
    SELECT "matchId", COUNT(*) AS cnt
    FROM "FeedMatchRequest"
    WHERE status = 'ACCEPTED' AND "matchId" IS NOT NULL
    GROUP BY "matchId"
    HAVING COUNT(*) > 1
  `;

  if (rows.length === 0) {
    console.log("No shared matches found — DB is clean.");
    return;
  }

  console.log(`Found ${rows.length} shared match(es) to repair.`);

  for (const { matchId } of rows) {
    const requests = await prisma.feedMatchRequest.findMany({
      where: { matchId, status: "ACCEPTED" },
      include: {
        activityPost: {
          select: {
            activityCategory: true,
            scheduledAt: true,
            locationName: true,
            isRendezEvent: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Keep the first request on the original match — repair the rest
    const [, ...duplicates] = requests;

    const originalMatch = await prisma.match.findUnique({
      where: { id: matchId },
      select: { userAId: true, userBId: true, expiresAt: true },
    });
    if (!originalMatch) continue;

    for (const req of duplicates) {
      const post = req.activityPost;
      const hasPresetTime = !!post.scheduledAt;

      console.log(
        `  Repairing FeedMatchRequest ${req.id} (activity category: ${post.activityCategory})`
      );

      const newMatch = await prisma.match.create({
        data: {
          userAId: originalMatch.userAId,
          userBId: originalMatch.userBId,
          source: "FEED_REQUEST",
          status: hasPresetTime ? "CONFIRMED" : "COORDINATING",
          activityCategory: post.activityCategory,
          userADecision: true,
          userBDecision: true,
          expiresAt: originalMatch.expiresAt,
          ...(hasPresetTime && {
            finalizedPlan: {
              create: {
                scheduledAt: post.scheduledAt!,
                locationName: post.locationName ?? "",
                activityCategory: post.activityCategory,
              },
            },
          }),
        },
      });

      await prisma.feedMatchRequest.update({
        where: { id: req.id },
        data: { matchId: newMatch.id },
      });

      console.log(`    → Created new match ${newMatch.id}`);
    }
  }

  console.log("Done.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
