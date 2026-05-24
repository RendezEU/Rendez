/**
 * Basic content moderation filter.
 * Uses word-boundary matching to avoid false positives like "Scunthorpe".
 * For production scale, replace with a dedicated moderation API.
 */

// Whole-word blocked terms (matched at word boundaries)
const BLOCKED_WORDS = new Set([
  "fuck", "fucker", "fucking", "fucked",
  "shit", "shitting", "shitted",
  "cunt", "cunts",
  "bitch", "bitches",
  "nigger", "nigga", "niggers",
  "faggot", "faggots",
  "retard", "retarded",
  "whore", "whores",
  "slut", "sluts",
  "pedo", "pedophile",
]);

// Multi-word phrases (substring match on lowercase)
const BLOCKED_PHRASES = [
  "kill yourself",
  "kys",
  "commit suicide",
  "go die",
  "i will kill",
  "i'm going to kill",
  "rape you",
  "sexual assault",
  "send nudes",
  "send pics",
  "onlyfans",
  "cash app",
  "venmo me",
  "wire transfer",
  "crypto payment",
  "bitcoin payment",
  "whatsapp me",
  "telegram me",
  "snap me",
];

/**
 * Returns true if text contains blocked content.
 */
export function containsBlockedContent(text: string): boolean {
  const lower = text.toLowerCase();

  // Phrase check (multi-word or short codes)
  if (BLOCKED_PHRASES.some((p) => lower.includes(p))) return true;

  // Whole-word check using a simple tokenizer
  const words = lower.match(/\b[a-z]+\b/g) ?? [];
  if (words.some((w) => BLOCKED_WORDS.has(w))) return true;

  return false;
}

/**
 * Returns `{ ok: true }` or `{ ok: false, reason: string }`.
 */
export function moderateText(
  text: string | null | undefined
): { ok: boolean; reason?: string } {
  if (!text) return { ok: true };
  if (containsBlockedContent(text)) {
    return { ok: false, reason: "Content contains inappropriate language or unsafe links." };
  }
  return { ok: true };
}
