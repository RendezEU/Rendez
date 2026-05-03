import Pusher from "pusher";

export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

export async function triggerMatchEvent(matchId: string, event: string, data: unknown) {
  await pusherServer.trigger(`private-match-${matchId}`, event, data);
}

export async function triggerUserEvent(userId: string, event: string, data: unknown) {
  await pusherServer.trigger(`private-user-${userId}`, event, data);
}
