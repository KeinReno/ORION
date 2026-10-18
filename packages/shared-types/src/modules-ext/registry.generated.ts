// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.

/** Идентификаторы модулей, подключённых манифестом; ядро дописывает их в закрытый `z.enum` (modules.ts). */
export const GENERATED_MODULE_IDS = [] as const;

/** Форма записи каталога (структурно совпадает с `ModuleManifest`; тип задан здесь, чтобы не зациклить modules.ts). */
export interface GeneratedModuleCatalogEntry {
  id: (typeof GENERATED_MODULE_IDS)[number];
  kind: "base" | "additional";
  required: boolean;
  label: string;
  summary: string;
  owns: string;
  livesWithout: string;
  provides: readonly string[];
  optionalDependencies: readonly string[];
  disableBehavior: string;
  panelId: string;
  defaultEnabled: boolean;
}

/** Записи каталога модулей; `MODULE_CATALOG` добавляет их к встроенным. */
export const GENERATED_MODULE_CATALOG: readonly GeneratedModuleCatalogEntry[] = [];

/** Основной ресурс модуля для реестра разрешений (`<module>.<resource>.<action>`). */
export const GENERATED_PRIMARY_RESOURCES: Record<(typeof GENERATED_MODULE_IDS)[number], string> = {};
