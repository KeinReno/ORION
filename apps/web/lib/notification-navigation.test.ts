import type { Notification } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { notificationTarget } from "./notification-navigation";

function notification(patch: Partial<Notification>): Notification {
  return {
    id: "notification-1",
    workspaceId: "workspace-1",
    recipientId: "user-1",
    kind: "entity_reminder",
    title: "Напоминание",
    body: "",
    entityType: null,
    entityId: null,
    readAt: null,
    createdAt: "2026-10-14T00:00:00.000Z",
    ...patch
  };
}

describe("notificationTarget", () => {
  it("opens every supported record, including project updates and document reminders", () => {
    expect(notificationTarget(notification({ kind: "project_update", entityType: "project", entityId: "project-1" })))
      .toEqual({ kind: "entity", type: "project", id: "project-1" });
    expect(notificationTarget(notification({ entityType: "document", entityId: "document-1" })))
      .toEqual({ kind: "entity", type: "document", id: "document-1" });
    expect(notificationTarget(notification({ entityType: "transaction", entityId: "transaction-1" })))
      .toEqual({ kind: "entity", type: "transaction", id: "transaction-1" });
  });

  it("opens the relevant panel for alerts without a record focus route", () => {
    expect(notificationTarget(notification({ kind: "finance_alert", entityType: "budget", entityId: "budget-1" })))
      .toEqual({ kind: "panel", panelId: "finance" });
    expect(notificationTarget(notification({ kind: "inventory_low_stock", entityType: "inventory_item", entityId: "item-1" })))
      .toEqual({ kind: "panel", panelId: "inventory" });
  });

  it("does not suggest navigation for a system message or unsupported record", () => {
    expect(notificationTarget(notification({ kind: "system" }))).toBeNull();
    expect(notificationTarget(notification({ entityType: "habit", entityId: "habit-1" }))).toBeNull();
    expect(notificationTarget(notification({ entityType: "note" }))).toBeNull();
  });
});
