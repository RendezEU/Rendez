import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);

  const requests = await prisma.feedMatchRequest.findMany({
    where: {
      status: "PENDING",
      activityPost: { userId },
    },
    include: {
      activityPost: { select: { id: true, activityCategory: true, title: true, activityIntent: true } },
      requester: {
        select: {
          id: true,
          name: true,
          profile: {
            select: {
              birthDate: true,
              city: true,
              gender: true,
              preferredActivities: true,
              bio: true,
              intents: true,
              photos: { select: { url: true }, orderBy: { order: "asc" }, take: 1 },
              promptAnswers: { select: { promptKey: true, answer: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}
