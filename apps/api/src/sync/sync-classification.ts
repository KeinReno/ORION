import { GENERATED_SYNC_CLASSIFICATION } from "../modules-ext/data.generated";

/**
 * ТЗ-06 / ADR-0016 §1 — классификация КАЖДОЙ модели реестра снапшота по политике
 * гибридной синхронизации. `sync-classification.test.ts` сверяет этот список с
 * `SNAPSHOT_MODEL_REGISTRY`: новая модель без строки здесь ломает тест, а не
 * молча остаётся «как-нибудь синхронизируемой».
 *
 * Класс отвечает на вопрос «как сливать конкурирующие правки», этап — «когда это
 * вообще разрешено». Всё, что не `stage2`/`stage3`, офлайн-записью НЕ ОБЛАДАЕТ:
 * такие модели остаются «только онлайн на авторитетном узле» (режим «общий узел»).
 */
export type SyncClass =
  /** Длинный текст: автоматического слияния нет, конфликт показывается человеку (CAS по `revision`). */
  | "mergeable-text"
  /** Скалярные поля: last-writer-wins ПО ПОЛЮ (штамп HLC + id устройства), удаление — tombstone. */
  | "lww-fields"
  /** Только добавление: записи не правятся, дубли гасит `opId`/естественный ключ. */
  | "append-only"
  /** Деньги/остатки/строгие инварианты: офлайн-записи нет, только онлайн-запись на узле. */
  | "strict"
  /** Не синхронизируется: личность/доступ, секреты узла, служебное и эфемерное состояние. */
  | "not-synced";

/** Этап ТЗ-06, на котором модель получает (или не получает) двустороннюю запись. */
export type SyncStage = "stage2" | "stage3" | "later" | "never";

export interface SyncClassification {
  syncClass: SyncClass;
  stage: SyncStage;
  note: string;
}

const lww = (stage: SyncStage, note: string): SyncClassification => ({ syncClass: "lww-fields", stage, note });
const append = (note: string): SyncClassification => ({ syncClass: "append-only", stage: "later", note });
const strict = (note: string): SyncClassification => ({ syncClass: "strict", stage: "never", note });
const never = (note: string): SyncClassification => ({ syncClass: "not-synced", stage: "never", note });

export const SYNC_CLASSIFICATION: Record<string, SyncClassification> = {
  // G10: классы синхронизации моделей подключаемых модулей объявлены их манифестами (scripts/module-registry.mjs).
  ...GENERATED_SYNC_CLASSIFICATION,
  DevelopmentImportConsent: never("Одноразовое подтверждение привязано к пользователю и текущему узлу; не переносится и не восстанавливается."),
  // --- этап 2: прототип на списках ---------------------------------------------
  List: lww("stage2", "Название/вид/архив — LWW по полю; удаление — tombstone (удалить можно только архивный список или шаблон)."),
  ListItem: lww("stage2", "Поля пункта — LWW по полю; отметка — булево поле; удаление — tombstone, побеждает конкурирующую правку; порядок — поле sortOrder."),

  // --- этап 3: заметки и задачи ---------------------------------------------------
  Note: { syncClass: "mergeable-text", stage: "stage3", note: "Заголовок/тело/теги — только через CAS по revision, конфликт явный (note_revision_conflict); без молчаливого merge." },
  Task: lww("stage3", "Поля — LWW по полю + revision (task_revision_conflict для полей, где важен порядок); дерево parentId требует проверки цикла на узле."),
  // Tasks 2.0: справочники и значения — обычные поля, но цепочку повторения
  // материализует только авторитетный узел (unique ordinal), поэтому recurrences
  // и экземпляры остаются online-only.
  TaskStatusDefinition: lww("later", "Статусы пространства: порядок/цвет/категория — LWW; удаление занятого статуса требует переноса задач."),
  TaskFieldDefinition: lww("later", "Определения пользовательских полей; значения ссылаются на них."),
  TaskFieldValue: lww("later", "Значения полей задачи — LWW по (taskId, fieldId); порядок не важен."),
  TaskRecurrence: strict("Правило повторения и generatedCount меняются только материализацией на авторитетном узле; офлайн-запись создала бы дубли."),
  TaskRecurrenceInstance: strict("Экземпляры цепочки: уникальный ordinal — идемпотентность материализации, офлайн-запись её не гарантирует."),

  // --- позже: LWW-кандидаты без офлайн-записи в этой фазе ------------------------
  Opportunity: lww("later", "Карточки Opportunity Hub: поля LWW, но связаны с историей и импортом — отдельное решение."),
  OpportunityProfile: lww("later", "Профиль расширения."),
  OpportunityFact: lww("later", "Факты с явным подтверждением владельца — подтверждение не должно появляться из слияния."),
  OpportunityTrack: lww("later", "Треки профиля."),
  Project: lww("later", "Поля LWW; проект — корень ссылок (projectId), нужна проверка целостности на узле."),
  DevelopmentCatalogMapping: strict("Соответствие внешнего id каталога и сущности пространства: офлайн-запись создала бы вторую привязку. В резервную копию входит, пишется только на узле."),
  // 11: Git Workspace. Путь к локальному каталогу — свойство узла, поэтому репозиторий не синхронизируется;
  // привязки коммитов и раскладка карты — обычные данные пространства.
  DevelopmentGitRepository: never("Локальный путь репозитория существует только на этом узле; перенос строки на другой компьютер дал бы нерабочий путь."),
  TaskCommitLink: strict("Привязка (taskId, repositoryId, sha) создаётся узлом по истории git; офлайн-запись дала бы дубль или ссылку на несуществующий коммит."),
  DevelopmentArchitectLayout: lww("later", "Раскладка карты и загруженная проектная схема — LWW по строке и ревизии; сами узлы каждый раз строятся анализатором."),
  DevelopmentArchitectSnapshot: never("Снимки анализа привязаны к локальному репозиторию и его коммитам; между узлами не синхронизируются."),
  DevelopmentWorkflow: lww("later", "Процессы Workbench — пользовательский контент пространства; полная замена графа — LWW по строке."),
  Milestone: lww("later", "Вехи проекта."),
  Goal: lww("later", "Цели."),
  Contact: lww("later", "Записная книжка пространства."),
  Event: lww("later", "События календаря; повторения и EventOverride требуют общего решения."),
  Habit: lww("later", "Привычки."),
  KnowledgeCategory: lww("later", "Разделы базы знаний."),
  KnowledgeItem: lww("later", "Материалы базы знаний."),
  KnowledgeSource: lww("later", "Источники материалов."),
  KnowledgeRelation: lww("later", "Связи между материалами."),
  KnowledgeItemRevision: append("Неизменяемые снимки версий материалов базы знаний (задание 08): правки не предусмотрены, удаление — вместе с материалом."),
  KnowledgeSettings: lww("later", "Настройки базы знаний пространства (задание 08): LWW по полю, одна строка на пространство."),
  FinanceSettings: lww("later", "Настройки финансов пространства (простой/расширенный режим): LWW по полю, одна строка на пространство."),
  SavedTaskView: lww("later", "Сохранённые виды доски."),
  InboxItem: lww("later", "Входящие: обработка (process) — атомарный захват на узле, офлайн-обработки нет."),
  EntityReminder: lww("later", "Личное напоминание: доставку делает узел."),
  MarketWatchItem: lww("later", "Список наблюдения."),
  HabitEntry: lww("later", "Отметка дня уникальна по (habitId, day): естественный ключ даёт идемпотентность, но нужен отдельный разбор tombstone."),
  ContactRelation: lww("later", "Набор связей между контактами (set add/remove)."),
  MilestoneDependency: lww("later", "Набор зависимостей (set); проверка цикла на узле."),
  TaskDependency: lww("later", "Набор зависимостей (set); проверка цикла на узле."),
  GoalPlan: lww("later", "Связь цель ↔ проект с весом."),
  GoalCanvasLayout: lww("later", "Раскладка созвездия: координаты узлов и камеры, LWW по строке; конфликты правок — в самой строке."),
  EntityLink: lww("later", "Набор связей (set); недоступные модули отбрасывает узел."),
  NoteAttachment: lww("later", "Связь заметка ↔ документ; сам документ — блоб, см. ADR-0016 §4."),
  EventOverride: lww("later", "Переопределения повторений."),
  Home: lww("later", "Дом."),
  Meter: lww("later", "Счётчики дома."),

  // --- append-only -----------------------------------------------------------------
  MeterReading: append("Показания счётчиков: добавление; правка = новая запись."),
  HomeElectricityTariff: append("История тарифов."),
  ContactInteraction: append("Журнал общения."),
  OpportunityMaterial: append("Неизменяемые версии материалов."),
  OpportunityCapture: append("Исторические снимки источника."),
  OpportunityHistory: append("Внешняя история."),
  OpportunityAssessment: append("Неизменяемые оценки ассистента; устаревание вычисляется при чтении."),
  OpportunityDraft: strict("Черновик и его одобрение владельцем: офлайн-записи нет — одобрение привязано к хэшу текста и проверяется только на авторитетном узле."),
  OpportunityConnection: never("Подключение внешнего аккаунта: токен исполнителя и код сопряжения узла не синхронизируются."),
  OpportunityAttempt: strict("Внешняя отправка: только онлайн на авторитетном узле, офлайн-записи нет."),
  OpportunityGrant: never("Одноразовые разрешения не покидают узел."),
  OpportunityBudget: never("Счётчик дневного лимита живёт только на авторитетном узле."),
  OpportunityPolicy: strict("Политика автономности: только онлайн на авторитетном узле."),
  OpportunityManagerAction: strict("Журнал менеджера пишет только узел."),
  Capture: append("Идеи/замечания с якорем."),
  ProjectStatusUpdate: append("Ручные отчёты о состоянии проекта."),
  ProjectLogEntry: append("Авторские записи проектного журнала."),
  ProjectTemplate: lww("later", "Шаблон проекта: поля и JSON-структура — LWW; живым проектам не принадлежит."),
  ProjectHistoryEntry: append("Audit trail проекта: записи только добавляются, правка истории не предусмотрена."),
  ProjectLogEntryTask: append("Ссылка на задачу с ремаркой, хранимой только в проектном журнале."),
  ProjectRelation: append("Направленные связи между проектами одного пространства."),
  TaskComment: append("Комментарии: автор проставляется узлом, правка только автором; уведомления создаёт узел."),
  TaskActivity: never("Журнал пишет ТОЛЬКО узел при применении операции над Task; клиент его не порождает и не принимает от других клиентов."),
  NoteRevision: never("Ревизии заметки порождает узел при применении операции над Note."),
  DocumentAnnotation: append("Аннотации поверх документа."),

  // --- деньги и строгие инварианты ------------------------------------------------
  Account: strict("Деньги: офлайн-записи нет (ADR-0016 §3.4)."),
  FinanceCategory: strict("Справочник финансов; ссылки из операций."),
  Transaction: strict("Финансовые операции — только онлайн-запись на узле, пока не доказана безопасность merge."),
  TransactionLine: strict("Строки операции."),
  Budget: strict("Бюджеты."),
  RecurringTransaction: strict("Правила повторов материализует узел (lock + уникальный ключ)."),
  CategoryRule: strict("Правила категоризации влияют на деньги."),
  SavingsGoal: strict("Цели накоплений привязаны к балансам."),
  InvestmentTrade: strict("Журнал сделок."),
  FinanceObligation: strict("Долги/кредиты/подписки."),
  FinanceTemplate: strict("Шаблоны операций."),
  FinanceSplit: strict("Общие расходы."),
  FinanceSplitShare: strict("Доли участников."),
  FinanceSettlement: strict("Взаиморасчёты."),
  FinanceExchangeRate: strict("Курсы валют."),
  HomeUtilityMonth: strict("Начисления по месяцам связаны с оплатами."),
  HomeUtilityPayment: strict("Связи оплат с операциями."),
  InventoryItem: strict("Остаток — производное от леджера движений."),
  InventoryMovement: strict("Леджер движений остатка: порядок и сумма важны, только онлайн."),
  TimeEntry: strict("«Один таймер на человека» держит частичный уникальный индекс узла; офлайн-старт нарушил бы инвариант."),
  TimePlan: strict("Недельный план — намерение на календарную неделю; уникальность (пространство, неделя) проверяет узел."),
  PlanningBlock: strict("Тайм-блоки пересекаются с событиями календаря; конфликты и перенос окон проверяет авторитетный узел."),
  PlanningMatrixPreset: strict("Пресет осей матрицы — конфигурация представления; единственность имени проверяет узел."),
  Document: strict("Дерево папок + блобы: файлы передаются по хэшу (ADR-0016 §4), офлайн-правка дерева не поддерживается."),
  DocumentVersion: strict("Версии файлов и их байты."),

  // --- не синхронизируется ----------------------------------------------------------
  Workspace: never("Конфигурация узла (включая режим синхронизации) не едет между узлами."),
  User: never("Личность."),
  RefreshToken: never("Сессионный секрет."),
  UserPreference: never("Личные настройки интерфейса."),
  WorkspaceMember: never("Членство проверяется на авторитетном узле; отзыв — решение узла."),
  WorkspaceInvite: never("Одноразовые токены."),
  SyncRemote: never("Секрет назначения бэкапа."),
  AssistantKey: never("Секрет владельца привязан к узлу."),
  AssistantConversation: never("Личная переписка с ассистентом остаётся на узле, где шёл чат."),
  ExtensionRecord: never("Данные расширений (ADR-0022 E3): офлайн-синхронизация не продумана."),
  ExtensionSecret: never("Секрет привязан к узлу и пользователю."),
  AgentToken: never("Токены агентов привязаны к узлу."),
  AgentMessage: never("Переписка агентов привязана к токенам узла."),
  AgentTask: never("Задания агентов привязаны к токенам узла."),
  FinanceDraft: never("Черновики агентов привязаны к токенам узла."),
  AgentProposal: never("Запросы подтверждения привязаны к токенам узла."),
  AgentCapture: never("Захваты агентов привязаны к токенам узла."),
  AgentAuditEntry: never("Журнал аудита агентов остаётся на узле."),
  Notification: never("Лента уведомлений — состояние узла."),
  SentReminder: never("Дедуп-журнал крона."),
  DomainEvent: never("Outbox доменных событий — служебный транспорт узла (ADR-0019)."),
  DomainEventDelivery: never("Учёт доставок outbox — состояние диспетчера узла (ADR-0019)."),
  SyncChange: never("Лента изменений самой синхронизации."),
  SyncOp: never("Журнал исходов операций самой синхронизации."),
  SyncEntityStamp: never("Штампы слияния самой синхронизации."),
  SyncDevice: never("Реестр устройств самой синхронизации."),
  SyncRestoreOperation: never("Служебная строка восстановления."),
  OpportunityImport: never("Состояние фонового импорта выполняет узел."),
  NoteLink: never("Производное от тела заметки; пересчитывает узел."),
  NoteStackState: never("07 (Заметки 2.0): свёрнутость/порядок стопок — личное per-user состояние интерфейса участника (identity-excluded), не данные пространства."),
  AgentMemberEvent: never("Очередь упоминаний агентского членства (задание 12) — ephemeral транспорт узла, как лента уведомлений."),
  CalendarConnection: never("Внешние фиды тянет узел (SSRF-заслон), клиент их не правит офлайн."),
  PublicationRule: never("Правила раскрытия данных действуют только на авторитетном узле; restore всегда останавливает, ADR-0035."),
  SharedPublication: never("Публикации обслуживает авторитетный узел, ADR-0024."),
  SharedPublicationPin: never("Личные закрепления публикаций, ADR-0024."),
  SharedPublicationOperation: never("Журнал полномочий публикаций, ADR-0024."),
  CrossWorkspaceGrant: never("Политика доступа — решение авторитетного узла."),
  HealthSubject: never("ADR-0012: данные здоровья не покидают узел и не реплицируются на устройства."),
  HealthGrant: never("ADR-0012."),
  HealthAppointment: never("ADR-0012."),
  HealthPreventiveItem: never("ADR-0012."),
  HealthMedication: never("ADR-0012."),
  HealthIntake: never("ADR-0012."),
  HealthMeasurement: never("ADR-0012."),
  HealthTarget: never("ADR-0012."),
  HealthSymptom: never("ADR-0012."),
  // Задание 10: Orion Tables — обычные пользовательские данные, но смена схемы
  // над строками должна проверяться на авторитетном узле, поэтому офлайн-записи
  // в этой фазе нет (те же правила формул и типов колонок).
  TableDefinition: lww("later", "Имя/схема колонок — LWW по полю; смена схемы проверяет строки на узле, офлайн-правка могла бы разойтись с данными."),
  TableRow: lww("later", "Значения/порядок строк — LWW по полю; формулы не хранятся и вычисляются на чтении."),
  KeyBinding: never("Личные сочетания клавиш участника — не данные пространства (identity-excluded).")
};

/** Модели, которые вообще попадают в локальную копию (чтение офлайн) на этапах 1–3. */
export const REPLICATED_MODELS: readonly string[] = ["List", "ListItem", "Note", "Task"];

export function syncClassificationFor(model: string): SyncClassification | undefined {
  return SYNC_CLASSIFICATION[model];
}
