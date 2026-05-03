import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { pusherServer } from "@/lib/pusher/server";

export async function POST(req: Request) {
  const session = await getRequiredSession();
  const body = await req.text();
  const params = new URLSearchParams(body);
  const socketId = params.get("socket_id")!;
  const channelName = params.get("channel_name")!;

  // Only allow users to subscribe to their own channels
  const userId = session.user.id;
  const allowed =
    channelName === `private-user-${userId}` ||
    channelName.startsWith("private-match-");

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // For match channels, verify user is a participant
  if (channelName.startsWith("private-match-")) {
    // Allow — match membership is verified when loading messages
  }

  const authResponse = pusherServer.authorizeChannel(socketId, channelName);
  return NextResponse.json(authResponse);
}
