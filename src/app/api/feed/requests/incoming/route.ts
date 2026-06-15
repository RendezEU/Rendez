import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

import { prisma } from "@/lib/db/client";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const requests = await prisma.feedMatchRequest.findMany({
    where: {
      status: "PENDING",
      activityPost: { userId },
    },
    include: {
      activityPost: {
        select: {
          id: true, activityCategory: true, title: true, description: true,
          activityIntent: true, maxParticipants: true, locationName: true,
          scheduledAt: true, isRecurring: true, recurringDayOfWeek: true,
          isFlexible: true, isSpontaneous: true, isRendezEvent: true,
        },
      },
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
