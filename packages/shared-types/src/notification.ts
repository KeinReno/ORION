import { z } from "zod";

export const notificationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /**
   * Who this notification is addressed to (a User id). Legacy rows created
   * before v0.28's addressed-notifications rework have `recipientId: null` —
   * they are excluded from `GET .../notifications` (see
   * `NotificationCenterService.list`), a deliberate "legacy archive": kept
   * in the database for audit, never surfaced as someone's unread item
   * again because no single member is the rightful "owner" of that old,
   * workspace-wide row.
   */
  recipientId: z.string().nullable(),
  kind: z.enum([
    "task_due",
    "event_reminder",
    "finance_alert",
    "inventory_low_stock",
    "task_comment",
    "project_update",
    "entity_reminder",
    "system"
  ]),
  title: z.string(),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string()
});
export type Notification = z.infer<typeof notificationSchema>;
