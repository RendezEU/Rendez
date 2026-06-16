import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

// Returns the Rendez group events the current user has confirmed (non-waitlist) join requests for.
// Used by the app to restore the home tab if local AsyncStorage was wiped.
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const requests = await prisma.feedMatchRequest.findMany({
    where: { requesterId: userId, isWaitlist: false },
    include: {
      activityPost: {
        select: {
          id: true,
          title: true,
          activityCategory: true,
          locationName: true,
          scheduledAt: true,
          isRendezEvent: true,
          isActive: true,
        },
      },
    },
  });

  const joined = requests
    .filter((r) => r.activityPost.isRendezEvent && r.activityPost.isActive)
    .map((r) => ({
      id: r.activityPost.id,
      type: "group" as const,
      title: r.activityPost.title || "Rendez Event",
      category: r.activityPost.activityCategory ?? "OTHER",
      locationName: r.activityPost.locationName ?? null,
      scheduledAt: r.activityPost.scheduledAt?.toISOString() ?? null,
    }));

  return NextResponse.json(joined);
}
