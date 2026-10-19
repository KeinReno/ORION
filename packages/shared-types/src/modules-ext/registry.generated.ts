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
    "summary": "Карточки питомцев, журнал ухода и дневник самочувствия: симптомы по дням, события, статистика, отчёт для ветеринара.",
    "owns": "Питомцы пространства (профиль, порода, контакт клиники), записи ухода, дневник самочувствия по дням и события питомца.",
    "livesWithout": "Полностью самостоятелен: не требует и не использует другие предметные модули.",
    "provides": [
      "Панель «Питомцы»",
      "Журнал ухода по каждому питомцу",
      "Дневник самочувствия с календарём, статистикой и отчётом для ветеринара",
      "Импорт резервной копии MurHP"
    ],
    "optionalDependencies": [],
    "disableBehavior": "Панель и API скрываются. Питомцы, записи ухода, дневник и события сохраняются и вернутся при включении.",
    "panelId": "pet-care",
    "defaultEnabled": true
  }
];

/** Основной ресурс модуля для реестра разрешений (`<module>.<resource>.<action>`). */
export const GENERATED_PRIMARY_RESOURCES: Record<(typeof GENERATED_MODULE_IDS)[number], string> = {
  "pet-care": "pet"
};

/** Имена миграций модуля в порядке применения (G11): манифест компонента и `GET system/components` сверяют их с базой. */
export const GENERATED_MODULE_MIGRATIONS: Record<(typeof GENERATED_MODULE_IDS)[number], readonly string[]> = {
  "pet-care": [
    "20261018120000_pet_care",
    "20261019150000_pet_care_wellbeing"
  ]
};

export * from "./pet-care";
