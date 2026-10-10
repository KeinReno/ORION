import { z } from "zod";
import type { SearchableEntityType } from "./search";
import type { WorkspaceRole } from "./workspace";

/**
 * Domain modules that a workspace can turn off. Shell surfaces (dashboard,
 * inbox, search, notifications, settings, sync) are not in this list: they
 * belong to the core and stay available. See docs/MODULES_AND_PLUGINS.md.
 */
export const ORION_MODULE_IDS = [
  "tasks",
  "notes",
  "calendar",
  "documents",
  "projects",
  "time",
  "finance",
  "habits",
  "lists",
  "inventory",
  "markets"
] as const;

export const orionModuleIdSchema = z.enum(ORION_MODULE_IDS);
export type OrionModuleId = z.infer<typeof orionModuleIdSchema>;

export const moduleKindSchema = z.enum(["base", "additional"]);
export type ModuleKind = z.infer<typeof moduleKindSchema>;

export const moduleManifestSchema = z.object({
  id: orionModuleIdSchema,
  kind: moduleKindSchema,
  /** Currently none of the domain modules are forced on. */
  required: z.boolean(),
  label: z.string(),
  summary: z.string(),
  owns: z.string(),
  livesWithout: z.string(),
  provides: z.array(z.string()),
  optionalDependencies: z.array(orionModuleIdSchema),
  disableBehavior: z.string(),
  panelId: z.string(),
  defaultEnabled: z.boolean()
});
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export const workspaceModuleStateSchema = moduleManifestSchema.extend({
  enabled: z.boolean(),
  /** Visible only to `owner`/`lead` — see `isModuleRestricted`. */
  restricted: z.boolean()
});
export type WorkspaceModuleState = z.infer<typeof workspaceModuleStateSchema>;

export const setWorkspaceModuleInputSchema = z.object({
  enabled: z.boolean()
});
export type SetWorkspaceModuleInput = z.infer<typeof setWorkspaceModuleInputSchema>;

/** Separate from `setWorkspaceModuleInputSchema` — two independent toggles, two narrow endpoints. */
export const setWorkspaceModuleRestrictionInputSchema = z.object({
  restricted: z.boolean()
});
export type SetWorkspaceModuleRestrictionInput = z.infer<typeof setWorkspaceModuleRestrictionInputSchema>;

export function isOrionModuleId(value: string): value is OrionModuleId {
  return (ORION_MODULE_IDS as readonly string[]).includes(value);
}

/** Empty / missing list = everything in the catalog is on. Disable ≠ delete. */
export function isModuleEnabled(
  disabledModules: readonly string[] | null | undefined,
  id: OrionModuleId
): boolean {
  return !(disabledModules ?? []).includes(id);
}

/** Empty / missing list = nobody is restricted, `owner`/`lead` never are regardless. */
export function isModuleRestricted(
  restrictedModules: readonly string[] | null | undefined,
  id: OrionModuleId
): boolean {
  return (restrictedModules ?? []).includes(id);
}

export function moduleStates(
  disabledModules: readonly string[] | null | undefined,
  restrictedModules: readonly string[] | null | undefined
): WorkspaceModuleState[] {
  const disabled = disabledModules ?? [];
  const restricted = restrictedModules ?? [];
  return MODULE_CATALOG.map((manifest) => ({
    ...manifest,
    enabled: isModuleEnabled(disabled, manifest.id),
    restricted: isModuleRestricted(restricted, manifest.id)
  }));
}

/**
 * What's actually hidden from *this* viewer: disabled modules for everyone,
 * plus restricted modules for a plain `member` (owner/lead see everything
 * that isn't disabled). Feeds straight into `visiblePanels`/`isModuleEnabled`
 * call sites, which only know "disabled" — the union is computed once here
 * so the two independent client call sites (sidebar/dockview and the command
 * palette) can't drift apart on what "hidden" means.
 */
export function effectiveDisabledModules(workspace: {
  disabledModules: readonly string[];
  restrictedModules: readonly string[];
  role: WorkspaceRole;
}): string[] {
  const hidden = new Set(workspace.disabledModules);
  if (workspace.role === "member") {
    for (const id of workspace.restrictedModules) hidden.add(id);
  }
  return [...hidden];
}

export const SEARCH_TYPE_MODULE: Record<SearchableEntityType, OrionModuleId> = {
  project: "projects",
  task: "tasks",
  note: "notes",
  event: "calendar",
  document: "documents",
  transaction: "finance"
};

export const INBOX_TARGET_MODULE: Record<"task" | "note" | "event", OrionModuleId> = {
  task: "tasks",
  note: "notes",
  event: "calendar"
};

/**
 * Built-in catalog. This is the internal Module Registry for v0.20 — compiled
 * into the app, not loaded from disk. Disable keeps data; re-enable restores
 * the panel, commands and API without a migration.
 */
export const MODULE_CATALOG: readonly ModuleManifest[] = [
  {
    id: "tasks",
    kind: "base",
    required: false,
    label: "Задачи",
    summary: "Списки, доска и сроки.",
    owns: "Задачи, подзадачи, зависимости, сохранённые виды.",
    livesWithout: "Работает без проектов, календаря и учёта времени.",
    provides: ["Панель «Задачи»", "Команды создания", "Вклад в карточку проекта"],
    optionalDependencies: ["projects", "calendar", "time"],
    disableBehavior: "Панель и API скрываются. Строки задач в базе сохраняются и вернутся при включении.",
    panelId: "tasks",
    defaultEnabled: true
  },
  {
    id: "notes",
    kind: "base",
    required: false,
    label: "Заметки",
    summary: "Текстовые заметки, шаблоны и история правок.",
    owns: "Заметки, ревизии, wiki-ссылки, теги.",
    livesWithout: "Работает без документов и проектов.",
    provides: ["Панель «Заметки»", "Быстрый захват текста", "Вклад в карточку проекта"],
    optionalDependencies: ["documents", "projects"],
    disableBehavior: "Панель и API скрываются. Заметки и ревизии сохраняются.",
    panelId: "notes",
    defaultEnabled: true
  },
  {
    id: "calendar",
    kind: "base",
    required: false,
    label: "Календарь",
    summary: "События, напоминания и внешние ICS-фиды.",
    owns: "События, подключения календарей, исходящий ICS-фид.",
    livesWithout: "Работает без задач и проектов.",
    provides: ["Панель «Календарь»", "Напоминания событий", "Вклад в карточку проекта"],
    optionalDependencies: ["tasks", "projects"],
    disableBehavior: "Панель, API и фид по токену останавливаются. События сохраняются.",
    panelId: "calendar",
    defaultEnabled: true
  },
  {
    id: "documents",
    kind: "base",
    required: false,
    label: "Документы",
    summary: "Файлы и папки рабочего пространства.",
    owns: "Документы, версии, превью, хранилище файлов.",
    livesWithout: "Работает без заметок и задач.",
    provides: ["Панель «Документы»", "Вложения", "Вклад в карточку проекта"],
    optionalDependencies: ["notes", "projects"],
    disableBehavior: "Панель и загрузка файлов останавливаются. Файлы на диске и в базе сохраняются.",
    panelId: "documents",
    defaultEnabled: true
  },
  {
    id: "projects",
    kind: "additional",
    required: false,
    label: "Проекты",
    summary: "Контейнер работы: сроки, бюджет, ставка.",
    owns: "Проекты и их собственные поля (имя, статус, сроки, бюджет, ставка).",
    livesWithout: "Работает без задач, финансов и учёта времени — связанные показатели просто не показываются.",
    provides: ["Панель «Проекты»", "Привязка других сущностей"],
    optionalDependencies: ["tasks", "notes", "calendar", "documents", "time", "finance"],
    disableBehavior: "Панель скрывается. Проекты сохраняются; чужие сущности продолжают хранить projectId.",
    panelId: "projects",
    defaultEnabled: true
  },
  {
    id: "time",
    kind: "additional",
    required: false,
    label: "Время",
    summary: "Таймер и записи затраченного времени.",
    owns: "Записи времени и запущенный таймер.",
    livesWithout: "Работает без задач и проектов, но тогда записи никуда не группируются.",
    provides: ["Панель «Время»", "Минуты и стоимость в карточке проекта"],
    optionalDependencies: ["tasks", "projects"],
    disableBehavior: "Панель, таймер и API останавливаются. Записи времени сохраняются.",
    panelId: "time",
    defaultEnabled: true
  },
  {
    id: "finance",
    kind: "additional",
    required: false,
    label: "Финансы",
    summary: "Счета, операции, бюджеты и отчёты.",
    owns: "Счета, категории, операции, бюджеты, цели, правила.",
    livesWithout: "Работает без проектов — привязка к проекту необязательна.",
    provides: ["Панель «Финансы»", "Расход в карточке проекта"],
    optionalDependencies: ["projects"],
    disableBehavior: "Панель и фоновая материализация платежей останавливаются. Операции сохраняются.",
    panelId: "finance",
    defaultEnabled: true
  },
  {
    id: "habits",
    kind: "additional",
    required: false,
    label: "Привычки",
    summary: "Повторяющиеся привычки и отметки по дням.",
    owns: "Привычки и ежедневные отметки.",
    livesWithout: "Полностью независим от остальных предметных модулей.",
    provides: ["Панель «Привычки»"],
    optionalDependencies: [],
    disableBehavior: "Панель и API скрываются. Привычки и история отметок сохраняются.",
    panelId: "habits",
    defaultEnabled: true
  },
  {
    id: "lists",
    kind: "additional",
    required: false,
    label: "Списки",
    summary: "Лёгкие чек-листы: покупки, дела — что угодно с галочками.",
    owns: "Списки и их пункты.",
    livesWithout: "Полностью независим от остальных предметных модулей.",
    provides: ["Панель «Списки»"],
    optionalDependencies: [],
    disableBehavior: "Панель и API скрываются. Списки и их пункты сохраняются.",
    panelId: "lists",
    defaultEnabled: true
  },
  {
    id: "inventory",
    kind: "additional",
    required: false,
    label: "Склад",
    summary: "Номенклатура, остатки и движения.",
    owns: "Позиции склада и леджер движений (приход/расход/корректировка).",
    livesWithout: "Работает без проектов — привязка к проекту необязательна.",
    provides: ["Панель «Склад»", "Уведомления о низком остатке"],
    optionalDependencies: ["projects"],
    disableBehavior: "Панель и API скрываются. Позиции и движения сохраняются.",
    panelId: "inventory",
    defaultEnabled: true
  },
  {
    id: "markets",
    kind: "additional",
    required: false,
    label: "Рынки",
    summary: "Список наблюдения и журнал сделок из Compass; графики и стратегии остаются в Compass.",
    owns: "Список наблюдения, загруженные сделки (реальные, бумажные, исторические), позиции по реальным сделкам.",
    livesWithout: "Полностью независим: Compass может быть не установлен, а финансы работают сами по себе.",
    provides: ["Панель «Рынки»", "Импорт журнала Compass с проверкой", "Запись комиссии сделки в финансы по явному действию"],
    optionalDependencies: ["finance"],
    disableBehavior: "Панель и API скрываются. Список наблюдения и сделки сохраняются и вернутся при включении.",
    panelId: "markets",
    defaultEnabled: false
  }
];
