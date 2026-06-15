import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { pusherServer } from "@/lib/pusher/server";
import { prisma } from "@/lib/db/client";

export async function POST(req: Request) {
  const cloned = req.clone();
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await cloned.text();
  const params = new URLSearchParams(body);
  const socketId = params.get("socket_id")!;
  const channelName = params.get("channel_name")!;

  // Each channel type requires membership verification
  let allowed = false;

  if (channelName === `private-user-${userId}`) {
    allowed = true;
  } else if (channelName.startsWith("private-match-")) {
    const matchId = channelName.replace("private-match-", "");
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { userAId: true, userBId: true },
    });
    allowed = match?.userAId === userId || match?.userBId === userId;
  } else if (channelName.startsWith("private-activity-")) {
    const activityId = channelName.replace("private-activity-", "");
    const [request, post] = await Promise.all([
      prisma.feedMatchRequest.findUnique({
        where: { activityPostId_requesterId: { activityPostId: activityId, requesterId: userId } },
        select: { isWaitlist: true },
      }),
      prisma.activityPost.findUnique({
        where: { id: activityId },
        select: { userId: true },
      }),
    ]);
    allowed = post?.userId === userId || (!!request && !request.isWaitlist);
  }

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const authResponse = pusherServer.authorizeChannel(socketId, channelName);
  return NextResponse.json(authResponse);
}
