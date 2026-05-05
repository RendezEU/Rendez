import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { generateWeeklyMatches } from "@/lib/ai/matching-engine";

// On-demand AI matching trigger — requires user auth, no cron secret needed.
// Runs the full matching engine and returns how many new matches were created.
// Safe to call multiple times: the engine skips pairs that already have a match.
export async function POST(req: Request) {
  await getRequestUserId(req); // just validates auth, result unused
  const result = await generateWeeklyMatches();
  return NextResponse.json(result);
}
