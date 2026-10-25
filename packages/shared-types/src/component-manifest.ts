import { z } from "zod";
import { MODULE_CATALOG } from "./modules";
import { PLUGIN_CATALOG } from "./plugins";
import { domainEventTypesPublishedBy, domainEventTypesSubscribedBy } from "./domain-events";
import { GENERATED_MODULE_METADATA, GENERATED_MODULE_MIGRATIONS } from "./modules-ext/registry.generated";
import { GENERATED_PLUGIN_METADATA, GENERATED_PLUGIN_SURFACES } from "./plugins-ext/registry.generated";
import { isRegisteredPermission, permissionsOfModule } from "./permissions";
import { isContractId, PLATFORM_CONTRACT_VERSIONS } from "./platform-contracts";

/**
 * Единый машиночитаемый манифест компонента платформы (модуля или плагина) — PLATFORM_AUDIT G1.
 * Сегодня это ПРОИЗВОДНОЕ представление над `MODULE_CATALOG` и `PLUGIN_CATALOG`: источник истины
 * остаётся там, рантайм манифест не читает (см. docs/platform-api/MANIFEST.md).
 */

/** Версия публичного контракта платформы. Смена мажорной части = несовместимое изменение. */
export const PLATFORM_API_VERSION = "1.5.0";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** Поддерживаемые диапазоны: `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`. */
const SEMVER_RANGE = /^(?:\^|~|>=)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const componentKindSchema = z.enum(["module", "plugin"]);
export type ComponentKind = z.infer<typeof componentKindSchema>;

/**
 * Поверхности (PLATFORM.md §3, docs/platform-api/SURFACES.md): где компонент может быть показан.
 * Закрытый набор. «Основная область» и «вкладка» в ORION — одно и то же (панель Workbench-дока), поэтому `dock`.
 */
export const SURFACE_IDS = ["dock", "side", "widget", "floating", "window"] as const;
export const surfaceSchema = z.enum(SURFACE_IDS);
export type Surface = z.infer<typeof surfaceSchema>;

/** Модули с карточкой на дашборде (`DashboardPanel`, `panels/dashboard/*`). */
const DASHBOARD_WIDGET_MODULES: ReadonlySet<string> = new Set([
  "tasks",
  "notes",
  "finance",
  "calendar",
  "habits",
  "contacts",
  "lists",
  "time",
  "projects"
]);

/** Поверхности панели, у которой нет модуля-владельца (оболочка: дашборд, инбокс, браузер, настройки…). */
export const SHELL_SURFACES: readonly Surface[] = ["dock", "floating", "window"];

/**
 * Плагины, чьи поверхности отличаются от «ничего»: две панели (цели, план проекта) и два вклада в слоты оболочки
 * (`shell.sidebar.widgets`, `shell.context.resources`). Остальные плагины расширяют экраны модуля и своей поверхности не имеют.
 */
const PLUGIN_SURFACES: Readonly<Record<string, readonly Surface[]>> = {
  "projects-goals": ["dock", "floating", "window"],
  "projects-planning": ["dock", "floating", "window"],
  "calendar-widget": ["widget"],
  "documents-resources": ["side"]
};

export const componentManifestSchema = z.object({
  id: z.string().min(1),
  kind: componentKindSchema,
  version: z.string().regex(SEMVER, "ожидается semver вида 1.0.0"),
  title: z.string(),
  description: z.string(),
  requires: z.object({
    /** Диапазон версий платформы, например "^1.0.0". */
    platform: z.string().regex(SEMVER_RANGE, "ожидается диапазон вида ^1.0.0"),
    /** Жёсткие зависимости: без них компонент не работает. */
    modules: z.array(z.string()),
    moduleVersions: z.record(z.string(), z.string().regex(SEMVER_RANGE)).optional(),
    /** Мягкие: компонент живёт без них, но использует, если они включены. */
    optionalModules: z.array(z.string()),
    /** Уточнение по контрактам платформы: `{ event: "^1.0.0" }`. Необязательно; ключи — только `CONTRACT_IDS`. */
    contracts: z
      .record(
        z.string().refine(isContractId, "неизвестный контракт платформы"),
        z.string().regex(SEMVER_RANGE, "ожидается диапазон вида ^1.0.0")
      )
      .optional()
  }),
  /**
   * Разрешения компонента из реестра (`permissions.ts`), вида `tasks.task.read`. Модуль перечисляет свои операции;
   * плагин — те, что ему нужны от других (пока пусто: идентичности плагина в запросах нет). Только id из реестра.
   */
  permissions: z.array(z.string().refine(isRegisteredPermission, "разрешение не из реестра")),
  /**
   * Поддерживаемые поверхности (G17). Панель компонента предлагается только там, где поверхность перечислена
   * (`PanelDefinition.surfaces` в веб-реестре выводится отсюда); панель-экземпляр не бывает `widget`.
   */
  surfaces: z.array(surfaceSchema),
  contributions: z.object({
    panels: z.array(z.string()).optional(),
    slots: z.array(z.string()).optional(),
    apiRoutes: z.array(z.string()).optional()
  }),
  events: z.object({ publishes: z.array(z.string()), subscribes: z.array(z.string()) }),
  migrations: z.array(z.string())
});
export type ComponentManifest = z.infer<typeof componentManifestSchema>;
export interface ComponentMetadata {
  version: string;
  requires?: Partial<Pick<ComponentManifest["requires"], "platform" | "modules" | "moduleVersions" | "contracts">>;
}
export interface ComponentIncompatibleError {
  code: "component_incompatible";
  componentId: string;
  message: string;
  problems: string[];
}

function parseVersion(value: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = value.split(".").map(Number);
  return [major, minor, patch];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

/** Минимальная проверка диапазона без зависимостей: точная версия, `^`, `~`, `>=`. */
export function satisfiesVersionRange(range: string, version: string): boolean {
  if (!SEMVER_RANGE.test(range) || !SEMVER.test(version)) return false;
  const base = parseVersion(range.replace(/^[\^~>=]+/, ""));
  const actual = parseVersion(version);
  if (![...base, ...actual].every(Number.isSafeInteger)) return false;
  if (range.startsWith(">=")) return compareVersions(actual, base) >= 0;
  if (compareVersions(actual, base) < 0) return false;
  if (range.startsWith("~")) return actual[0] === base[0] && actual[1] === base[1];
  if (range.startsWith("^")) {
    // Before 1.0 caret fixes the first nonzero part; ^0.0.x fixes patch.
    if (base[0] > 0) return actual[0] === base[0];
    if (base[1] > 0) return actual[0] === 0 && actual[1] === base[1];
    return actual[0] === 0 && actual[1] === 0 && actual[2] === base[2];
  }
  return compareVersions(actual, base) === 0;
}

/** Контракты, версия которых не удовлетворяет `requires.contracts` манифеста (пусто — всё совместимо). */
export function unsatisfiedContracts(manifest: Pick<ComponentManifest, "requires">): string[] {
  const bad: string[] = [];
  for (const [id, range] of Object.entries(manifest.requires.contracts ?? {})) {
    const actual = isContractId(id) ? PLATFORM_CONTRACT_VERSIONS[id] : undefined;
    if (!actual || !satisfiesVersionRange(range, actual)) bad.push(id);
  }
  return bad;
}

const COMPONENT_VERSION = "1.0.0";
const PLATFORM_RANGE = "^1.0.0";

/** Манифесты всех модулей и плагинов, выведенные из каталогов. Данных, которых нет в каталоге, здесь нет (пустые списки). */
export function buildComponentManifests(): ComponentManifest[] {
  const modules: ComponentManifest[] = MODULE_CATALOG.map((module) => ({
    id: module.id,
    kind: "module",
    version: GENERATED_MODULE_METADATA[module.id]?.version ?? COMPONENT_VERSION,
    title: module.label,
    description: module.summary,
    requires: { platform: PLATFORM_RANGE, modules: [], ...GENERATED_MODULE_METADATA[module.id]?.requires, optionalModules: [...module.optionalDependencies] },
    permissions: permissionsOfModule(module.id),
    surfaces: [...SHELL_SURFACES, ...(DASHBOARD_WIDGET_MODULES.has(module.id) ? (["widget"] as const) : [])],
    contributions: { panels: [module.panelId] },
    events: { publishes: domainEventTypesPublishedBy(module.id), subscribes: domainEventTypesSubscribedBy(module.id) },
    migrations: [...((GENERATED_MODULE_MIGRATIONS as Record<string, readonly string[]>)[module.id] ?? [])]
  }));
  const plugins: ComponentManifest[] = PLUGIN_CATALOG.map((plugin) => ({
    id: plugin.id,
    kind: "plugin",
    version: GENERATED_PLUGIN_METADATA[plugin.id]?.version ?? COMPONENT_VERSION,
    title: plugin.label,
    description: plugin.summary,
    requires: { platform: PLATFORM_RANGE, ...GENERATED_PLUGIN_METADATA[plugin.id]?.requires, modules: [...new Set([plugin.extendsModuleId, ...(GENERATED_PLUGIN_METADATA[plugin.id]?.requires?.modules ?? [])])], optionalModules: [] },
    permissions: [],
    surfaces: [...(PLUGIN_SURFACES[plugin.id] ?? GENERATED_PLUGIN_SURFACES[plugin.id] ?? [])],
    // Слоты, в которые вносит вклад плагин, известны только веб-реестру (apps/web/plugins/index.ts);
    // их сверка с каталогом — в scripts/architecture-check.mjs.
    contributions: {},
    events: { publishes: [], subscribes: domainEventTypesSubscribedBy(plugin.id) },
    migrations: []
  }));
  return [...modules, ...plugins];
}

export const COMPONENT_MANIFESTS: readonly ComponentManifest[] = buildComponentManifests();

/** Shared diagnostic policy; callers supply the transaction's effective enabled modules. */
export function componentCompatibilityProblems(
  id: string,
  enabledModules: ReadonlySet<string>,
  manifests: readonly ComponentManifest[] = COMPONENT_MANIFESTS
): string[] {
  const problems = new Set<string>();
  const checked = new Set<string>();
  const visit = (componentId: string, trail: string[]) => {
    if (trail.includes(componentId)) { problems.add(`Цикл обязательных зависимостей: ${[...trail, componentId].join(" → ")}`); return; }
    if (checked.has(componentId)) return;
    const manifest = manifests.find(m => m.id === componentId);
    if (!manifest) { problems.add(`Компонент ${componentId} не зарегистрирован`); return; }
    const parsed = componentManifestSchema.safeParse(manifest);
    if (!parsed.success) { problems.add(`Некорректный манифест ${componentId}`); return; }
    if (!satisfiesVersionRange(manifest.requires.platform, PLATFORM_API_VERSION)) problems.add(`${componentId}: нужна платформа ${manifest.requires.platform}, установлена ${PLATFORM_API_VERSION}`);
    for (const contract of unsatisfiedContracts(manifest)) problems.add(`${componentId}: несовместимый контракт ${contract}`);
    for (const key of Object.keys(manifest.requires.moduleVersions ?? {})) {
      if (!manifest.requires.modules.includes(key)) problems.add(`${componentId}: версия ${key} указана без обязательной зависимости`);
    }
    for (const dependency of manifest.requires.modules) {
      const target = manifests.find(m => m.id === dependency && m.kind === "module");
      if (!target) { problems.add(`${componentId}: модуль ${dependency} не зарегистрирован`); continue; }
      if (!enabledModules.has(dependency)) problems.add(`${componentId}: включите модуль ${dependency}`);
      const range = manifest.requires.moduleVersions?.[dependency];
      if (range && !satisfiesVersionRange(range, target.version)) problems.add(`${componentId}: нужен ${dependency} ${range}, установлен ${target.version}`);
      visit(dependency, [...trail, componentId]);
    }
    checked.add(componentId);
  };
  visit(id, []);
  return [...problems];
}
