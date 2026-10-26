import { taskSchema } from "@orion/shared-types";

/** Android v1 snapshots, cached replicas and backups predate task checklists.
 * Only missing data gets the additive default; malformed checklists still fail.
 * The public task/wire contract stays strict.
 */
export const persistedTaskSchema = taskSchema.extend({ checklist: taskSchema.shape.checklist.default([]) });
