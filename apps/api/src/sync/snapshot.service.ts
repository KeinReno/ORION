import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { INCLUDED_SNAPSHOT_KEYS } from "./snapshot-registry";

/**
 * ORION — сериализация всего рабочего пространства в один снапшот и обратный
 * upsert. Это фундамент Стадии 1 («бэкап/восстановление», одна нода, одно
 * направление, без слияния — см. `docs/SYNC.md` §5).
 *
 * Единица бэкапа — не файл, а строка модуля. Полный реестр классификации
 * (included/derived/excluded + причина, для каждой Prisma-модели) —
 * `snapshot-registry.ts`; `snapshot.integration.test.ts` сверяет его с
 * реальной Prisma DMMF на каждый прогон, так что забытая новая модель ломает
 * тест, а не тихо выпадает из бэкапа. Порядок ниже — топологический по
 * внешним ключам: при вставке идём сверху вниз (родитель раньше ребёнка),
 * при очистке — снизу вверх. **Добавил модуль X → добавь строку и в
 * `SNAPSHOT_MODELS`, и в `SNAPSHOT_MODEL_REGISTRY`** (зеркалит «модульный
 * контракт» из `CLAUDE.md`).
 */

type Tx = Prisma.TransactionClient;

interface ModelSpec {
  /** Ключ в снапшоте и подпись в счётчиках. */
  key: string;
  load: (tx: Tx, workspaceId: string) => Promise<unknown[]>;
  clear: (tx: Tx, workspaceId: string) => Promise<unknown>;
  insert: (tx: Tx, rows: unknown[]) => Promise<unknown>;
}

/**
 * Порядок = родитель раньше ребёнка. Очистка идёт в обратном порядке.
 *
 * Every model here was cross-checked against every `onDelete: SetNull`/
 * `Cascade` FK in schema.prisma that has a workspaceId — this list was
 * missing projects, time entries, habits, task dependencies, saved views,
 * calendar connections, category rules, savings goals, note attachments,
 * inbox items and entity links (added 2026-09-15), which meant a
 * backup/restore silently dropped all of that data, and — since Note/Task/
 * Event/Document/Transaction/TimeEntry all hold an optional `projectId` FK —
 * restoring into a workspace whose projects had changed could fail outright
 * with a foreign-key violation. `projects` must load before every model that
 * references it.
 *
 * S03a audit (2026-09-21) found a second, identical-shaped gap: `milestones`/
 * `milestoneDependencies` (v0.27 Gantt), `inventoryItems`/`inventoryMovements`
 * (v0.26) and `documentVersions`/`documentAnnotations` existed in
 * `schema.prisma` with a `workspaceId` and a cascade FK, but were never added
 * here — six tables silently dropped by every backup since their release.
 * Found this time by a coverage test (`snapshot.integration.test.ts`) that
 * derives the "must be classified" set from Prisma DMMF instead of trusting
 * this list to be complete by inspection, per S03a in 10-BACKLOG.md.
 */
const SNAPSHOT_MODELS: ModelSpec[] = [
  spec("opportunities", (tx) => tx.opportunity),
  spec("opportunityProfiles", (tx) => tx.opportunityProfile),
  spec("opportunityFacts", (tx) => tx.opportunityFact),
  spec("opportunityTracks", (tx) => tx.opportunityTrack),
  spec("opportunityMaterials", (tx) => tx.opportunityMaterial),
  specCanceledImports("opportunityImports", (tx) => tx.opportunityImport),
  spec("opportunityCaptures", (tx) => tx.opportunityCapture),
  spec("opportunityHistory", (tx) => tx.opportunityHistory),
  spec("opportunityAssessments", (tx) => tx.opportunityAssessment),
  specResetDraftApproval("opportunityDrafts", (tx) => tx.opportunityDraft),
  specRestoredConnections("opportunityConnections", (tx) => tx.opportunityConnection),
  specRestoredAttempts("opportunityAttempts", (tx) => tx.opportunityAttempt),
  specRestoredPolicies("opportunityPolicies", (tx) => tx.opportunityPolicy),
  spec("opportunityManagerActions", (tx) => tx.opportunityManagerAction),
  spec("projects", (tx) => tx.project),
  spec("homes", (tx) => tx.home),
  spec("meters", (tx) => tx.meter),
  spec("meterReadings", (tx) => tx.meterReading),
  spec("homeUtilityMonths", (tx) => tx.homeUtilityMonth),
  spec("homeElectricityTariffs", (tx) => tx.homeElectricityTariff),
  spec("contacts", (tx) => tx.contact),
  spec("contactInteractions", (tx) => tx.contactInteraction),
  spec("contactRelations", (tx) => tx.contactRelation),
  spec("milestones", (tx) => tx.milestone),
  specSelfRef("goals", (tx) => tx.goal),
  spec("goalPlans", (tx) => tx.goalPlan),
  spec("financeAccounts", (tx) => tx.account),
  spec("financeCategories", (tx) => tx.financeCategory),
  spec("calendarConnections", (tx) => tx.calendarConnection),
  spec("habits", (tx) => tx.habit),
  spec("lists", (tx) => tx.list),
  spec("savedTaskViews", (tx) => tx.savedTaskView),
  spec("inboxItems", (tx) => tx.inboxItem),
  spec("entityLinks", (tx) => tx.entityLink),
  // U03: personal one-shot reminders — pending intent is genuine user data
  // (like a task's dueAt), not a delivery log (that's `Notification`/
  // `SentReminder`, both ephemeral-excluded below in snapshot-registry.ts).
  // No self-reference/ordering dependency; ownerId/recipientId (User) are
  // identity-excluded and must already exist at the restore target, same
  // precondition TaskComment.userId already relies on.
  spec("entityReminders", (tx) => tx.entityReminder),
  spec("notes", (tx) => tx.note),
  spec("noteLinks", (tx) => tx.noteLink),
  spec("noteRevisions", (tx) => tx.noteRevision),
  // Self-referencing (parentId, TaskTree) — row order inside the array
  // matters: a plain `findMany`/`createMany` roundtrip is NOT guaranteed to
  // put a parent row before its child, and Postgres checks a (non-deferred,
  // Prisma default) FK immediately per inserted row even within one
  // multi-row INSERT, so a depth-2+ subtree loaded in the "wrong" row order
  // fails restore with a foreign-key violation. `specSelfRef` topologically
  // sorts rows by `parentId` before both load-for-snapshot (so the file
  // itself, if ever inspected/edited by hand, is already sane) and insert.
  specSelfRef("tasks", (tx) => tx.task),
  spec("taskDependencies", (tx) => tx.taskDependency),
  spec("taskComments", (tx) => tx.taskComment),
  spec("taskActivities", (tx) => tx.taskActivity),
  // UI-05: authorId (User) is identity-excluded and must exist at the restore
  // target, same precondition as TaskComment.userId; projects load earlier.
  spec("projectStatusUpdates", (tx) => tx.projectStatusUpdate),
  // Ideas/problems. taskId is nullable and points at a task loaded above;
  // a null link does not wait on tasks, a set one does.
  spec("captures", (tx) => tx.capture),
  spec("milestoneDependencies", (tx) => tx.milestoneDependency),
  spec("events", (tx) => tx.event),
  spec("eventOverrides", (tx) => tx.eventOverride),
  specSelfRef("documents", (tx) => tx.document),
  spec("documentVersions", (tx) => tx.documentVersion),
  spec("documentAnnotations", (tx) => tx.documentAnnotation),
  spec("noteAttachments", (tx) => tx.noteAttachment),
  spec("financeTransactions", (tx) => tx.transaction),
  spec("financeTransactionLines", (tx) => tx.transactionLine),
  spec("homeUtilityPayments", (tx) => tx.homeUtilityPayment),
  specBudgets("financeBudgets", (tx) => tx.budget),
  spec("financeRecurring", (tx) => tx.recurringTransaction),
  spec("financeCategoryRules", (tx) => tx.categoryRule),
  spec("financeSavingsGoals", (tx) => tx.savingsGoal),
  spec("financeObligations", (tx) => tx.financeObligation),
  spec("financeTemplates", (tx) => tx.financeTemplate),
  // Shares reference their split, so the split rows are inserted first.
  spec("financeSplits", (tx) => tx.financeSplit),
  spec("financeSplitShares", (tx) => tx.financeSplitShare),
  spec("financeSettlements", (tx) => tx.financeSettlement),
  spec("financeExchangeRates", (tx) => tx.financeExchangeRate),
  spec("marketWatchItems", (tx) => tx.marketWatchItem),
  spec("investmentTrades", (tx) => tx.investmentTrade),
  spec("timeEntries", (tx) => tx.timeEntry),
  spec("habitEntries", (tx) => tx.habitEntry),
  spec("inventoryItems", (tx) => tx.inventoryItem),
  spec("inventoryMovements", (tx) => tx.inventoryMovement),
  // After inventory: a list item may point at a stock item and at the receipt its purchase created.
  spec("listItems", (tx) => tx.listItem),
  // R29-02: grants are kept in the snapshot for audit (an owner inspecting
  // an old backup should still see "I once shared X with Y"), but restore
  // must never reactivate external access that has since been revoked —
  // see specGrants() below for why every restored row is force-revoked.
  specGrants("crossWorkspaceGrants", (tx) => tx.crossWorkspaceGrant)
];

// Fails at import time (not silently at runtime) if `snapshot-registry.ts`
// and this list ever disagree on the *set* of included keys — belt-and-
// suspenders alongside the DMMF-driven integration test, cheap enough to
// leave in production code.
{
  const here = new Set(SNAPSHOT_MODELS.map((m) => m.key));
  const registered = INCLUDED_SNAPSHOT_KEYS;
  const missingFromCode = [...registered].filter((k) => !here.has(k));
  const missingFromRegistry = [...here].filter((k) => !registered.has(k));
  if (missingFromCode.length > 0 || missingFromRegistry.length > 0) {
    throw new Error(
      `snapshot.service.ts SNAPSHOT_MODELS и snapshot-registry.ts разошлись: ` +
        `есть в реестре, нет в коде: [${missingFromCode.join(", ")}]; ` +
        `есть в коде, нет в реестре: [${missingFromRegistry.join(", ")}]`
    );
  }
}

/**
 * Минимум методов Prisma-делегата, которым пользуется снапшот. Все наши
 * workspace-таблицы этот минимум реализуют, поэтому `spec` строится из
 * одного делегата. `transactionLine` и `eventOverride` фильтруются по
 * денормализованному `workspaceId` — он на них есть (см. `schema.prisma`).
 */
interface WsDelegate {
  findMany(args: { where: { workspaceId: string } }): Promise<unknown[]>;
  deleteMany(args: { where: { workspaceId: string } }): Promise<unknown>;
  createMany(args: { data: unknown[]; skipDuplicates?: boolean }): Promise<unknown>;
}

function specResetDraftApproval(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  const reset = (row: Record<string, unknown>) => (row.reviewState === "approved" ? { ...row, reviewState: "draft", approvedBy: null, approvedAt: null, approvedTextHash: null, revision: Number(row.revision ?? 0) + 1 } : row);
  return { ...base, insert: (tx, rows) => base.insert(tx, (rows as Array<Record<string, unknown>>).map(reset)) };
}

function specRestoredConnections(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  // A backup never carries a live link: the runner token and pairing code are dropped, the owner must link the account again.
  const reset = (row: Record<string, unknown>) => ({ ...row, state: "pending_link", runnerTokenHash: null, pairingHash: null, pairingExpiresAt: null, runnerId: null, runnerSeenAt: null, linkedAt: null, consecutiveFailures: 0, pausedReason: "Восстановлено из резервной копии: войдите заново", revision: Number(row.revision ?? 0) + 1 });
  // The runner token hash and pairing hash never leave the node, not even inside a backup file.
  const strip = (row: Record<string, unknown>) => ({ ...row, runnerTokenHash: null, pairingHash: null, pairingExpiresAt: null });
  return { ...base, load: async (tx, workspaceId) => ((await base.load(tx, workspaceId)) as Array<Record<string, unknown>>).map(strip), insert: (tx, rows) => base.insert(tx, (rows as Array<Record<string, unknown>>).map(reset)) };
}

function specRestoredAttempts(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  // The queue is never resumed from a backup. A send that may already have happened stays unconfirmed (never "not sent").
  const reset = (row: Record<string, unknown>) => {
    const state = String(row.state);
    const open = state === "awaiting_approval" || state === "queued" || state === "running";
    if (!open) return row;
    const maybeSent = state === "running" && row.submitReserved === true;
    return { ...row, state: maybeSent ? "sent_unconfirmed" : "canceled", leaseHash: null, leaseRunnerId: null, leaseExpiresAt: null, cancelRequested: false, completedAt: new Date(), errorCode: maybeSent ? "restored_unconfirmed" : "restored_from_backup", message: maybeSent ? "Восстановлено из копии: отправка могла произойти. Сверьте на стороне HH." : "Восстановлено из резервной копии: очередь не возобновляется автоматически.", revision: Number(row.revision ?? 0) + 1 };
  };
  return { ...base, insert: (tx, rows) => base.insert(tx, (rows as Array<Record<string, unknown>>).map(reset)) };
}

function specRestoredPolicies(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  // Autonomy never comes back from a backup: every policy returns paused and must be resumed by the owner after re-linking the account.
  const reset = (row: Record<string, unknown>) => (row.state === "active" ? { ...row, state: "paused", pausedReason: "Восстановлено из резервной копии: проверьте и возобновите вручную", revision: Number(row.revision ?? 0) + 1 } : row);
  return { ...base, insert: (tx, rows) => base.insert(tx, (rows as Array<Record<string, unknown>>).map(reset)) };
}

function specCanceledImports(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  return { ...base, insert: (tx, rows) => base.insert(tx, (rows as Array<Record<string, unknown>>).map((row) => ({ ...row, status: "canceled", revision: Number(row.revision ?? 0) + 1 }))) };
}

function spec(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const as = (tx: Tx): WsDelegate => pick(tx) as WsDelegate;
  return {
    key,
    load: (tx, workspaceId) => as(tx).findMany({ where: { workspaceId } }),
    clear: (tx, workspaceId) => as(tx).deleteMany({ where: { workspaceId } }),
    insert: (tx, rows) =>
      rows.length === 0
        ? Promise.resolve()
        : as(tx).createMany({ data: rows, skipDuplicates: true })
  };
}

/**
 * `Budget.currency` (миграция 20261017100000_budget_currency) — снапшот, снятый
 * до неё, несёт бюджеты без валюты. Без этой подстановки `createMany` поставил
 * бы колоночный DEFAULT 'RUB', и долларовое пространство после восстановления
 * получило бы рублёвые лимиты. Правило — то же, что у миграции: если все счета
 * пространства (они восстанавливаются раньше, см. порядок SNAPSHOT_MODELS) в
 * одной валюте — она; иначе 'RUB', в которой лимиты тогда и показывались.
 */
function specBudgets(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  return {
    ...base,
    insert: async (tx, rows) => {
      const budgets = rows as Array<Record<string, unknown>>;
      const legacy = budgets.filter((row) => typeof row.currency !== "string");
      if (legacy.length === 0) return base.insert(tx, rows);
      const workspaceIds = [...new Set(legacy.map((row) => String(row.workspaceId)))];
      const accounts = await tx.account.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { workspaceId: true, currency: true } });
      const single = new Map<string, string>();
      for (const workspaceId of workspaceIds) {
        const currencies = new Set(accounts.filter((a) => a.workspaceId === workspaceId).map((a) => a.currency));
        if (currencies.size === 1) single.set(workspaceId, [...currencies][0]!);
      }
      return base.insert(
        tx,
        budgets.map((row) => (typeof row.currency === "string" ? row : { ...row, currency: single.get(String(row.workspaceId)) ?? "RUB" }))
      );
    }
  };
}

interface SelfRefRow {
  id: string;
  parentId?: string | null;
}

/**
 * Topological sort by `parentId` within one table's own rows: every row is
 * placed after its parent (if the parent is present in the same array —
 * it always is here, since both `tasks` and `documents` load their full
 * workspace in one `findMany`). A cycle can't come from the app (the API
 * layer rejects them — see CLAUDE.md "подзадачи"), but a corrupted/hand-
 * edited snapshot file could contain one; that throws rather than looping
 * forever or silently dropping rows.
 */
export function toposortByParent<T extends SelfRefRow>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const result: T[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  function visit(row: T): void {
    if (done.has(row.id)) return;
    if (visiting.has(row.id)) {
      throw new Error(`snapshot: цикл в дереве parentId на строке ${row.id}`);
    }
    visiting.add(row.id);
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) visit(parent);
    visiting.delete(row.id);
    done.add(row.id);
    result.push(row);
  }

  for (const row of rows) visit(row);
  return result;
}

function specSelfRef(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  return {
    ...base,
    insert: (tx, rows) => base.insert(tx, toposortByParent(rows as SelfRefRow[]))
  };
}

/**
 * R29-02: `CrossWorkspaceGrant` restore must never silently reopen access
 * that the owner has since revoked. A grant taken from an OLDER snapshot
 * than the current revoke, or a grant that was simply still active
 * (`revokedAt: null`) at backup time, would otherwise come back active on
 * `apply()` — the exact "restore re-grants what I revoked" bug reported in
 * R29-02.
 *
 * Chosen contract (approach "б" from
 * docs/HISTORY.md): keep restoring the rows
 * (so an owner can still see "I once shared X with Y" for audit after a
 * restore, and so restoring a snapshot that predates a grant's creation
 * doesn't need special-casing), but force EVERY restored row's `revokedAt`
 * to the moment of restore when the snapshot itself didn't already record a
 * revoke. A grant that was already revoked before the backup was taken
 * keeps its original `revokedAt` (real audit timestamp, still inert either
 * way). Re-enabling access after a restore always requires a brand new,
 * explicit grant from the current owner — never an implicit side effect of
 * restoring data.
 *
 * No FK exists from CrossWorkspaceGrant.objectId to its target row (it's a
 * polymorphic reference checked only in application code — see
 * schema.prisma), so this insert cannot fail merely because the target
 * object wasn't restored in the same snapshot or no longer exists; the
 * grant row simply lands inert, which is exactly the desired outcome.
 */
function specGrants(key: string, pick: (tx: Tx) => unknown): ModelSpec {
  const base = spec(key, pick);
  return {
    ...base,
    insert: (tx, rows) => {
      const restoredAt = new Date();
      const forcedRevoked = (rows as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        revokedAt: row.revokedAt ?? restoredAt
      }));
      return base.insert(tx, forcedRevoked);
    }
  };
}

/**
 * Версия формата снапшота — растёт при несовместимом изменении раскладки.
 * v2 (S03, 2026-09-21): добавлены milestones/milestoneDependencies/
 * inventoryItems/inventoryMovements/documentVersions/documentAnnotations и
 * derived `workspaceConfig`. Старые (v1) снапшоты не содержат этих данных —
 * `apply()` отвергает их целиком (fail-closed, см. класс-комментарий),
 * потому что отсутствие ключа в v1-файле неотличимо от «этого модуля тогда
 * не было» и от «данные потеряны при сериализации»: молча восстановить
 * v1-файл значило бы либо стереть текущие milestones/inventory без замены
 * (ключа для них в файле нет — `clear()` для tasks/documents всё равно
 * вызовется, а `insert()` вставит только то, что смог прочитать), либо
 * притвориться, что этих данных никогда не было. Ни то ни другое не
 * "restore", поэтому решение — отказ, а не тихий даунгрейд.
 */
export const SNAPSHOT_VERSION = 2 as const;

/** Легаси-формат до S03 — распознаётся только чтобы дать внятный отказ. */
export const LEGACY_SNAPSHOT_VERSION = 1 as const;

export interface WorkspaceConfigSnapshot {
  disabledModules: string[];
  pluginOverrides: string[];
  restrictedModules: string[];
}

export interface WorkspaceSnapshot {
  version: typeof SNAPSHOT_VERSION;
  workspaceId: string;
  generatedAt: string;
  /** Ключ модуля → массив строк (даты — ISO, как JSON.stringify(Date)). */
  tables: Record<string, unknown[]>;
  /** derived-классификация из snapshot-registry.ts: конфигурация пространства, не построчный список. */
  workspaceConfig: WorkspaceConfigSnapshot;
}

@Injectable()
export class SnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /** Прочитать всё рабочее пространство в один объект (внутри RLS-транзакции вызывающего). */
  async serialize(tx: Tx, workspaceId: string): Promise<WorkspaceSnapshot> {
    const tables: Record<string, unknown[]> = {};
    for (const m of SNAPSHOT_MODELS) {
      tables[m.key] = await m.load(tx, workspaceId);
    }
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { disabledModules: true, pluginOverrides: true, restrictedModules: true }
    });
    return {
      version: SNAPSHOT_VERSION,
      workspaceId,
      generatedAt: new Date().toISOString(),
      tables,
      workspaceConfig: {
        disabledModules: workspace.disabledModules,
        pluginOverrides: workspace.pluginOverrides,
        restrictedModules: workspace.restrictedModules
      }
    };
  }

  /**
   * ТЗ-05: вставить уже переписанные (новые id/workspaceId) строки в НОВОЕ пространство.
   * Ничего не очищает — в отличие от `apply`, это создание, а не замена.
   */
  async insertInto(tx: Tx, tables: Record<string, unknown[]>): Promise<void> {
    for (const m of SNAPSHOT_MODELS) {
      await m.insert(tx, tables[m.key] ?? []);
    }
  }

  /** Счётчики строк по модулям — для превью восстановления, без чтения самих строк целиком. */
  async counts(tx: Tx, workspaceId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const m of SNAPSHOT_MODELS) {
      out[m.key] = (await m.load(tx, workspaceId)).length;
    }
    return out;
  }

  static tableCounts(snapshot: WorkspaceSnapshot): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of SNAPSHOT_MODELS) out[m.key] = (snapshot.tables[m.key] ?? []).length;
    return out;
  }

  /**
   * Заменить содержимое рабочего пространства данными снапшота. Разрушительно:
   * все текущие строки перечисленных моделей в этом workspace удаляются, затем
   * вставляются из снапшота. Вызывать только после явного подтверждения
   * (`dryRun: false` + `confirmWorkspaceId`). Идёт одной транзакцией внутри
   * `withUser`, так что RLS отсекает чужие workspace, а сбой откатывает всё.
   *
   * Fail-closed для формата: версия проверяется *первой строкой*, до любого
   * `clear()`/`insert()` — несовпадение (в т.ч. legacy v1, см.
   * `LEGACY_SNAPSHOT_VERSION`) кидает исключение и не трогает ни одной
   * строки текущих данных. Это единственная безопасная трактовка "старого
   * формата": частичное разрушительное восстановление хуже отказа.
   */
  async apply(tx: Tx, snapshot: WorkspaceSnapshot): Promise<void> {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(
        snapshot.version === LEGACY_SNAPSHOT_VERSION
          ? `Снапшот в устаревшем формате v${LEGACY_SNAPSHOT_VERSION} (до milestones/inventory/document ` +
            `versions/workspaceConfig) — разрушительное восстановление отклонено, чтобы не потерять эти ` +
            `таблицы молча. Просмотр состава старой копии возможен, автоматического апгрейда формата нет.`
          : `Версия снапшота ${snapshot.version} не поддерживается (ожидалась ${SNAPSHOT_VERSION})`
      );
    }
    // Очистка: от листьев к корню.
    for (const m of [...SNAPSHOT_MODELS].reverse()) {
      await m.clear(tx, snapshot.workspaceId);
    }
    // Вставка: от корня к листьям.
    for (const m of SNAPSHOT_MODELS) {
      let rows = snapshot.tables[m.key] ?? [];
      // Копии, снятые до универсальных Capture, хранили идеи/проблемы проекта под ключом `projectCaptures`.
      if (m.key === "captures" && rows.length === 0) {
        const legacy = (snapshot.tables as Record<string, unknown[] | undefined>)["projectCaptures"] ?? [];
        rows = legacy.map((r) => ({ ...(r as object), anchorType: "project", anchorId: (r as { projectId: string }).projectId }));
      }
      // Страховка: снапшот другого workspace не должен просочиться.
      const own = rows.filter(
        (r) => (r as { workspaceId?: string }).workspaceId === snapshot.workspaceId
      );
      await m.insert(tx, own);
    }
    await tx.workspace.update({
      where: { id: snapshot.workspaceId },
      data: {
        disabledModules: snapshot.workspaceConfig.disabledModules,
        pluginOverrides: snapshot.workspaceConfig.pluginOverrides,
        restrictedModules: snapshot.workspaceConfig.restrictedModules
      }
    });
  }
}
