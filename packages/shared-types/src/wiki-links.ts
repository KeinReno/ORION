/**
 * `[[wiki link]]` parsing — the one source of truth for what counts as a
 * link, shared by the API (which rebuilds the `note_links` index on every
 * save) and the client (autocomplete, preview rendering). Deliberately
 * simple: `[[Target]]` or `[[Target|alias]]`, no nesting, no `[` or `]`
 * inside. Matches Obsidian's basic form, not its embeds/block-refs.
 */

const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/g;

export interface WikiLinkRef {
  /** The note title referenced, trimmed, original case. */
  target: string;
  /** Display text after `|`, if any (trimmed). */
  alias: string | null;
}

/** Every `[[link]]` in `text`, in document order (duplicates kept). */
export function parseWikiLinks(text: string): WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  if (!text) return out;
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    const alias = m[2] !== undefined ? m[2].trim() : null;
    out.push({ target, alias: alias || null });
  }
  return out;
}

/** Distinct link targets in `text`, first-seen order (case-insensitive dedup). */
export function wikiLinkTargets(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { target } of parseWikiLinks(text)) {
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}
