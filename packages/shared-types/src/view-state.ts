import { z } from "zod";

/**
 * Serializable per-panel view state (filters, sort, selected object id). It is a *device-local
 * convenience*, keyed by user + workspace, stored apart from the Dockview geometry. Deliberately
 * never stored: record content, free-text search, tokens, scroll positions of data lists.
 * The schemas are strict and bounded, so a stale or hand-edited value is dropped, not trusted.
 * A restored object id grants nothing — the panel still loads it through its access-checked API.
 */
export type ViewStateSchema<T> = z.ZodType<T>;
export const VIEW_STATE_VERSION = 1;
const MAX_PANELS = 40;

export const viewStateKey = (userId: string, workspaceId: string): string => `orion.viewState:${userId}:${workspaceId}`;

const id = z.string().uuid();

export const tasksViewStateSchema = z.object({
  dueFilter: z.enum(["all", "overdue", "today", "week", "none"]),
  statusFilter: z.array(z.enum(["backlog", "todo", "in_progress", "done", "canceled"])).max(5),
  priorityFilter: z.array(z.enum(["low", "normal", "high"])).max(3),
  groupBy: z.enum(["status", "project", "due", "priority"]),
  projectFilter: id.nullable(),
  editingId: id.nullable()
}).strict();
export type TasksViewState = z.infer<typeof tasksViewStateSchema>;

export const notesViewStateSchema = z.object({
  view: z.enum(["active", "archive", "trash"]),
  sort: z.enum(["updated", "created", "title"]),
  groupByProject: z.boolean(),
  tagFilters: z.array(z.string().min(1).max(64)).max(20),
  tagMode: z.enum(["any", "all"]),
  projectFilter: id.nullable(),
  pinnedOnly: z.boolean(),
  selectedId: id.nullable()
}).strict();
export type NotesViewState = z.infer<typeof notesViewStateSchema>;

interface Envelope { v: number; state: unknown }
type Store = Record<string, Envelope>;

function readStore(storage: Pick<Storage, "getItem">, key: string): Store {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** Older versions would be migrated here; today only the current one exists, anything else is dropped. */
export function readViewState<T>(storage: Pick<Storage, "getItem">, key: string, panelId: string, schema: z.ZodType<T>): T | null {
  const entry = readStore(storage, key)[panelId];
  if (!entry || typeof entry !== "object" || entry.v !== VIEW_STATE_VERSION) return null;
  const parsed = schema.safeParse(entry.state);
  return parsed.success ? parsed.data : null;
}

export function writeViewState<T>(storage: Pick<Storage, "getItem" | "setItem">, key: string, panelId: string, schema: z.ZodType<T>, state: T): void {
  const checked = schema.safeParse(state);
  if (!checked.success) return;
  try {
    const store = readStore(storage, key);
    delete store[panelId];
    store[panelId] = { v: VIEW_STATE_VERSION, state: checked.data };
    const ids = Object.keys(store);
    for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_PANELS))) delete store[stale];
    storage.setItem(key, JSON.stringify(store));
  } catch {
    /* a remembered view is a convenience only */
  }
}
