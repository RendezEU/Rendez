import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { generateWeeklyMatches } from "@/lib/ai/matching-engine";

// On-demand AI matching trigger — requires user auth, no cron secret needed.
// Runs the full matching engine and returns how many new matches were created.
// Safe to call multiple times: the engine skips pairs that already have a match.
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const result = await generateWeeklyMatches();
  return NextResponse.json(result);
}
