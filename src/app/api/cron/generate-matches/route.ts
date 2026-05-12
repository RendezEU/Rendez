import { NextResponse } from "next/server";
import { generateWeeklyMatches } from "@/lib/ai/matching-engine";

function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await generateWeeklyMatches();
  return NextResponse.json(result);
}
