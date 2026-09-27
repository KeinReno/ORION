import type { InboxItem } from "@orion/shared-types";
import { isSameDay } from "../../lib/format";

export type InboxGroupBy = "none" | "project" | "date";

export interface InboxGroup {
  key: string;
  label: string;
  items: InboxItem[];
}

const DATE_ORDER = ["today", "yesterday", "week", "older"];

/**
 * Group the remaining queue under the current thought. `none` is a flat list.
 */
export function groupInboxItems(
  items: InboxItem[],
  groupBy: InboxGroupBy,
  projectNames: Map<string, string>
): InboxGroup[] {
  if (items.length === 0) return [];
  if (groupBy === "none") return [{ key: "all", label: "К разбору", items }];

  const buckets = new Map<string, InboxGroup>();
  function push(key: string, label: string, item: InboxItem): void {
    const group = buckets.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    buckets.set(key, group);
  }

  if (groupBy === "project") {
    for (const item of items) {
      if (!item.projectId) push("none", "Без проекта", item);
      else push(item.projectId, projectNames.get(item.projectId) ?? "Проект", item);
    }
    return [...buckets.values()].sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.label.localeCompare(b.label, "ru");
    });
  }

  for (const item of items) {
    const bucket = createdBucket(item.createdAt);
    push(bucket.key, bucket.label, item);
  }
  return DATE_ORDER.flatMap((key) => {
    const group = buckets.get(key);
    return group ? [group] : [];
  });
}

function createdBucket(iso: string): { key: string; label: string } {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return { key: "today", label: "Сегодня" };
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(date, yesterday)) return { key: "yesterday", label: "Вчера" };
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  if (date.getTime() >= week.getTime()) return { key: "week", label: "На этой неделе" };
  return { key: "older", label: "Раньше" };
}

export function isInboxGroupBy(value: string): value is InboxGroupBy {
  return value === "none" || value === "project" || value === "date";
}
