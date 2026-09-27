/**
 * Sanitizes the `next` query param used by login/register to return the user
 * to whatever they were trying to reach (S22 — invite accept screen for a
 * logged-out user). Only an internal same-origin path is ever allowed:
 * accepting an arbitrary URL here would be an open redirect (attacker sends
 * `/login?next=https://evil.example`, victim logs in, gets bounced off-site
 * with a fresh session cookie/token still warm in the tab).
 *
 * Deliberately rejects, not just "best-effort cleans":
 * - anything that doesn't start with a single `/` (no scheme, no `//host`,
 *   which the browser and some routers treat as protocol-relative — `//evil.
 *   example` looks like a path but resolves off-origin),
 * - backslashes (`/\evil.example` — some browsers normalize `\` to `/` and
 *   treat it as `//`, the same protocol-relative trick),
 * - control characters / newlines (header-injection-adjacent paranoia, cheap
 *   to reject and never legitimate in a route).
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 2048) return null;
  if (!/^\/(?!\/)[^\s\\]*$/.test(raw)) return null;
  return raw;
}
