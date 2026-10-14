/**
 * ORION — S03a: явный реестр классификации КАЖДОЙ Prisma-модели для снапшота
 * бэкапа/восстановления (`snapshot.service.ts`).
 *
 * Это не документация "на память" — `snapshot.integration.test.ts` сверяет
 * этот список с реальными моделями из Prisma DMMF (`Prisma.dmmf.datamodel.models`)
 * на старте каждого прогона. Забытая новая модель (добавлена в
 * `schema.prisma`, но не сюда) ломает тест, а не тихо выпадает из бэкапа —
 * ровно так был найден пропуск `finance_transaction_lines` у RLS (см.
 * CLAUDE.md), только на уровне снапшота, а не политик.
 *
 * Политики:
 * - `included`   — обычная workspace-таблица, строки копируются 1:1
 *                   (`SNAPSHOT_MODELS` в `snapshot.service.ts`, `snapshotKey`
 *                   обязателен и должен совпадать с ключом там).
 * - `derived`     — не построчный список, а агрегированная конфигурация
 *                   пространства (см. `WorkspaceSnapshot.workspaceConfig`).
 * - `identity-excluded` — модель про личность/доступ (пользователь, сессия,
 *                   членство), которую снапшот сознательно не трогает:
 *                   восстановление в тот же workspaceId не должно менять,
 *                   кто в нём состоит, а перенос на новую установку требует
 *                   отдельно спроектированного mapping пользователей (ещё не
 *                   реализован — см. 09-RELIABILITY.md).
 * - `secret-excluded`   — хранит секрет/адрес удалённого назначения бэкапа;
 *                   класть его самого внутрь бэкапа, который он же пишет —
 *                   риск (циклическая секретная зависимость), плюс это
 *                   конфигурация узла, а не данные пространства.
 * - `ephemeral-excluded` — продуктовая политика архива уведомлений/доставок,
 *                   осознанное решение (09-RELIABILITY.md), не случайный
 *                   пропуск.
 */

export type SnapshotPolicy =
  | "included"
  | "derived"
  | "identity-excluded"
  | "secret-excluded"
  | "ephemeral-excluded";

export interface ModelClassification {
  /** Имя модели ровно как в schema.prisma / Prisma.dmmf.datamodel.models[].name. */
  model: string;
  /**
   * Ключ в `WorkspaceSnapshot.tables` (для `included`) или в
   * `WorkspaceSnapshot.workspaceConfig` (для `derived`). `null` для всех
   * excluded-политик.
   */
  snapshotKey: string | null;
  policy: SnapshotPolicy;
  reason: string;
}

export const SNAPSHOT_MODEL_REGISTRY: ModelClassification[] = [
  { model: "Opportunity", snapshotKey: "opportunities", policy: "included", reason: "Вакансии/заказы и история Base; внешних разрешений здесь нет." },
  // --- workspace config (derived, не построчный список) -------------------
  {
    model: "Workspace",
    snapshotKey: "workspaceConfig",
    policy: "derived",
    reason:
      "Сама модель пространства не копируется как строка (id/name/icsToken — " +
      "identity узла); disabledModules/pluginOverrides/restrictedModules " +
      "восстанавливаются отдельно как WorkspaceSnapshot.workspaceConfig."
  },

  // --- identity / membership — сознательно не бэкапится --------------------
  { model: "User", snapshotKey: null, policy: "identity-excluded", reason: "Глобальный аккаунт, не workspace-запись." },
  { model: "RefreshToken", snapshotKey: null, policy: "identity-excluded", reason: "Сессионный секрет пользователя, не данные пространства." },
  { model: "UserPreference", snapshotKey: null, policy: "identity-excluded", reason: "Per-user настройки интерфейса, не workspace-scoped (нет workspaceId). Включает U05 `spheres`/`favoriteWorkspaceIds` — личная группировка/избранное, а не данные пространства (23-UNIVERSAL-CONNECTED-CORE.md: «не копируются чужим участникам при восстановлении workspace»)." },
  { model: "WorkspaceMember", snapshotKey: null, policy: "identity-excluded", reason: "Членство/роли — восстановление в тот же workspaceId не должно менять состав участников; identity mapping на новую установку не реализован." },
  { model: "WorkspaceInvite", snapshotKey: null, policy: "identity-excluded", reason: "Токены приглашений одноразовые и адресные — восстанавливать их бессмысленно и небезопасно." },

  // --- секреты/адреса назначения бэкапа ------------------------------------
  { model: "SyncRemote", snapshotKey: null, policy: "secret-excluded", reason: "Хранит зашифрованный пароль и адрес WebDAV-удалёнки, которая сама пишет снапшот — конфигурация узла, не данные пространства; класть секрет назначения внутрь того, что он производит, не нужно." },

  { model: "Home", snapshotKey: "homes", policy: "included", reason: "Дома (модуль «Дом») — пользовательский контент; вставляются раньше задач, списков, вещей и платежей, которые на них ссылаются." },
  { model: "Meter", snapshotKey: "meters", policy: "included", reason: "Счётчики дома." },
  { model: "MeterReading", snapshotKey: "meterReadings", policy: "included", reason: "Показания счётчиков — история расхода." },
  { model: "HomeUtilityMonth", snapshotKey: "homeUtilityMonths", policy: "included", reason: "Начисления по месяцам — пользовательские данные расширения Коммуналка." },
  { model: "HomeUtilityPayment", snapshotKey: "homeUtilityPayments", policy: "included", reason: "Связи оплаченных коммунальных начислений с финансовыми операциями." },
  { model: "HomeElectricityTariff", snapshotKey: "homeElectricityTariffs", policy: "included", reason: "История тарифов электросчётчика — пользовательские данные." },
  { model: "Contact", snapshotKey: "contacts", policy: "included", reason: "Контакты дома (УК, мастера)." },
  { model: "AgentToken", snapshotKey: null, policy: "secret-excluded", reason: "Учётные данные ИИ-агентов (ADR-0007): хранится только хеш секрета; токены не переносятся между узлами — их выпускают заново." },
  { model: "AgentMessage", snapshotKey: null, policy: "ephemeral-excluded", reason: "Сообщения между агентами привязаны к токенам узла; токены в бэкап не входят, а значит и переписка." },
  { model: "AgentTask", snapshotKey: null, policy: "ephemeral-excluded", reason: "Задания между агентами привязаны к токенам узла, которые в бэкап не входят." },
  { model: "AgentProposal", snapshotKey: null, policy: "ephemeral-excluded", reason: "Запросы агентов на подтверждение привязаны к токенам узла и теряют смысл вне его." },
  { model: "AgentAuditEntry", snapshotKey: null, policy: "ephemeral-excluded", reason: "Журнал действий ИИ-агентов привязан к токенам узла и в бэкап не входит." },

  // --- продуктовая политика уведомлений (09-RELIABILITY.md) ---------------
  { model: "Notification", snapshotKey: null, policy: "ephemeral-excluded", reason: "Лента уведомлений — архивная политика продукта, не источник истины пространства (09-RELIABILITY.md)." },
  { model: "SentReminder", snapshotKey: null, policy: "ephemeral-excluded", reason: "Дедуп-журнал уже отправленных напоминаний — служебное состояние крона, не пользовательские данные." },
  { model: "SyncRestoreOperation", snapshotKey: null, policy: "ephemeral-excluded", reason: "R18-01: durable lock/progress-строка для текущего restore, не пользовательские данные; строка живёт только на время самой операции восстановления и не должна становиться частью того, что эта же операция восстанавливает." },

  // --- включённые предметные модели -----------------------------------------
  { model: "OpportunityProfile", snapshotKey: "opportunityProfiles", policy: "included", reason: "Профили расширения, сохраняются при отключении." },
  { model: "OpportunityFact", snapshotKey: "opportunityFacts", policy: "included", reason: "Факты и явное подтверждение владельца." },
  { model: "OpportunityTrack", snapshotKey: "opportunityTracks", policy: "included", reason: "Треки профиля." },
  { model: "OpportunityMaterial", snapshotKey: "opportunityMaterials", policy: "included", reason: "Неизменяемые версии материалов." },
  { model: "OpportunityImport", snapshotKey: "opportunityImports", policy: "included", reason: "Импорт с checkpoint; restore принудительно canceled и повышает revision." },
  { model: "OpportunityCapture", snapshotKey: "opportunityCaptures", policy: "included", reason: "Исторический снимок источника, после Opportunity/Import." },
  { model: "OpportunityHistory", snapshotKey: "opportunityHistory", policy: "included", reason: "Неподтверждённая внешняя история, после родителей." },
  { model: "Project", snapshotKey: "projects", policy: "included", reason: "Корень для milestones/tasks/notes/events/documents/finance/inventory через projectId." },
  { model: "Milestone", snapshotKey: "milestones", policy: "included", reason: "«План проекта» (v0.27) — веха, дочерняя к Project, родитель для Task.milestoneId." },
  { model: "MilestoneDependency", snapshotKey: "milestoneDependencies", policy: "included", reason: "Finish-to-start связи между вехами." },
  { model: "Task", snapshotKey: "tasks", policy: "included", reason: "Самоссылающееся дерево (parentId) — вставляется в топологическом порядке, не в порядке findMany." },
  { model: "TaskDependency", snapshotKey: "taskDependencies", policy: "included", reason: "Связи между задачами, требуют, чтобы обе задачи уже были вставлены." },
  { model: "ProjectStatusUpdate", snapshotKey: "projectStatusUpdates", policy: "included", reason: "Ручные отчёты о состоянии проекта (UI-05) — пользовательский контент." },
  { model: "Goal", snapshotKey: "goals", policy: "included", reason: "Глобальные цели (плагин projects-goals) — пользовательский контент." },
  { model: "GoalPlan", snapshotKey: "goalPlans", policy: "included", reason: "Связь цель ↔ проект с весом; вставляется после целей и проектов." },
  { model: "Capture", snapshotKey: "captures", policy: "included", reason: "Универсальные идеи/проблемы/заметки с якорем (anchorType, anchorId) — пользовательский текст; после Project и Task (projectId, taskId)." },
  { model: "TaskComment", snapshotKey: "taskComments", policy: "included", reason: "Комментарии задач (S17) — пользовательский контент, часть истории задачи." },
  { model: "TaskActivity", snapshotKey: "taskActivities", policy: "included", reason: "Журнал изменений статуса/исполнителя/срока (S17) — append-only аудит." },
  { model: "SavedTaskView", snapshotKey: "savedTaskViews", policy: "included", reason: "Сохранённые виды доски задач." },
  { model: "Note", snapshotKey: "notes", policy: "included", reason: "Основная предметная сущность заметок." },
  { model: "NoteLink", snapshotKey: "noteLinks", policy: "included", reason: "Wiki-ссылки между заметками." },
  { model: "NoteRevision", snapshotKey: "noteRevisions", policy: "included", reason: "История ревизий тела заметки." },
  { model: "NoteAttachment", snapshotKey: "noteAttachments", policy: "included", reason: "Связь заметки с Document-вложением; сам Document грузится отдельно (documents)." },
  { model: "Event", snapshotKey: "events", policy: "included", reason: "События календаря." },
  { model: "EventOverride", snapshotKey: "eventOverrides", policy: "included", reason: "Переопределения повторяющихся событий." },
  { model: "CalendarConnection", snapshotKey: "calendarConnections", policy: "included", reason: "Входящие ICS-фиды — конфигурация пространства, не секрет узла (в отличие от SyncRemote)." },
  { model: "Document", snapshotKey: "documents", policy: "included", reason: "Самоссылающееся дерево папок/файлов (parentId) — топологический порядок вставки; сам бинарный blob вне объёма S03 (см. S04)." },
  { model: "DocumentVersion", snapshotKey: "documentVersions", policy: "included", reason: "Метаданные версий файла (storageKey/checksum) — метаданные включены в S03, сами байты блобов — S04." },
  { model: "DocumentAnnotation", snapshotKey: "documentAnnotations", policy: "included", reason: "Аннотации/закладки поверх документа." },
  { model: "Account", snapshotKey: "financeAccounts", policy: "included", reason: "Счета финансового модуля." },
  { model: "FinanceCategory", snapshotKey: "financeCategories", policy: "included", reason: "Категории операций." },
  { model: "Transaction", snapshotKey: "financeTransactions", policy: "included", reason: "Финансовые операции." },
  { model: "TransactionLine", snapshotKey: "financeTransactionLines", policy: "included", reason: "Строки операций (денормализованный workspaceId, см. CLAUDE.md)." },
  { model: "Budget", snapshotKey: "financeBudgets", policy: "included", reason: "Бюджеты по категориям." },
  { model: "RecurringTransaction", snapshotKey: "financeRecurring", policy: "included", reason: "Правила повторяющихся платежей." },
  { model: "CategoryRule", snapshotKey: "financeCategoryRules", policy: "included", reason: "Правила авто-категоризации." },
  { model: "SavingsGoal", snapshotKey: "financeSavingsGoals", policy: "included", reason: "Цели накоплений." },
  { model: "MarketWatchItem", snapshotKey: "marketWatchItems", policy: "included", reason: "Список наблюдения модуля «Рынки» (ссылки на инструменты)." },
  { model: "InvestmentTrade", snapshotKey: "investmentTrades", policy: "included", reason: "Журнал сделок, загруженный из Compass; режим сделки сохраняется." },
  { model: "FinanceObligation", snapshotKey: "financeObligations", policy: "included", reason: "Долги, кредиты, коммунальные платежи и подписки (план платежей; деньги двигает только записанная операция)." },
  { model: "TimeEntry", snapshotKey: "timeEntries", policy: "included", reason: "Записи учёта времени (v0.18)." },
  { model: "Habit", snapshotKey: "habits", policy: "included", reason: "Привычки (v0.19)." },
  { model: "HabitEntry", snapshotKey: "habitEntries", policy: "included", reason: "Отметки привычек." },
  { model: "List", snapshotKey: "lists", policy: "included", reason: "Списки." },
  { model: "ListItem", snapshotKey: "listItems", policy: "included", reason: "Пункты списков." },
  { model: "InventoryItem", snapshotKey: "inventoryItems", policy: "included", reason: "Позиции инвентаря (v0.26)." },
  { model: "InventoryMovement", snapshotKey: "inventoryMovements", policy: "included", reason: "Append-only леджер движений остатка." },
  { model: "InboxItem", snapshotKey: "inboxItems", policy: "included", reason: "Входящие." },
  { model: "EntityLink", snapshotKey: "entityLinks", policy: "included", reason: "Произвольные связи между сущностями (v0.17)." },
  { model: "EntityReminder", snapshotKey: "entityReminders", policy: "included", reason: "Личное одноразовое напоминание (U03) — pending-намерение пользователя, как Task.dueAt, а не журнал доставки (тот — Notification/SentReminder, ephemeral-excluded)." },
  {
    model: "CrossWorkspaceGrant",
    snapshotKey: "crossWorkspaceGrants",
    policy: "included",
    reason:
      "U09 (27-U09-THREAT-MODEL.md, T3): грант — часть политики доступа пространства-ИСТОЧНИКА " +
      "(хранит и workspaceId источника, и granteeUserId внешнего пользователя), поэтому входит в " +
      "снапшот источника, а не пространства grantee — snapshot.service.ts фильтрует по workspaceId " +
      "как любую другую included-таблицу, так что запись гранта в снапшоте grantee-пространства " +
      "структурно невозможна (там нет строк с чужим workspaceId). R29-02: восстановление НЕ " +
      "реактивирует внешний доступ — specGrants() в snapshot.service.ts принудительно проставляет " +
      "revokedAt на момент restore для каждой строки без собственного revokedAt; исходный revokedAt " +
      "(если грант уже был отозван на момент бэкапа) сохраняется как есть. Повторная выдача — только " +
      "новый явный грант владельца."
  }
];

/** Быстрый доступ policy=included → snapshotKey, для сверки с snapshot.service.ts. */
export const INCLUDED_SNAPSHOT_KEYS: ReadonlySet<string> = new Set(
  SNAPSHOT_MODEL_REGISTRY.filter((c) => c.policy === "included").map((c) => c.snapshotKey as string)
);

export function classificationFor(model: string): ModelClassification | undefined {
  return SNAPSHOT_MODEL_REGISTRY.find((c) => c.model === model);
}
