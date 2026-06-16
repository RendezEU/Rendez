import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const user = await prisma.user.update({
    where: { email },
    data: { tier: "PREMIUM" },
  });
  await prisma.billing.upsert({
    where: { userId: user.id },
    create: { userId: user.id, tier: "PREMIUM" },
    update: { tier: "PREMIUM" },
  });
  return NextResponse.json({ ok: true, userId: user.id });
}
