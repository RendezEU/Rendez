import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { activityId } = await params;

  const [post, requests] = await Promise.all([
    prisma.activityPost.findUnique({
      where: { id: activityId },
      select: {
        userId: true,
        isRendezEvent: true,
        title: true,
        locationName: true,
        scheduledAt: true,
        user: {
          select: {
            id: true,
            name: true,
            profile: {
              select: {
                photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
              },
            },
          },
        },
      },
    }),
    prisma.feedMatchRequest.findMany({
      where: { activityPostId: activityId, isWaitlist: false },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            profile: {
              select: {
                photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Only the host and confirmed participants can see who else is attending.
  // Without this check any user can enumerate attendees of any event (privacy IDOR).
  const isHost = post.userId === userId;
  const isParticipant = requests.some((r) => r.requester.id === userId);
  if (!isHost && !isParticipant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Host first, then accepted requesters — exclude calling user (shown as "You" in the UI)
  // For Rendez events the host is the Rendez system account, not a real participant — skip them.
  const participants: { id: string; name: string; photo: string | null }[] = [];

  if (post.userId !== userId && !post.isRendezEvent) {
    participants.push({
      id: post.user.id,
      name: post.user.name ?? "Unknown",
      photo: post.user.profile?.photos?.[0]?.url ?? null,
    });
  }

  for (const r of requests) {
    if (r.requester.id !== userId) {
      participants.push({
        id: r.requester.id,
        name: r.requester.name ?? "Unknown",
        photo: r.requester.profile?.photos?.[0]?.url ?? null,
      });
    }
  }

  return NextResponse.json({
    eventTitle: post.title ?? "",
    locationName: post.locationName ?? null,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    participants,
  });
}
