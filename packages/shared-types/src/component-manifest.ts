import { z } from "zod";
import { MODULE_CATALOG } from "./modules";
import { PLUGIN_CATALOG } from "./plugins";
import { isRegisteredPermission, permissionsOfModule } from "./permissions";

/**
 * Единый машиночитаемый манифест компонента платформы (модуля или плагина) — PLATFORM_AUDIT G1.
 * Сегодня это ПРОИЗВОДНОЕ представление над `MODULE_CATALOG` и `PLUGIN_CATALOG`: источник истины
 * остаётся там, рантайм манифест не читает (см. docs/platform-api/MANIFEST.md).
 */

/** Версия публичного контракта платформы. Смена мажорной части = несовместимое изменение. */
export const PLATFORM_API_VERSION = "1.0.0";

const SEMVER = /^\d+\.\d+\.\d+$/;
/** Поддерживаемые диапазоны: `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`. */
const SEMVER_RANGE = /^(?:\^|~|>=)?\d+\.\d+\.\d+$/;

export const componentKindSchema = z.enum(["module", "plugin"]);
export type ComponentKind = z.infer<typeof componentKindSchema>;

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
    /** Мягкие: компонент живёт без них, но использует, если они включены. */
    optionalModules: z.array(z.string())
  }),
  /**
   * Разрешения компонента из реестра (`permissions.ts`), вида `tasks.task.read`. Модуль перечисляет свои операции;
   * плагин — те, что ему нужны от других (пока пусто: идентичности плагина в запросах нет). Только id из реестра.
   */
  permissions: z.array(z.string().refine(isRegisteredPermission, "разрешение не из реестра")),
  contributions: z.object({
    panels: z.array(z.string()).optional(),
    slots: z.array(z.string()).optional(),
    apiRoutes: z.array(z.string()).optional()
  }),
  events: z.object({ publishes: z.array(z.string()), subscribes: z.array(z.string()) }),
  migrations: z.array(z.string())
});
export type ComponentManifest = z.infer<typeof componentManifestSchema>;

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
  if (range.startsWith(">=")) return compareVersions(actual, base) >= 0;
  if (compareVersions(actual, base) < 0) return false;
  if (range.startsWith("~")) return actual[0] === base[0] && actual[1] === base[1];
  if (range.startsWith("^")) {
    // Для 0.x каретка фиксирует минорную часть (как в npm).
    return base[0] > 0 ? actual[0] === base[0] : actual[0] === 0 && actual[1] === base[1];
  }
  return compareVersions(actual, base) === 0;
}

const COMPONENT_VERSION = "1.0.0";
const PLATFORM_RANGE = "^1.0.0";

/** Манифесты всех модулей и плагинов, выведенные из каталогов. Данных, которых нет в каталоге, здесь нет (пустые списки). */
export function buildComponentManifests(): ComponentManifest[] {
  const modules: ComponentManifest[] = MODULE_CATALOG.map((module) => ({
    id: module.id,
    kind: "module",
    version: COMPONENT_VERSION,
    title: module.label,
    description: module.summary,
    requires: { platform: PLATFORM_RANGE, modules: [], optionalModules: [...module.optionalDependencies] },
    permissions: permissionsOfModule(module.id),
    contributions: { panels: [module.panelId] },
    events: { publishes: [], subscribes: [] },
    migrations: []
  }));
  const plugins: ComponentManifest[] = PLUGIN_CATALOG.map((plugin) => ({
    id: plugin.id,
    kind: "plugin",
    version: COMPONENT_VERSION,
    title: plugin.label,
    description: plugin.summary,
    requires: { platform: PLATFORM_RANGE, modules: [plugin.extendsModuleId], optionalModules: [] },
    permissions: [],
    // Слоты, в которые вносит вклад плагин, известны только веб-реестру (apps/web/plugins/index.ts);
    // их сверка с каталогом — в scripts/architecture-check.mjs.
    contributions: {},
    events: { publishes: [], subscribes: [] },
    migrations: []
  }));
  return [...modules, ...plugins];
}

export const COMPONENT_MANIFESTS: readonly ComponentManifest[] = buildComponentManifests();
