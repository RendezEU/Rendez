import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { generateWeeklyMatches } from "@/lib/ai/matching-engine";

// On-demand AI matching trigger — admin/cron only.
// Any authenticated user could otherwise spam this and burn AI credits.
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await generateWeeklyMatches();
  return NextResponse.json(result);
}
