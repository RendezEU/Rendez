/**
 * Rate limiter backed by Upstash Redis (sliding window).
 * Falls back to in-memory when UPSTASH_REDIS_REST_URL / _TOKEN are not set
 * (local dev before you've added the env vars).
 *
 * Upstash free tier: 10,000 requests/day — no credit card required.
 * Sign up at https://upstash.com, create a Redis database, then add:
 *   UPSTASH_REDIS_REST_URL=...
 *   UPSTASH_REDIS_REST_TOKEN=...
 * to your .env.local / Vercel environment variables.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

// One shared limiter instance reused across invocations
let _upstashLimiter: Ratelimit | null = null;
function getUpstashLimiter(limit: number, windowSeconds: number): Ratelimit {
  if (!_upstashLimiter) {
    _upstashLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      analytics: false,
      prefix: "rendez:rl",
    });
  }
  return _upstashLimiter;
}

// ── In-memory fallback ────────────────────────────────────────────────────────
interface RateEntry {
  count: number;
  windowStart: number;
}
const store = new Map<string, RateEntry>();

/**
 * @returns true  → request allowed
 * @returns false → rate-limited
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  if (hasUpstash) {
    const limiter = getUpstashLimiter(limit, Math.round(windowMs / 1000));
    const { success } = await limiter.limit(key);
    return success;
  }

  // In-memory fallback
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/** No-op when Upstash is active (it handles cleanup automatically). */
export function pruneRateLimitStore(windowMs: number) {
  if (hasUpstash) return;
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > windowMs) store.delete(key);
  }
}
