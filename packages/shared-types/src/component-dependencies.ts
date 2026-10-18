import { z } from "zod";
import { COMPONENT_MANIFESTS, componentKindSchema, type ComponentManifest } from "./component-manifest";
import { isModuleEnabled, MODULE_CATALOG, isOrionModuleId } from "./modules";
import { isOrionPluginId, isPluginEnabled } from "./plugins";

/**
 * Зависимости между компонентами (PLATFORM_AUDIT G7). Чистые функции поверх манифестов:
 * «кто зависит от X» и «можно ли выключить X». Выключение ничего не удаляет и не каскадит —
 * зависимые плагины просто неактивны, пока хозяин выключен (см. `pluginStates`).
 */

/** `requires` — жёсткая зависимость (без хозяина компонент не работает), `optional` — справочная. */
export const componentDependencyRelationSchema = z.enum(["requires", "optional"]);
export type ComponentDependencyRelation = z.infer<typeof componentDependencyRelationSchema>;

export const componentDependentSchema = z.object({
  id: z.string(),
  kind: componentKindSchema,
  label: z.string(),
  relation: componentDependencyRelationSchema
});
export type ComponentDependent = z.infer<typeof componentDependentSchema>;

/** Тело 409-ответа `component_has_dependents` (повтор с `confirm: true` выключает компонент). */
export const componentHasDependentsErrorSchema = z.object({
  code: z.literal("component_has_dependents"),
  message: z.string(),
  dependents: z.array(componentDependentSchema)
});
export type ComponentHasDependentsError = z.infer<typeof componentHasDependentsErrorSchema>;

export function isComponentHasDependentsError(value: unknown): value is ComponentHasDependentsError {
  return componentHasDependentsErrorSchema.safeParse(value).success;
}

/** Все зависимые от `id` по манифестам (включённые и нет). Порядок — как в манифестах. */
export function dependentsOf(
  id: string,
  manifests: readonly ComponentManifest[] = COMPONENT_MANIFESTS
): ComponentDependent[] {
  const out: ComponentDependent[] = [];
  for (const manifest of manifests) {
    if (manifest.id === id) continue;
    const relation: ComponentDependencyRelation | null = manifest.requires.modules.includes(id)
      ? "requires"
      : manifest.requires.optionalModules.includes(id)
        ? "optional"
        : null;
    if (relation) out.push({ id: manifest.id, kind: manifest.kind, label: manifest.title, relation });
  }
  return out;
}

export interface WorkspaceComponentState {
  disabledModules: readonly string[];
  pluginOverrides: readonly string[];
}

/** Включён ли компонент в пространстве; плагин с выключенным хозяином считается выключенным. */
export function isComponentEnabled(
  kind: "module" | "plugin",
  id: string,
  state: WorkspaceComponentState,
  manifests: readonly ComponentManifest[] = COMPONENT_MANIFESTS
): boolean {
  if (kind === "module") return isOrionModuleId(id) && isModuleEnabled(state.disabledModules, id);
  if (!isOrionPluginId(id) || !isPluginEnabled(state.pluginOverrides, id)) return false;
  const host = manifests.find((item) => item.kind === "plugin" && item.id === id)?.requires.modules[0];
  return host === undefined || !isOrionModuleId(host) || isModuleEnabled(state.disabledModules, host);
}

/** Включённые зависимые, у которых `id` — жёсткое требование: они перестанут работать вместе с ним. */
export function enabledHardDependents(
  id: string,
  state: WorkspaceComponentState,
  manifests: readonly ComponentManifest[] = COMPONENT_MANIFESTS
): ComponentDependent[] {
  return dependentsOf(id, manifests).filter(
    (item) => item.relation === "requires" && isComponentEnabled(item.kind, item.id, state, manifests)
  );
}

/**
 * Обязателен ли компонент (выключить нельзя). Модули — флаг `required` каталога; плагины обязательными
 * не бывают; оболочка (дашборд, инбокс, поиск, настройки, sync) не является компонентом и тут не выключается.
 */
export function isComponentRequired(kind: "module" | "plugin", id: string): boolean {
  if (kind === "plugin") return false;
  return MODULE_CATALOG.find((item) => item.id === id)?.required === true;
}

/** Есть ли цикл среди жёстких зависимостей; возвращает цепочку ids или `null`. */
export function findHardDependencyCycle(manifests: readonly ComponentManifest[] = COMPONENT_MANIFESTS): string[] | null {
  const byId = new Map(manifests.map((item) => [item.id, item] as const));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const next of byId.get(id)?.requires.modules ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const manifest of manifests) {
    const cycle = visit(manifest.id);
    if (cycle) return cycle;
  }
  return null;
}
