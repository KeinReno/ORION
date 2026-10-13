import { z } from "zod";

/**
 * One chronological feed over several journals (task changes, task comments, AI-agent
 * calls). Read-only: each source keeps its own table; this is only how they are merged.
 */
export const activityActorKindSchema = z.enum(["user", "agent", "unknown"]);
export type ActivityActorKind = z.infer<typeof activityActorKindSchema>;

export const activityKindSchema = z.enum(["task_change", "task_comment", "agent_call", "meter_reading"]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activityEntrySchema = z.object({
  /** Unique across sources: `<kind>:<row id>`. */
  id: z.string(),
  kind: activityKindSchema,
  at: z.string(),
  actorKind: activityActorKindSchema,
  actorName: z.string(),
  /** One finished sentence in Russian, e.g. «Статус: К выполнению → Готово». */
  summary: z.string(),
  /** What the entry is about, when it can be opened. */
  entity: z.object({ type: z.literal("task"), id: z.string(), title: z.string() }).nullable()
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
