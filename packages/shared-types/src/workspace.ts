import { z } from "zod";
import { themeDocumentSchema } from "./theme-document";

export const workspaceRoleSchema = z.enum(["owner", "member", "lead"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: workspaceRoleSchema,
  /**
   * Domain modules turned off for this workspace. Empty = catalog defaults
   * (everything on). Disable never deletes rows — see `MODULE_CATALOG`.
   */
  disabledModules: z.array(z.string()),
  /** Plugin ids whose enabled state differs from PLUGIN_CATALOG's default — see `isPluginEnabled`. Same "disable ≠ delete" rule. */
  pluginOverrides: z.array(z.string()),
  /** Module ids visible only to `owner`/`lead` — see `isModuleRestricted`/`effectiveDisabledModules`. */
  restrictedModules: z.array(z.string()),
  /** ТЗ-05: личное пространство, созданное при регистрации — его нельзя открыть другим (приглашения отклоняются). */
  isPersonal: z.boolean(),
  /** Palette the owner set for everyone in this space (a copy, not a link to anyone's own theme); null = none. */
  theme: themeDocumentSchema.nullable()
});
export type Workspace = z.infer<typeof workspaceSchema>;

/**
 * v0 gives every registered user exactly one workspace; this (v0.13) is the
 * first way to create a second one — used for a separate "Демо" space kept
 * apart from real data, not a general multi-workspace feature yet (no
 * invites, no per-workspace billing, etc.).
 */
export const workspaceTemplateSchema = z.enum(["blank", "solo-dev", "home"]);
export type WorkspaceTemplate = z.infer<typeof workspaceTemplateSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(80),
  /**
   * `solo-dev` fills the space as a kernel for one person building a product (ORION).
   * `home` (ТЗ-05) — общий «Дом»: списки, задачи, календарь, дом/коммуналка, склад; финансы выключены (включаются в Настройки → Модули).
   */
  template: workspaceTemplateSchema.optional()
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

/** Rename only — owner-gated, see WorkspacesService.updateName. */
export const updateWorkspaceInputSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(80)
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

/**
 * U09 `GET workspaces/:id/members-search?q=` — a narrow "find a person I
 * already know" lookup for the grant-issue UI (27-U09-THREAT-MODEL.md,
 * раздел 6, step 2: "указал получателя"). Deliberately scoped to members of
 * ONE workspace the caller already owns, not a global user search — see the
 * endpoint's own doc comment in `workspaces.service.ts` for why.
 */
export const workspaceMemberSearchResultSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  name: z.string()
});
export type WorkspaceMemberSearchResult = z.infer<typeof workspaceMemberSearchResultSchema>;

/**
 * R29-05 (docs/HISTORY.md) — `GET
 * /users/resolve-by-email?email=` result for the grant-issue "по email"
 * flow. Deliberately minimal and deliberately NOT distinguishable between
 * "no such account" and "account exists but can't be resolved" — a neutral
 * `found: false` either way, so this endpoint can't be used as an oracle to
 * enumerate registered emails. `found: true` carries only the minimum the
 * grant picker needs (id + display name), never the email back (the caller
 * already knows it — they typed it).
 */
export const resolveUserByEmailResultSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(true), userId: z.string(), name: z.string() }),
  z.object({ found: z.literal(false) })
]);
export type ResolveUserByEmailResult = z.infer<typeof resolveUserByEmailResultSchema>;
