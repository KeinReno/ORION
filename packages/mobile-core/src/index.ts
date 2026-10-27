import { listSchema } from "@orion/shared-types";
import { mobileListDraftSchema, prepareListMutation, projectMobileListOp, type MobileListDraft, type MobileListMutation } from "./mobile-lists";
export * from "./mobile-lists";
import { z } from "zod";
import { persistedTaskSchema } from "./persisted-task";
export * from "./android-updates";
export * from "./mobile-finance";
import { mobileFinanceSchema, createMobileFinance, financeDraftSchema, applyFinanceEntry, type FinanceDraft } from "./mobile-finance";
export * from "./mobile-models";
export * from "./dictation";
export * from "./backup";
export * from "./mobile-replica";
export * from "./remote-client";
import { draftSchema, entryFields, pendingChecklistItems, type Draft } from "./mobile-models";
import { applyPortableRestore, type RestoreMode, type RestoreResult } from "./backup";
import { applyOpLocally, emptyEntities, type ReplicaEntityMap } from "@orion/core";
import {
  HlcClock, LAN_DEFAULT_PORT, normalizeOpFields, noteSchema, taskSchema,
  syncOpSchema, type Note, type Task, type SyncOp,
} from "@orion/shared-types";

export interface SnapshotStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

// A profile is deliberately not a connection or a grant to upload local data.
export const lanProfileSchema = z.object({
  address: z.string().trim().min(1).max(253).refine(
    (value) => /^[a-zA-Z0-9.-]+$/.test(value) && !value.includes(".."),
    "Укажите имя компьютера или IPv4 без https://, пути и пароля",
  ),
  port: z.number().int().min(1).max(65535).default(LAN_DEFAULT_PORT),
});
export type LanProfile = z.infer<typeof lanProfileSchema>;
export const mobileSettingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).default("system"),
  depthEffects: z.boolean().default(true),
  depthStrength: z.number().int().min(0).max(100).default(60),
  swipeGestures: z.boolean().default(false),
  darkTheme: z.enum(["kaiden-precision", "obsidian", "midnight", "emerald", "crimson"]).default("kaiden-precision"),
  autoCheckUpdates: z.boolean().default(true),
  downloadUpdatesOnWifi: z.boolean().default(false),
});
export type MobileSettings = z.infer<typeof mobileSettingsSchema>;
export const remoteSelectionSchema = z.object({
  nodeId: z.string(), fingerprint: z.string(), userId: z.string(),
  workspaceId: z.string(), workspaceName: z.string(),
});
export type RemoteSelection = z.infer<typeof remoteSelectionSchema>;
const snapshotSchema = z.object({
  finance: mobileFinanceSchema.nullable().default(null),
  version: z.literal(1),
  workspaceId: z.string().uuid(), deviceId: z.string().uuid(),
  deviceSeq: z.number().int().nonnegative(),
  clock: z.object({ wallMs: z.number().int().nonnegative(), counter: z.number().int().nonnegative() }),
  tasks: z.array(persistedTaskSchema), notes: z.array(noteSchema),
  lists: z.array(listSchema).default([]), listDrafts: z.record(mobileListDraftSchema).default({}),
  outbox: z.array(syncOpSchema),
  draft: draftSchema.nullable(),
  lan: lanProfileSchema.nullable(),
  // Additive migration for alpha.1; content/outbox/device identity are retained.
  settings: mobileSettingsSchema.default({}),
  lastBackupSeq: z.number().int().nonnegative().nullable().default(null),
  taskOrder: z.record(z.array(z.string().uuid())).default({}),
  remoteDrafts: z.record(draftSchema).default({}),
  remoteSelection: remoteSelectionSchema.nullable().default(null),
  remoteActive: z.boolean().default(false),
});
export type MobileSnapshot = z.infer<typeof snapshotSchema>;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export class MobileRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private readonly storage: SnapshotStorage, private state: MobileSnapshot) {}

  static async open(storage: SnapshotStorage): Promise<MobileRepository> {
    const raw = await storage.read();
    let state: MobileSnapshot;
    if (raw !== null) {
      // Never replace an unreadable/future-version database with an empty one.
      state = snapshotSchema.parse(JSON.parse(raw));
      if (state.outbox.some((op) => op.deviceId !== state.deviceId || op.deviceSeq > state.deviceSeq)
        || state.tasks.some((item) => item.workspaceId !== state.workspaceId)
        || state.notes.some((item) => item.workspaceId !== state.workspaceId)
        || state.lists.some((list) => list.workspaceId !== state.workspaceId || list.items.some((item) => item.listId !== list.id))) {
        throw new Error("Локальное хранилище не прошло проверку целостности");
      }
    } else {
      state = {
        finance: null,
        version: 1, workspaceId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
        deviceSeq: 0, clock: { wallMs: 0, counter: 0 },
        tasks: [], notes: [], lists: [], listDrafts: {}, outbox: [], draft: null, lan: null,
        settings: mobileSettingsSchema.parse({}),
        lastBackupSeq: null,
        taskOrder: {}, remoteDrafts: {},
        remoteSelection: null, remoteActive: false,
      };
      await storage.write(JSON.stringify(state));
    }
    if (!state.finance) {
      state.finance = createMobileFinance(state.workspaceId);
      await storage.write(JSON.stringify(state));
    }
    return new MobileRepository(storage, state);
  }

  snapshot(): MobileSnapshot { return structuredClone(this.state); }

  private transaction<T = void>(change: (next: MobileSnapshot) => T): Promise<T> {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const outcome = change(next);
      const raw = JSON.stringify(snapshotSchema.parse(next));
      if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Хранилище alpha заполнено. Данные сохранены; новую запись сохранить не удалось.");
      }
      await this.storage.write(raw);
      this.state = next;
      return outcome;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  saveTaskOrder(scope: string, ids: string[]): Promise<void> {
    return this.transaction((next) => {
      if (scope !== "phone" && !/^[a-f0-9]{64}$/.test(scope)) throw new Error("Неверное пространство порядка задач");
      const parsed = z.array(z.string().uuid()).max(50000).parse(ids);
      if (new Set(parsed).size !== parsed.length) throw new Error("Задача повторяется в порядке");
      next.taskOrder[scope] = parsed;
    });
  }
  saveFinanceDraft(draft: FinanceDraft | null): Promise<void> {
    return this.transaction((next) => {
      if (!next.finance) throw new Error("Финансы недоступны");
      next.finance.draft = draft ? financeDraftSchema.parse(draft) : null;
      next.lastBackupSeq = null;
    });
  }
  saveFinanceEntry(draft: FinanceDraft): Promise<void> {
    return this.transaction((next) => {
      if (!next.finance) throw new Error("Финансы недоступны");
      applyFinanceEntry(next.finance, next.workspaceId, draft);
      next.lastBackupSeq = null;
    });
  }
  deleteFinanceEntry(id: string): Promise<void> {
    return this.transaction((next) => {
      if (!next.finance) throw new Error("Финансы недоступны");
      next.finance.transactions = next.finance.transactions.filter((entry) => entry.id !== id);
      if (next.finance.draft?.id === id) next.finance.draft = null;
      for (const account of next.finance.accounts) account.balance = account.startingBalance + next.finance.transactions
        .filter((entry) => entry.accountId === account.id).reduce((sum, entry) => sum + (entry.type === "income" ? entry.totalAmount : -entry.totalAmount), 0);
      next.lastBackupSeq = null;
    });
  }

  saveDraft(draft: Draft | null): Promise<void> {
    return this.transaction((next) => { next.draft = draft ? draftSchema.parse(draft) : null; });
  }
  saveRemoteDraft(scope: string, draft: Draft | null): Promise<void> {
    return this.transaction((next) => {
      if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error("Неверное пространство черновика");
      if (draft) next.remoteDrafts[scope] = draftSchema.parse(draft);
      else delete next.remoteDrafts[scope];
    });
  }
  saveLan(profile: LanProfile): Promise<void> {
    return this.transaction((next) => { next.lan = lanProfileSchema.parse(profile); });
  }
  saveSettings(settings: z.input<typeof mobileSettingsSchema>): Promise<void> {
    return this.transaction((next) => { next.settings = mobileSettingsSchema.parse(settings); });
  }
  async patchSettings(patch: Partial<MobileSettings>): Promise<void> {
    const parsed = mobileSettingsSchema.partial().strict().parse(patch);
    return this.transaction((next) => { next.settings = mobileSettingsSchema.parse({ ...next.settings, ...parsed }); });
  }
  saveListDraft(scope: string, draft: MobileListDraft | null): Promise<void> {
    if (scope !== "phone" && !/^[a-f0-9]{64}$/.test(scope)) return Promise.reject(new Error("Неверная область черновика списка"));
    return this.transaction((next) => {
      if (draft) next.listDrafts[scope] = mobileListDraftSchema.parse(draft);
      else delete next.listDrafts[scope];
    });
  }
  mutateList(mutation: MobileListMutation, clearDraft = false): Promise<void> {
    return this.transaction((next) => {
      const command = prepareListMutation(next.lists, mutation);
      const clock = new HlcClock(next.deviceId, Date.now, next.clock);
      const op = syncOpSchema.parse({ ...command, opId: crypto.randomUUID(), deviceId: next.deviceId, deviceSeq: next.deviceSeq + 1, hlc: clock.now() });
      next.lists = projectMobileListOp(next.lists, op, next.workspaceId);
      next.outbox.push(op); next.deviceSeq = op.deviceSeq; next.clock = clock.state();
      const draft = next.listDrafts.phone;
      if (draft && ((clearDraft && draft.id === op.entityId) || (op.kind === "delete" && (draft.id === op.entityId || (op.entity === "list" && draft.parentId === op.entityId))))) delete next.listDrafts.phone;
    });
  }
  /** Validates and applies a portable backup in one atomic local write. */
  restoreBackup(raw: string, mode: RestoreMode): Promise<RestoreResult> {
    return this.transaction((next) => applyPortableRestore(next, raw, mode));
  }
  markBackup(sequence: number): Promise<void> {
    return this.transaction((next) => {
      if (!Number.isInteger(sequence) || sequence < 0 || sequence > next.deviceSeq) throw new Error("Некорректная версия копии");
      next.lastBackupSeq = sequence;
    });
  }
  setRemote(selection: RemoteSelection | null, active: boolean): Promise<void> {
    return this.transaction((next) => {
      next.remoteSelection = selection ? remoteSelectionSchema.parse(selection) : null;
      next.remoteActive = selection !== null && active;
    });
  }
  clearRemote(): Promise<void> {
    return this.transaction((next) => { next.remoteSelection = null; next.remoteActive = false; next.remoteDrafts = {}; next.listDrafts = next.listDrafts.phone ? { phone: next.listDrafts.phone } : {}; next.taskOrder = { phone: next.taskOrder.phone ?? [] }; });
  }

  saveEntry(draft: Draft): Promise<void> {
    const parsed = draftSchema.parse(draft);
    return this.transaction((next) => {
      const fields = entryFields(parsed);
      const parentId = this.apply(next, parsed.kind, parsed.id, fields);
      if (parsed.kind === "task" && parsed.checklist?.length) {
        const pending = pendingChecklistItems(parsed.checklist);
        const ids = new Set<string>();
        for (const item of pending) {
          if (ids.has(item.id) || item.id === parentId || next.tasks.some((task) => task.id === item.id)) {
            throw new Error("Пункт чек-листа повторяет существующую запись. Удалите его и добавьте снова.");
          }
          ids.add(item.id);
        }
        let sortOrder = next.tasks.filter((task) => task.parentId === parentId).reduce((max, task) => Math.max(max, task.sortOrder), 0);
        for (const item of pending) {
          sortOrder += 10;
          this.apply(next, "task", null, {
            title: item.title, description: "", priority: "normal", parentId, sortOrder,
            ...(item.done ? { status: "done" } : {}),
          }, false, item.id);
        }
      }
      next.draft = null;
    });
  }

  addTaskChecklistItem(parentId: string, title: string): Promise<void> {
    return this.transaction((next) => {
      if (!next.tasks.some((task) => task.id === parentId)) throw new Error("Родительская задача не найдена. Вернитесь к списку.");
      const clean = this.checklistTitle(title);
      const siblings = next.tasks.filter((task) => task.parentId === parentId);
      const sortOrder = siblings.reduce((max, task) => Math.max(max, task.sortOrder), 0) + 10;
      this.apply(next, "task", null, { title: clean, description: "", priority: "normal", parentId, sortOrder });
    });
  }
  renameTaskChecklistItem(id: string, title: string): Promise<void> {
    return this.transaction((next) => {
      const task = next.tasks.find((item) => item.id === id);
      if (!task?.parentId) throw new Error("Пункт чек-листа не найден. Вернитесь к списку.");
      this.apply(next, "task", id, { title: this.checklistTitle(title) });
    });
  }
  private checklistTitle(title: string): string {
    const clean = title.trim();
    if (!clean) throw new Error("Название пункта не может быть пустым.");
    if (clean.length > 200) throw new Error("Название пункта длиннее 200 символов.");
    return clean;
  }
  setTaskDone(id: string, done: boolean): Promise<void> {
    return this.transaction((next) => { this.apply(next, "task", id, { status: done ? "done" : "todo" }); });
  }
  setNotePinned(id: string, pinned: boolean): Promise<void> {
    return this.transaction((next) => { this.apply(next, "note", id, { pinnedAt: pinned ? new Date().toISOString() : null }); });
  }
  archiveNote(id: string, archived: boolean): Promise<void> {
    return this.transaction((next) => { this.apply(next, "note", id, { archivedAt: archived ? new Date().toISOString() : null }); });
  }

  deleteEntry(entity: "task" | "note", id: string): Promise<void> {
    return this.transaction((next) => {
      this.apply(next, entity, id, {}, true);
      if (next.draft?.kind === entity && next.draft.id === id) next.draft = null;
      if (entity === "task" && next.taskOrder.phone) next.taskOrder.phone = next.taskOrder.phone.filter((value) => value !== id);
    });
  }

  private apply(next: MobileSnapshot, entity: "task" | "note", id: string | null, fields: Record<string, unknown>, remove = false, createId?: string): string {
    const existing: Task | Note | undefined = id
      ? (entity === "task" ? next.tasks : next.notes).find((item) => item.id === id) : undefined;
    if (id && !existing) throw new Error("Запись не найдена. Вернитесь к списку.");
    const clock = new HlcClock(next.deviceId, Date.now, next.clock);
    const op: SyncOp = syncOpSchema.parse({
      opId: crypto.randomUUID(), deviceId: next.deviceId, deviceSeq: next.deviceSeq + 1,
      hlc: clock.now(), entity, entityId: id ?? createId ?? crypto.randomUUID(),
      kind: remove ? "delete" : id ? "patch" : "create",
      fields: normalizeOpFields(entity, fields),
      ...(existing ? { expectedRevision: existing.revision } : {}),
    });
    const entities: ReplicaEntityMap = emptyEntities();
    entities.task = Object.fromEntries(next.tasks.map((item) => [item.id, { ...item }]));
    entities.note = Object.fromEntries(next.notes.map((item) => [item.id, { ...item }]));
    applyOpLocally(entities, op, { userId: "local-device", workspaceId: next.workspaceId, userName: null });
    const doc = entities[entity][op.entityId];
    if (doc) doc.revision = existing ? existing.revision + 1 : 1;
    next.tasks = Object.values(entities.task).map((item) => taskSchema.parse(item));
    next.notes = Object.values(entities.note).map((item) => noteSchema.parse(item));
    next.outbox.push(op);
    next.deviceSeq = op.deviceSeq;
    next.clock = clock.state();
    return op.entityId;
  }
}
