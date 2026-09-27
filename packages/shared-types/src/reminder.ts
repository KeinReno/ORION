import { z } from "zod";
import { searchableEntityTypeSchema } from "./search";

/**
 * U03 (24-CONNECTED-CORE-BACKLOG.md): personal one-shot reminder against any
 * entity from the closed U01 registry (`SearchableEntityType`). This is a
 * NEW, separate entity — it does not replace or reuse
 * `DueTaskCheckerService`/`EventReminderService`
 * (23-UNIVERSAL-CONNECTED-CORE.md is explicit: "не переписывать без
 * миграционного плана"). First slice is personal: `recipientId` is always
 * the creator, delivered through the existing addressed `Notification`
 * (recipientId/eventKey) via `ReminderCheckerService`.
 */
export const entityReminderStatusSchema = z.enum(["pending", "delivered", "cancelled"]);
export type EntityReminderStatus = z.infer<typeof entityReminderStatusSchema>;

export const entityReminderSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  ownerId: z.string(),
  recipientId: z.string(),
  entityType: searchableEntityTypeSchema,
  entityId: z.string(),
  entityTitle: z.string().nullable(),
  scheduledAt: z.string(),
  timezone: z.string(),
  status: entityReminderStatusSchema,
  deliveredAt: z.string().nullable(),
  createdAt: z.string()
});
export type EntityReminder = z.infer<typeof entityReminderSchema>;

export const createEntityReminderInputSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: z.string(),
  /** ISO instant — the client resolves the picked local date/time to UTC before sending. */
  scheduledAt: z.string(),
  /** IANA zone, e.g. "Europe/Moscow" — kept for display, does not affect delivery instant. */
  timezone: z.string()
});
export type CreateEntityReminderInput = z.infer<typeof createEntityReminderInputSchema>;
