import { CORE_MODULE_IDS, ORION_MODULE_IDS, type OrionModuleId } from "./modules";
import { GENERATED_ADDITIONAL_PERMISSIONS, GENERATED_PRIMARY_RESOURCES } from "./modules-ext/registry.generated";
import type { AgentScope } from "./agent";
import { workspaceRoleSchema } from "./workspace";

/**
 * Единый реестр разрешений платформы (PLATFORM_AUDIT G12, docs/platform-api/PERMISSIONS.md).
 * Формат id: `<module>.<resource>.<action>`, где `module` — id модуля или `core`, а
 * `action` — `read | create | update | delete | propose | manage`.
 *
 * Реестр — источник истины для: поля `permissions` манифестов, серверного `@RequirePermission`
 * и отображения агентских scope'ов в разрешения. Видимость данных (RLS, приватные счета, гранты)
 * сюда не входит: словарь отвечает на «можно ли операцию», RLS — на «какие строки».
 */
export const PERMISSION_ACTIONS = ["read", "create", "update", "delete", "propose", "manage"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Основной ресурс каждого модуля. Модуль получает CRUD по нему; дополнительные операции — в `EXTRA_PERMISSIONS`. */
const CORE_PRIMARY_RESOURCE: Record<(typeof CORE_MODULE_IDS)[number], string> = {
  tasks: "task",
  notes: "note",
  knowledge: "item",
  calendar: "event",
  documents: "document",
  projects: "project",
  time: "entry",
  planning: "block",
  finance: "transaction",
  habits: "habit",
  lists: "list",
  inventory: "item",
  markets: "trade",
  opportunities: "opportunity",
  home: "item",
  contacts: "contact",
  health: "record"
};

/** Основной ресурс каждого модуля; у подключаемых (G5) берётся из манифеста через автогенерируемый реестр. */
export const MODULE_PRIMARY_RESOURCE: Record<OrionModuleId, string> = { ...CORE_PRIMARY_RESOURCE, ...GENERATED_PRIMARY_RESOURCES };

const CRUD_ACTIONS = ["read", "create", "update", "delete"] as const;

/** Операции вне CRUD основного ресурса: из таблицы PERMISSIONS.md (черновики финансов, ядро платформы). */
const EXTRA_PERMISSIONS = [
  "finance.draft.propose",
  "core.link.create",
  "core.link.delete",
  "core.agent_message.create",
  "core.agent_job.create",
  "core.agent_job.update",
  // Tasks 2.0 (задание 02): настройка справочников и рекуррентности — отдельные
  // операции поверх CRUD задачи (массовые операции используют `tasks.task.update`/`delete`).
  "tasks.status.manage",
  "tasks.field.manage",
  "tasks.recurrence.manage",
  // Foundation Core (задание 01): единый слой связей и диагностика outbox.
  "entity-links.read",
  "entity-links.manage",
  // Центр проектов (задание 03): шаблон — НЕ проект, поэтому у него свои права
  // (`projects.templates.*` из задания в реестре — `projects.template.*`:
  // формат реестра `module.resource.action`, ресурсы в единственном числе).
  "projects.template.read",
  "projects.template.create",
  "projects.template.update",
  "projects.template.delete",
  // Портфель и история — отдельные операции чтения поверх проектов.
  "projects.portfolio.read",
  "projects.history.read",
  "core.domain_event.manage",
  // Планирование (задание 04): чтение представлений (Гантт, матрица, dry-run
  // переноса) — отдельная операция, потому что это межмодульное чтение задач и
  // событий через контракты владельцев, а не CRUD тайм-блока.
  "planning.view.read",
  "planning.preset.manage",
  // Учёт времени (задание 04): недельный план — не запись времени, у него свой
  // смысл и свой тумблер; аналитика читает уже существующие `time.entry.read`.
  "time.plan.manage",
  // Общие инструменты (задание 10): таблицы — поверхность ядра, а не предметный
  // модуль, поэтому у них собственный ресурс `core.table`, а команды и личные
  // горячие клавиши — отдельные операции `core.command`/`core.key_binding`.
  "core.table.read",
  "core.table.create",
  "core.table.update",
  "core.table.delete",
  "core.command.read",
  "core.command.execute",
  "core.key_binding.manage"
] as const;

function buildPermissionIds(): string[] {
  const ids: string[] = [];
  for (const moduleId of ORION_MODULE_IDS) {
    for (const action of CRUD_ACTIONS) ids.push(`${moduleId}.${MODULE_PRIMARY_RESOURCE[moduleId]}.${action}`);
  }
  ids.push(...GENERATED_ADDITIONAL_PERMISSIONS, ...EXTRA_PERMISSIONS);
  return ids;
}

export const PERMISSION_IDS = buildPermissionIds() as readonly string[];
export type PermissionId = string;

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSION_IDS);

export function isRegisteredPermission(value: string): boolean {
  return PERMISSION_SET.has(value);
}

/** Разрешения, принадлежащие модулю (сегмент `module`). */
export function permissionsOfModule(moduleId: OrionModuleId | "core"): string[] {
  return PERMISSION_IDS.filter((id) => id.startsWith(`${moduleId}.`));
}

/**
 * Агентский scope → разрешения (таблица PERMISSIONS.md). Строки scope'ов не менялись: `AGENT_SCOPES` остаётся
 * закрытым списком, а это — его проекция на реестр. Полный вывод `AGENT_SCOPES` из реестра — следующий шаг (G13).
 */
export const AGENT_SCOPE_PERMISSIONS: Record<AgentScope, readonly string[]> = {
  "tasks:read": ["tasks.task.read"],
  "tasks:write": ["tasks.task.create", "tasks.task.update"],
  "notes:read": ["notes.note.read"],
  "notes:write": ["notes.note.create", "notes.note.update"],
  "projects:read": ["projects.project.read"],
  "events:read": ["calendar.event.read"],
  "events:write": ["calendar.event.create", "calendar.event.update"],
  "finance:draft": ["finance.draft.propose"],
  "links:write": ["core.link.create", "core.link.delete", "entity-links.manage"],
  "agents:message": ["core.agent_message.create"],
  "agents:delegate": ["core.agent_job.create", "core.agent_job.update"]
};

/** Разрешения, которые дают scope'ы токена вместе. Режимы и матрица токена сужают их дальше (`decideAgentOperation`). */
export function permissionsOfScopes(scopes: readonly AgentScope[]): Set<string> {
  const out = new Set<string>();
  for (const scope of scopes) for (const permission of AGENT_SCOPE_PERMISSIONS[scope] ?? []) out.add(permission);
  return out;
}

/** Роль пространства → разрешения. Сегодня все роли (`owner`/`lead`/`member`) могут все операции; ограничения идут через
 * `restrictedModules`, владелец-только переключатели и RLS, а не через этот словарь. Различие ролей появится здесь. */
export const ROLE_PERMISSIONS: Record<(typeof workspaceRoleSchema.options)[number], readonly string[]> = {
  owner: PERMISSION_IDS,
  lead: PERMISSION_IDS,
  member: PERMISSION_IDS
};

export type PermissionPrincipal =
  /** Человек (JWT). Без `role` — роль не загружалась: членство в пространстве проверяет сервис (`assertMember`). */
  | { kind: "user"; role?: keyof typeof ROLE_PERMISSIONS }
  /** Токен Agent Gateway. */
  | { kind: "agent"; scopes: readonly AgentScope[] }
  /** Плагин, действующий от пользователя: только то, что объявлено в его манифесте (`permissions`). */
  | { kind: "plugin"; declared: readonly string[] };

/** Чистое решение «можно ли субъекту это разрешение». Незарегистрированное разрешение не разрешено никому. */
export function isAllowed(principal: PermissionPrincipal, permission: string): boolean {
  if (!isRegisteredPermission(permission)) return false;
  switch (principal.kind) {
    case "user":
      return principal.role ? ROLE_PERMISSIONS[principal.role].includes(permission) : true;
    case "agent":
      return permissionsOfScopes(principal.scopes).has(permission);
    case "plugin":
      return principal.declared.includes(permission);
  }
}
