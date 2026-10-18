import { COMPONENT_MANIFESTS, SHELL_SURFACES, type Surface } from "@orion/shared-types";

/**
 * Surface API (G17): поддерживаемые поверхности панели выводятся из манифеста её владельца
 * (плагин, иначе модуль), а не пишутся в реестре руками. Панель без владельца — оболочка (`SHELL_SURFACES`).
 * Панель-экземпляр (`project:<id>`) не бывает виджетом: виджету нужен компонент без записи-аргумента.
 */
export function derivePanelSurfaces(owner: { moduleId?: string; pluginId?: string; instanced?: boolean }): readonly Surface[] {
  const ownerId = owner.pluginId ?? owner.moduleId;
  const manifest = ownerId ? COMPONENT_MANIFESTS.find((candidate) => candidate.id === ownerId) : undefined;
  if (ownerId && !manifest) throw new Error(`Панель ссылается на компонент без манифеста: ${ownerId}`);
  const surfaces = manifest ? manifest.surfaces : SHELL_SURFACES;
  return owner.instanced ? surfaces.filter((surface) => surface !== "widget") : surfaces;
}
