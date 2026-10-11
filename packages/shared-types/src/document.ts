import { z } from "zod";

/**
 * ORION v0.12 "Документы" — a per-workspace tree of folders and files. The
 * exported row type is `DocumentItem`, not `Document`: that name is a DOM
 * global and `z.infer` collides with it in DOM-lib packages (the same trap
 * `Event` hit in v0.10).
 */

export const documentKindSchema = z.enum(["folder", "file"]);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const documentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  /// null = at the workspace root.
  parentId: z.string().nullable(),
  kind: documentKindSchema,
  name: z.string(),
  /// file-only; null for folders.
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  checksum: z.string().nullable(),
  extractedText: z.string(),
  /// Non-null = in the trash (soft-deleted, restorable).
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type DocumentItem = z.infer<typeof documentSchema>;

/// Which slice the panel is showing. `trash` returns only soft-deleted rows.
/// A server-side concern, passed as `?view=`.
export const documentViewSchema = z.enum(["active", "trash"]);
export type DocumentView = z.infer<typeof documentViewSchema>;

// ---------------------------------------------------------------------------
// Name rules
//
// The `local` / `webdav` storage driver mirrors this tree as a real directory
// structure (see docs/HISTORY.md), so a name typed by the user must be a valid
// path segment on Windows and WebDAV alike — otherwise the DB name and the
// on-disk name would diverge. Names that come from an OS file drop are run
// through `sanitizeSegment` instead of being rejected (the user did not type
// them).
// ---------------------------------------------------------------------------

/** Characters no Windows/WebDAV path segment may contain. */
const FORBIDDEN_NAME_CHARS_G = /[<>:"/\\|?*]/g;
/** Reserved device names on Windows (any extension), case-insensitive. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
export const MAX_NAME_LENGTH = 255;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) < 32) return true;
  }
  return false;
}

/** True when `name` is safe to use verbatim as a folder/file name. */
export function isValidDocumentName(name: string): boolean {
  // Reject leading/trailing whitespace outright rather than trimming — the
  // stored name must equal what lands on disk.
  if (name !== name.trim()) return false;
  if (!name || name.length > MAX_NAME_LENGTH) return false;
  if (name === "." || name === "..") return false;
  if (hasControlChar(name)) return false;
  if (/[<>:"/\\|?*]/.test(name)) return false;
  if (RESERVED_NAMES.test(name)) return false;
  // A trailing dot is silently dropped by Windows.
  if (name.endsWith(".")) return false;
  return true;
}

const documentNameSchema = z
  .string()
  .min(1, "Имя обязательно")
  .max(MAX_NAME_LENGTH, `Не длиннее ${MAX_NAME_LENGTH} символов`)
  .refine((v) => isValidDocumentName(v), {
    message: 'Имя не может содержать спецсимволы < > : " / \\ | ? * или заканчиваться точкой/пробелом'
  });

export const createFolderInputSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: documentNameSchema
});
export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

export const updateDocumentInputSchema = z.object({
  name: documentNameSchema.optional(),
  parentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional()
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>;

export const bulkDocumentOpSchema = z.enum(["move", "trash", "restore", "purge"]);
export type BulkDocumentOp = z.infer<typeof bulkDocumentOpSchema>;

export const bulkDocumentInputSchema = z.object({
  op: bulkDocumentOpSchema,
  ids: z.array(z.string()).min(1).max(500),
  /// Required for `op: "move"` — the destination folder id, or null for root.
  parentId: z.string().nullable().optional()
});
export type BulkDocumentInput = z.infer<typeof bulkDocumentInputSchema>;

/**
 * Snapshot of a file's *previous* content, taken right before it's replaced
 * (`POST .../:id/content`) or before a restore overwrites it again — a
 * restore is itself undoable. `storageKey` is internal (mirrors `Document`:
 * a blob path is never handed to the client); this row is what the client
 * gets back from `GET .../:id/versions`.
 */
export const documentVersionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  versionNumber: z.number().int(),
  sizeBytes: z.number().int(),
  checksum: z.string(),
  mimeType: z.string().nullable(),
  createdAt: z.string()
});
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

/** ЗАРЕЗЕРВИРОВАНО, кода нет — см. комментарий к `documentVersionSchema` выше. */
export const documentAnnotationSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  page: z.number().int().nullable(),
  quote: z.string().nullable(),
  body: z.string(),
  color: z.string().nullable(),
  position: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type DocumentAnnotation = z.infer<typeof documentAnnotationSchema>;

export const createDocumentAnnotationInputSchema = z.object({
  page: z.number().int().min(1).nullable().optional(),
  quote: z.string().max(2_000).nullable().optional(),
  body: z.string().trim().min(1).max(10_000),
  color: z.string().max(32).nullable().optional(),
  position: z.unknown().nullable().optional()
});
export type CreateDocumentAnnotationInput = z.infer<typeof createDocumentAnnotationInputSchema>;

// ---------------------------------------------------------------------------
// Pure tree helpers — shared by the API service and the client, tested in
// `pnpm test` (see document-tree.test.ts). No I/O, no Prisma.
// ---------------------------------------------------------------------------

/**
 * Splits `"report.tar.gz"` into `["report.tar", ".gz"]`; `"README"` →
 * `["README", ""]`. A leading dot (`.env`) is part of the base, not an
 * extension.
 */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

/**
 * Returns `desired` if no case-insensitive match exists in `existing`,
 * otherwise the same name with ` (2)`, ` (3)`, … inserted before the
 * extension — `report.pdf` → `report (2).pdf`. Mirrors how a file manager
 * de-duplicates on copy/upload.
 */
export function nextAvailableName(existing: Iterable<string>, desired: string): string {
  const taken = new Set<string>();
  for (const n of existing) taken.add(n.toLowerCase());
  if (!taken.has(desired.toLowerCase())) return desired;
  const [base, ext] = splitExtension(desired);
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Practically unreachable — fall back to something unique-ish.
  return `${base} (${Date.now()})${ext}`;
}

/** Minimal node shape the tree helpers need. */
export interface DocTreeNode {
  id: string;
  parentId: string | null;
}

/**
 * True when `nodeId` sits anywhere below `maybeAncestorId` in the tree
 * (walking up `parentId`). Used for the move cycle-guard: moving `x` under
 * `target` is illegal when `target === x` or `isDescendant(nodes, target, x)`.
 */
export function isDescendant(
  nodes: Iterable<DocTreeNode>,
  nodeId: string,
  maybeAncestorId: string
): boolean {
  const parentOf = new Map<string, string | null>();
  for (const n of nodes) parentOf.set(n.id, n.parentId);
  let current = parentOf.get(nodeId) ?? null;
  const seen = new Set<string>();
  while (current) {
    if (current === maybeAncestorId) return true;
    if (seen.has(current)) return false; // guard against a pre-existing cycle
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * Coerces an arbitrary string (an OS filename) into a safe path segment:
 * forbidden characters and control chars → `_`, trailing dots/spaces trimmed,
 * reserved names prefixed, length capped. Never returns an empty string. Only
 * applied to names the user did not type (uploads) — typed names are
 * validated instead.
 */
export function sanitizeSegment(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i += 1) {
    out += name.charCodeAt(i) < 32 ? "_" : name[i];
  }
  out = out.replace(FORBIDDEN_NAME_CHARS_G, "_").replace(/[ .]+$/, "").trim();
  if (!out || out === "." || out === "..") out = "file";
  if (RESERVED_NAMES.test(out)) out = `_${out}`;
  if (out.length > MAX_NAME_LENGTH) {
    const [base, ext] = splitExtension(out);
    out = base.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return out;
}
