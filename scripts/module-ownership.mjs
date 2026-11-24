// G4: единая явная карта «модель Prisma -> модуль-владелец» (каталог apps/api/src/<dir>) для правила
// межмодульных границ в architecture-check. Источник истины — эта карта, а не угадывание по префиксу:
// MODULE_CATALOG знает только пользовательские модули и не знает, какие таблицы им принадлежат.
// Новая модель в schema.prisma без записи здесь валит architecture-check (см. ownershipMapViolations).

import { GENERATED_MODEL_OWNERS } from "./module-ownership.generated.mjs";

/** Каталоги, которые считаются одним доменным модулем (семейство Opportunities живёт в нескольких папках). */
export const MODULE_GROUPS = new Map([
  ["opportunities-assistant", "opportunities"],
  ["opportunities-execution", "opportunities"],
  ["opportunities-hh-import", "opportunities"],
  ["opportunities-manager", "opportunities"],
  ["opportunities-profiles", "opportunities"],
  ["opportunity-extensions", "opportunities"]
]);

/**
 * Ядро/оболочка: им разрешено трогать любые таблицы и сервисы (бэкап, членство, настройки, общие уведомления
 * и т.п.), а их сервисы разрешено импортировать из любого модуля. Список может только сокращаться, расширять
 * его ради удобства нельзя — домены, которые «знают» другие домены (inbox, overview, search, activity, ai),
 * сюда НЕ входят: они числятся во временных исключениях (module-boundary-exceptions.mjs) до G19.
 */
export const CORE_MODULE_DIRS = new Set([
  "common", "workspaces", "auth", "users", "sync", "system", "storage", "notifications",
  "modules", "plugins", "settings", "shared", "ops", "lan", "mcp", "domain-events", "entity-links"
]);

/** Модели ядра: любой модуль вправе читать/писать их (членство, пользователи, общие связи/напоминания, синхронизация, outbox доменных событий). */
export const CORE_MODELS = new Set([
  "User", "RefreshToken", "UserPreference", "Workspace", "WorkspaceMember", "WorkspaceInvite", "CrossWorkspaceGrant",
  "Notification", "EntityLink", "EntityReminder",
  // 12-team-access: очередь упоминаний агентского членства — общая, как уведомления:
  // её пишут комментарии задач/журнал проекта, читает команда.
  "AgentMemberEvent",
  "SyncRemote", "SyncRestoreOperation", "SyncChange", "SyncOp", "SyncEntityStamp", "SyncDevice",
  "DomainEvent", "DomainEventDelivery"
]);

function owned(owner, models) {
  return models.split(/\s+/).filter(Boolean).map((model) => [model, owner]);
}

/** model -> каталог модуля-владельца (группы приводятся через MODULE_GROUPS). Модели ядра — в CORE_MODELS. */
export const MODEL_OWNERS = new Map([
  // G5/G10: модели модулей, подключённых манифестом, вносит генератор (scripts/module-registry.mjs).
  ...GENERATED_MODEL_OWNERS,
  ...owned("development", "DevelopmentCatalogMapping DevelopmentImportConsent DevelopmentGitRepository TaskCommitLink DevelopmentArchitectLayout DevelopmentArchitectSnapshot DevelopmentWorkflow DevelopmentArchitectureDiagram"),
  ...owned("shared", "SharedPublication SharedPublicationPin SharedPublicationOperation PublicationRule"),
  ...owned("projects", "Project ProjectStatusUpdate ProjectLogEntry ProjectLogEntryTask ProjectRelation ProjectTemplate ProjectHistoryEntry"),
  ...owned("planning", "PlanningBlock PlanningMatrixPreset"),
  ...owned("milestones", "Milestone MilestoneDependency"),
  ...owned("notes", "Note NoteLink NoteRevision NoteAttachment NoteStackState"),
  ...owned("tasks", "Task TaskComment TaskActivity TaskDependency SavedTaskView TaskRecurrence TaskRecurrenceInstance TaskFieldDefinition TaskFieldValue TaskStatusDefinition"),
  ...owned("captures", "Capture"),
  ...owned("knowledge", "KnowledgeCategory KnowledgeItem KnowledgeSource KnowledgeRelation KnowledgeItemRevision KnowledgeSettings"),
  ...owned("time", "TimeEntry TimePlan"),
  ...owned("habits", "Habit HabitEntry"),
  ...owned("lists", "List ListItem"),
  ...owned("events", "Event CalendarConnection EventOverride SentReminder"),
  ...owned("finance", "Account FinanceSettings FinanceCategory Transaction TransactionLine Budget RecurringTransaction CategoryRule FinanceObligation InvestmentTrade SavingsGoal FinanceTemplate FinanceSplit FinanceSplitShare FinanceSettlement FinanceExchangeRate FinanceDraft"),
  ...owned("markets", "MarketWatchItem"),
  ...owned("documents", "Document DocumentVersion DocumentAnnotation"),
  ...owned("inbox", "InboxItem"),
  ...owned("inventory", "InventoryItem InventoryMovement"),
  ...owned("goals", "Goal GoalPlan GoalCanvasLayout"),
  ...owned("ai", "AgentToken AgentCapture AgentAuditEntry AgentMessage AgentTask AgentProposal AssistantKey AssistantConversation"),
  ...owned("extensions", "ExtensionRecord ExtensionSecret"),
  ...owned("opportunities", "Opportunity OpportunityProfile OpportunityFact OpportunityTrack OpportunityMaterial OpportunityImport OpportunityCapture OpportunityHistory OpportunityAssessment OpportunityDraft OpportunityConnection OpportunityAttempt OpportunityGrant OpportunityBudget OpportunityPolicy OpportunityManagerAction"),
  ...owned("home", "Home Meter MeterReading"),
  ...owned("home-utilities", "HomeUtilityMonth HomeUtilityPayment HomeElectricityTariff"),
  ...owned("contacts", "Contact ContactInteraction ContactRelation"),
  ...owned("health", "HealthSubject HealthGrant HealthAppointment HealthPreventiveItem HealthMedication HealthIntake HealthMeasurement HealthTarget HealthSymptom"),
  // Общие инструменты платформы (задание 10): таблицы и личные горячие клавиши.
  ...owned("tables", "TableDefinition TableRow"),
  ...owned("commands", "KeyBinding")
]);

export function moduleOfDir(dir) {
  return MODULE_GROUPS.get(dir) ?? dir;
}

/** API-relative path; manifest modules have independent ownership below modules-ext. */
export function moduleOfPath(path) {
  const parts = path.replaceAll("\\", "/").split("/");
  return parts[0] === "modules-ext" && parts[1] ? `modules-ext/${parts[1]}` : moduleOfDir(parts[0]);
}
