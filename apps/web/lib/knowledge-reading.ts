/** Average silent-reading pace; nobody reads a 40-word fact at the same rate as a 4000-word method. */
const WORDS_PER_MINUTE = 200;

/**
 * "N мин чтения" for the reading view's byline — counts words (Cyrillic-aware: `\w` alone misses
 * Cyrillic letters in some engines, so this splits on whitespace instead), never 0 for any non-empty
 * text. Markdown syntax (`#`, `**`, link brackets) is left in on purpose: it costs a few words at
 * most and stripping it correctly needs the real parser, not a second one here.
 */
export function estimateReadMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
