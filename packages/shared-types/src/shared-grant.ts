import { z } from "zod";

/**
 * U09 (docs/HISTORY.md) — explicit,
 * read-only cross-workspace grants. Closed allowlist, DELIBERATELY a
 * subset of `SearchableEntityType`: only the four types the threat model's
 * permission matrix (раздел 3.1) defines a per-type allowlist for. `task`
 * and `event` are registered in `entity-registry.ts` for EntityLink but do
 * NOT get a grant-aware read path in this slice — adding one means adding
 * both a new value here AND a new `toShared*Dto`/RLS policy, not just
 * widening this enum.
 */
export const sharedGrantObjectTypeSchema = z.enum(["note", "document", "project", "transaction"]);
export type SharedGrantObjectType = z.infer<typeof sharedGrantObjectTypeSchema>;

/** `projection` is modeled but not implemented in the first slice (T6 — statistical disclosure risk, deliberately deferred). */
export const sharedGrantScopeSchema = z.enum(["full", "projection"]);
export type SharedGrantScope = z.infer<typeof sharedGrantScopeSchema>;

export const crossWorkspaceGrantSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  granterId: z.string(),
  granteeUserId: z.string(),
  objectType: sharedGrantObjectTypeSchema,
  objectId: z.string(),
  scope: sharedGrantScopeSchema,
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable()
});
export type CrossWorkspaceGrant = z.infer<typeof crossWorkspaceGrantSchema>;

/** UX flow (раздел 6): only three duration choices ever reach the server — no free-form relative durations. */
export const createGrantInputSchema = z.object({
  granteeUserId: z.string().min(1),
  objectType: sharedGrantObjectTypeSchema,
  objectId: z.string().min(1),
  // "none" | "7d" | "date" resolved to expiresAt server-side for "7d" (now()+7d
  // computed at creation time, not a drifting relative field); "date" carries
  // an explicit ISO string from the date picker.
  duration: z.union([
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("7d") }),
    z.object({ kind: z.literal("date"), expiresAt: z.string() })
  ])
});
export type CreateGrantInput = z.infer<typeof createGrantInputSchema>;

/** `GET /shared` row — enough to render "источник / режим / срок" per раздел 6, without fetching the object itself. */
export const sharedGrantSummarySchema = z.object({
  grantId: z.string(),
  objectType: sharedGrantObjectTypeSchema,
  sourceWorkspaceId: z.string(),
  sourceWorkspaceName: z.string(),
  expiresAt: z.string().nullable(),
  createdAt: z.string()
});
export type SharedGrantSummary = z.infer<typeof sharedGrantSummarySchema>;

/**
 * Per-type allowlisted DTOs for `GET /shared/:grantId`. Deliberately NOT the
 * same shape as the member-facing `Note`/`Document`/`Project`/`Transaction`
 * DTOs — see раздел 3.1: no FK traversal, no version history, no
 * finance/task fields on `project`.
 */
export const sharedNoteViewSchema = z.object({
  objectType: z.literal("note"),
  grantId: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string())
});
export type SharedNoteView = z.infer<typeof sharedNoteViewSchema>;

export const sharedDocumentViewSchema = z.object({
  objectType: z.literal("document"),
  grantId: z.string(),
  name: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable()
});
export type SharedDocumentView = z.infer<typeof sharedDocumentViewSchema>;

export const sharedProjectViewSchema = z.object({
  objectType: z.literal("project"),
  grantId: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  startAt: z.string().nullable(),
  dueAt: z.string().nullable()
});
export type SharedProjectView = z.infer<typeof sharedProjectViewSchema>;

export const sharedTransactionViewSchema = z.object({
  objectType: z.literal("transaction"),
  grantId: z.string(),
  type: z.string(),
  note: z.string(),
  occurredAt: z.string()
});
export type SharedTransactionView = z.infer<typeof sharedTransactionViewSchema>;

export const sharedObjectViewSchema = z.discriminatedUnion("objectType", [
  sharedNoteViewSchema,
  sharedDocumentViewSchema,
  sharedProjectViewSchema,
  sharedTransactionViewSchema
]);
export type SharedObjectView = z.infer<typeof sharedObjectViewSchema>;

/**
 * `GET workspaces/:id/grants` row — grants issued FROM this workspace, for
 * the owner's own "кому я дал доступ / отозвать" list (раздел 6, part 1.3
 * of the U09 UI backlog item — not the threat model doc itself, which only
 * specifies `GET /shared` for the grantee side). Resolves grantee
 * name/email server-side (same narrow `asSystem` display-name pattern
 * `SharedGrantsService.listMine` already uses for the source workspace's
 * name) so the owner doesn't have to cross-reference a bare user id.
 */
export const sharedGrantIssuedSchema = z.object({
  grantId: z.string(),
  objectType: sharedGrantObjectTypeSchema,
  objectId: z.string(),
  granteeUserId: z.string(),
  granteeName: z.string(),
  granteeEmail: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable()
});
export type SharedGrantIssued = z.infer<typeof sharedGrantIssuedSchema>;
