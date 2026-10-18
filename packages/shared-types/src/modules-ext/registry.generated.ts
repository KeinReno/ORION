// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.

/** Идентификаторы модулей, подключённых манифестом; ядро дописывает их в закрытый `z.enum` (modules.ts). */
export const GENERATED_MODULE_IDS = [
  "pet-care"
] as const;

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
export const GENERATED_MODULE_CATALOG: readonly GeneratedModuleCatalogEntry[] = [
  {
    "id": "pet-care",
    "kind": "additional",
    "required": false,
    "label": "Питомцы",
    "summary": "Карточки питомцев и журнал ухода: кормление, ветеринар, лекарства, прогулки.",
    "owns": "Питомцы пространства (имя, вид, день рождения, заметки) и записи ухода за ними.",
    "livesWithout": "Полностью самостоятелен: не требует и не использует другие предметные модули.",
    "provides": [
      "Панель «Питомцы»",
      "Журнал ухода по каждому питомцу"
    ],
    "optionalDependencies": [],
    "disableBehavior": "Панель и API скрываются. Питомцы и записи ухода сохраняются и вернутся при включении.",
    "panelId": "pet-care",
    "defaultEnabled": true
  }
];

/** Основной ресурс модуля для реестра разрешений (`<module>.<resource>.<action>`). */
export const GENERATED_PRIMARY_RESOURCES: Record<(typeof GENERATED_MODULE_IDS)[number], string> = {
  "pet-care": "pet"
};

export * from "./pet-care";
