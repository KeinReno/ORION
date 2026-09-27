import { z } from "zod";
import { accountSchema } from "./finance";
import { taskSchema } from "./task";

/**
 * U08 "Личный межпространственный обзор" (24-CONNECTED-CORE-BACKLOG.md).
 *
 * This is a *read-only aggregation*, not a new access path: every row here
 * was already independently readable by the caller inside its own
 * workspace (see OverviewService — each workspace is queried through its
 * own `PrismaService.withUser` transaction, exactly like every other
 * per-workspace read). It grants no new rights, creates no rows, and isn't
 * backed by a table of its own — nothing to add to the snapshot registry
 * (`apps/api/src/sync/snapshot-registry.ts`) or to Search/export, which
 * both stay workspace-scoped (23-UNIVERSAL-CONNECTED-CORE.md "Межпространственные
 * данные: отдельный этап").
 */

/** The workspace list this overview drew from — always shown so "explicit scope" (U08 done-criterion) has something to pick from for capture/account pickers. */
export const myOverviewWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  tasksEnabled: z.boolean(),
  financeEnabled: z.boolean()
});
export type MyOverviewWorkspace = z.infer<typeof myOverviewWorkspaceSchema>;

/** A task assigned to the caller, tagged with the workspace it lives in — "источник каждой записи видим" (U08). */
export const myOverviewTaskSchema = taskSchema.extend({
  workspaceName: z.string()
});
export type MyOverviewTask = z.infer<typeof myOverviewTaskSchema>;

/**
 * An account from a workspace the caller is a member of, tagged with its
 * workspace. ORION has no read-only-account concept — access is
 * workspace-membership-level only (owner/member/lead), not per-account —
 * so every account returned here is one the caller could also create a
 * transaction against; see OverviewService doc comment for detail. That is
 * the entire content of "read-only account не предлагается для списания"
 * for this codebase: there is nothing to filter out yet.
 */
export const myOverviewAccountSchema = accountSchema.extend({
  workspaceName: z.string()
});
export type MyOverviewAccount = z.infer<typeof myOverviewAccountSchema>;

export const myOverviewSchema = z.object({
  workspaces: z.array(myOverviewWorkspaceSchema),
  tasks: z.array(myOverviewTaskSchema),
  accounts: z.array(myOverviewAccountSchema),
  /** Deduplicated (by account id) balances grouped by currency — see `sumByCurrency` on the client for the same pattern applied to a single workspace. */
  balancesByCurrency: z.array(z.tuple([z.string(), z.number()]))
});
export type MyOverview = z.infer<typeof myOverviewSchema>;
