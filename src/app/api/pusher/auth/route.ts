import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { pusherServer } from "@/lib/pusher/server";

export async function POST(req: Request) {
  // Clone the request so we can read the body for both auth and params
  const cloned = req.clone();
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await cloned.text();
  const params = new URLSearchParams(body);
  const socketId = params.get("socket_id")!;
  const channelName = params.get("channel_name")!;

  const allowed =
    channelName === `private-user-${userId}` ||
    channelName.startsWith("private-match-") ||
    channelName.startsWith("private-activity-");

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const authResponse = pusherServer.authorizeChannel(socketId, channelName);
  return NextResponse.json(authResponse);
}
