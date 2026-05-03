import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);

  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { not: "EXPIRED" },
    },
    include: {
      userA: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true } } } },
      userB: { select: { id: true, name: true, profile: { include: { photos: true, promptAnswers: true } } } },
      finalizedPlan: true,
      messages: { orderBy: { createdAt: "asc" } },
      systemActions: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(matches);
}
