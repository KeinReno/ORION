import { z } from "zod";
import { noteSchema, taskSchema, type Note, type Task } from "@orion/shared-types";
import { mobileFinanceSchema } from "./mobile-finance";
import { draftSchema } from "./mobile-models";
import type { MobileSnapshot } from "./index";

export const portableBackupSchema = z.object({
  format: z.literal("kaiden-orion-android-backup"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  local: z.object({ finance: mobileFinanceSchema.nullable().default(null), tasks: z.array(taskSchema), notes: z.array(noteSchema), draft: draftSchema.nullable(), remoteDrafts: z.record(draftSchema) }),
  remote: z.object({
    nodeId: z.string(), workspaceId: z.string(), workspaceName: z.string(),
    tasks: z.array(taskSchema), notes: z.array(noteSchema),
    conflicts: z.array(z.object({ entity: z.string(), entityId: z.string(), fields: z.record(z.unknown()).optional(), lost: z.record(z.unknown()).optional(), outcome: z.string() })).default([]),
  }).nullable(),
});
export function createPortableBackup(local: MobileSnapshot, remote: {
  nodeId: string; workspaceId: string; workspaceName: string; tasks: Task[]; notes: Note[];
  conflicts?: Array<{ entity: string; entityId: string; fields?: Record<string, unknown>; lost?: Record<string, unknown>; outcome: string }>;
} | null = null): string {
  const backup = portableBackupSchema.parse({
    format: "kaiden-orion-android-backup", version: 1, createdAt: new Date().toISOString(),
    local: { finance: local.finance, tasks: local.tasks, notes: local.notes, draft: local.draft, remoteDrafts: local.remoteDrafts }, remote,
  });
  return JSON.stringify(backup, null, 2);
}
