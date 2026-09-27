import type { Readable } from "node:stream";

/**
 * ORION v0.12 "Документы" — the seam between the documents module and where
 * file bytes actually live. See docs/PLAN.md.
 *
 * The `key` is a POSIX-style path that mirrors the folder tree
 * (`<workspaceId>/<folder>/<subfolder>/<name>`), so the `local` and `webdav`
 * drivers produce a real, browsable directory structure — not opaque UUID
 * blobs. DocumentsService derives the key from a row's `parentId` chain; the
 * key is never stored as an independent column.
 *
 * A future `s3` driver implements this same interface with no change to the
 * module.
 */
export interface StorageAdapter {
  /** Writes (or overwrites) a file, creating parent directories as needed. */
  putFile(key: string, data: Buffer, meta: { contentType: string }): Promise<void>;

  /** Creates a directory (and any missing parents). No-op if it exists. */
  mkdir(key: string): Promise<void>;

  /**
   * Moves a file or a whole directory subtree from `fromKey` to `toKey`
   * (rename and reparent are the same operation). Parent dirs of `toKey` are
   * created as needed.
   */
  move(fromKey: string, toKey: string): Promise<void>;

  /**
   * Copies a single file from `fromKey` to `toKey`, leaving the source in
   * place — used to archive a document's current content as a version
   * before overwriting it. Parent dirs of `toKey` are created as needed.
   */
  copy(fromKey: string, toKey: string): Promise<void>;

  /**
   * Opens a read stream. `range` (inclusive byte offsets) is honoured when
   * given — used for `Range` requests so media and PDFs can seek.
   */
  getStream(key: string, range?: { start: number; end: number }): Promise<Readable>;

  /** Deletes a file, or a directory and everything under it. No error if absent. */
  remove(key: string): Promise<void>;

  /** True when a file or directory exists at `key`. */
  exists(key: string): Promise<boolean>;
}

/** Nest DI token for the configured StorageAdapter. */
export const STORAGE_ADAPTER = Symbol("STORAGE_ADAPTER");

/**
 * Joins path segments into a storage key: trims slashes, drops empty
 * segments, always POSIX (`/`) regardless of host OS. Callers pass already
 * sanitised segments (see `sanitizeSegment` / `isValidDocumentName` in
 * @orion/shared-types).
 */
export function storageKey(...segments: Array<string | null | undefined>): string {
  return segments
    .filter((s): s is string => Boolean(s))
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}
