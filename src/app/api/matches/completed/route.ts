import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);

  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { in: ["COMPLETED", "CONNECTED"] },
    },
    include: {
      userA: { select: { id: true, name: true, profile: { select: { photos: true } } } },
      userB: { select: { id: true, name: true, profile: { select: { photos: true } } } },
      finalizedPlan: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(
    matches.map((m) => {
      const other = m.userAId === userId ? m.userB : m.userA;
      return {
        id: m.id,
        status: m.status,
        activityCategory: m.activityCategory,
        otherUser: other,
        finalizedPlan: m.finalizedPlan,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    })
  );
}
