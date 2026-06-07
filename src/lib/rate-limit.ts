// In-memory rate limiter — no external dependencies required.
// Upstash Redis support removed: static imports caused module-load crashes
// when env vars were set but the service was unavailable.

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

export function pruneRateLimitStore(windowMs: number) {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > windowMs) store.delete(key);
  }
}
