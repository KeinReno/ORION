import { searchableEntityTypeSchema, type Notification, type SearchableEntityType } from "@orion/shared-types";

export type NotificationTarget =
  | { kind: "entity"; type: SearchableEntityType; id: string }
  | { kind: "panel"; panelId: "finance" | "inventory" };

/** Notification kinds are broader than searchable records; only advertise navigation we can perform. */
export function notificationTarget(item: Notification): NotificationTarget | null {
  if (item.entityId) {
    const entityType = searchableEntityTypeSchema.safeParse(item.entityType);
    if (entityType.success) return { kind: "entity", type: entityType.data, id: item.entityId };
  }

  if (item.entityType === "budget" || item.kind === "finance_alert") {
    return { kind: "panel", panelId: "finance" };
  }
  if (item.entityType === "inventory_item" || item.kind === "inventory_low_stock") {
    return { kind: "panel", panelId: "inventory" };
  }
  return null;
}
