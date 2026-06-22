import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authCheck = await requireAuth(req);
  if (authCheck instanceof NextResponse) return authCheck;
  const requesterId = authCheck;
  const { userId } = await params;

  const [user, datesCompleted, block] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        profile: {
          include: {
            photos: true,
            promptAnswers: true,
          },
        },
        billing: { select: { tier: true } },
        reputation: {
          select: {
            reliabilityScore: true,
            ratingShowUp: true,
            ratingKindness: true,
            ratingProfileMatch: true,
            totalRatings: true,
            totalDates: true,
            totalNoShows: true,
          },
        },
      },
    }),
    prisma.match.count({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: { in: ["COMPLETED", "CONNECTED"] },
      },
    }),
    // Check if either user has blocked the other
    prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: userId },
          { blockerId: userId, blockedId: requesterId },
        ],
      },
      select: { id: true },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (block) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ ...user, tier: user.billing?.tier ?? "FREE", datesCompleted });
}
