import { z } from "zod";
import { orionModuleIdSchema, type OrionModuleId } from "./modules";

/**
 * Plugins extend exactly one existing domain module — never the base shell
 * (dashboard/inbox/search/settings/sync). This is deliberately NOT a runtime
 * for loading arbitrary/external code: docs/PLAN.md rejected a real Plugin
 * Runtime twice (v0.20, v0.23) as premature. A plugin here is a compiled-in
 * unit at the same trust level as a module, registered the same way
 * (PLUGIN_CATALOG mirrors MODULE_CATALOG) — the only extra rule is
 * `extendsModuleId` and auto-disable when that module is off.
 */
export const ORION_PLUGIN_IDS = ["team", "habits-insights"] as const;

export const orionPluginIdSchema = z.enum(ORION_PLUGIN_IDS);
export type OrionPluginId = z.infer<typeof orionPluginIdSchema>;

export const pluginManifestSchema = z.object({
  id: orionPluginIdSchema,
  /** The one module this plugin extends. */
  extendsModuleId: orionModuleIdSchema,
  label: z.string(),
  summary: z.string(),
  provides: z.array(z.string()),
  disableBehavior: z.string(),
  defaultEnabled: z.boolean()
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const workspacePluginStateSchema = pluginManifestSchema.extend({
  enabled: z.boolean()
});
export type WorkspacePluginState = z.infer<typeof workspacePluginStateSchema>;

export const setWorkspacePluginInputSchema = z.object({
  enabled: z.boolean()
});
export type SetWorkspacePluginInput = z.infer<typeof setWorkspacePluginInputSchema>;

export function isOrionPluginId(value: string): value is OrionPluginId {
  return (ORION_PLUGIN_IDS as readonly string[]).includes(value);
}

/**
 * `pluginOverrides` holds ids whose enabled state was flipped away from the
 * manifest's `defaultEnabled` — unlike modules (all `defaultEnabled: true`,
 * so "disabled list" and "overrides" coincide), a plugin can default off, so
 * "empty list = everything on" would be wrong here. An id present in the
 * list means "not at default"; absent means "at default".
 */
export function isPluginEnabled(pluginOverrides: readonly string[] | null | undefined, id: OrionPluginId): boolean {
  const manifest = PLUGIN_CATALOG.find((item) => item.id === id);
  if (!manifest) return false;
  const overridden = (pluginOverrides ?? []).includes(id);
  return overridden ? !manifest.defaultEnabled : manifest.defaultEnabled;
}

/**
 * A plugin whose host module is disabled is always reported disabled here,
 * regardless of `pluginOverrides` — auto-disable, not a separate flag to
 * keep in sync.
 */
export function pluginStates(
  pluginOverrides: readonly string[] | null | undefined,
  enabledModuleIds: ReadonlySet<OrionModuleId>
): WorkspacePluginState[] {
  return PLUGIN_CATALOG.map((manifest) => ({
    ...manifest,
    enabled: isPluginEnabled(pluginOverrides, manifest.id) && enabledModuleIds.has(manifest.extendsModuleId)
  }));
}

/** Compiled-in catalog — same posture as MODULE_CATALOG, now two plugins: the original optional `team` and the first extraction, `habits-insights`. */
export const PLUGIN_CATALOG: readonly PluginManifest[] = [
  {
    id: "team",
    extendsModuleId: "tasks",
    label: "Команда",
    summary: "Назначение задач участникам, роль «тимлид» и фильтр «Мои задачи».",
    provides: ["Assignee у задачи", "Фильтр «Мои задачи»", "Роль «Тимлид»"],
    disableBehavior: "Назначение скрывается из интерфейса и не проверяется API; уже расставленные исполнители сохраняются.",
    defaultEnabled: false
  },
  {
    id: "habits-insights",
    extendsModuleId: "habits",
    label: "Аналитика привычек",
    summary: "Неделя по каждой привычке и 12-недельная карта активности рядом с ежедневным списком.",
    provides: ["Блок «Неделя»", "Блок «Активность» (12 недель)", "Отметка любого дня недели"],
    disableBehavior:
      "Блоки «Неделя» и «Активность» скрываются; отметки, серии и список «Сегодня» работают как прежде, данные не удаляются.",
    // Extracted from the base panel without changing what anyone sees: on by default.
    defaultEnabled: true
  }
];
