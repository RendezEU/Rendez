import { prisma } from "@/lib/db/client";

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

async function sendAndCleanup(messages: object[], tokens: { token: string }[]) {
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { data: ExpoReceipt[] } | ExpoReceipt[];
    const receipts: ExpoReceipt[] = Array.isArray(json) ? json : json.data ?? [];

    // Remove tokens that Expo says are invalid (DeviceNotRegistered = app uninstalled)
    const deadTokens: string[] = [];
    receipts.forEach((r, i) => {
      if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
        const t = tokens[i]?.token;
        if (t) deadTokens.push(t);
      }
    });
    if (deadTokens.length) {
      await prisma.pushToken
        .deleteMany({ where: { token: { in: deadTokens } } })
        .catch(() => {});
    }
  } catch {
    // Non-critical — push delivery best-effort
  }
}

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
    channelId: "default",
  }));

  await sendAndCleanup(messages, tokens);
}

export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  await Promise.all(userIds.map((id) => sendPushToUser(id, title, body, data)));
}
