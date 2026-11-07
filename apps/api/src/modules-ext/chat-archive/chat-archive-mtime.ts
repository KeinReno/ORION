/**
 * Windows can stamp a file that was just written a little earlier than `Date.now()`
 * stored in `lastScanAt`, so a strict `mtime > since` skips a real append until
 * something else touches the file. Two seconds covers that clock skew and still
 * leaves an unchanged file out of the next 10-minute pass.
 */
export const CHAT_ARCHIVE_MTIME_SKEW_MS = 2_000;

export function chatArchiveFileChanged(mtimeMs: number, sinceMs: number): boolean {
  return Number.isFinite(mtimeMs) && mtimeMs > sinceMs - CHAT_ARCHIVE_MTIME_SKEW_MS;
}
