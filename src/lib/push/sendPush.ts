import { prisma } from "@/lib/db/client";

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const tokens = await prisma.pushToken.findMany({ where: { userId } });
  if (!tokens.length) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data: data ?? {},
    sound: "default",
    priority: "high",
    channelId: "default", // required for Android
  }));

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(messages),
  }).catch(() => {});
}

export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  await Promise.all(userIds.map((id) => sendPushToUser(id, title, body, data)));
}
