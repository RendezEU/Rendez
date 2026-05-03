import { NextResponse } from "next/server";
import { generateWeeklyMatches } from "@/lib/ai/matching-engine";

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await generateWeeklyMatches();
  return NextResponse.json(result);
}
