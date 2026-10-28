// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.

/** Идентификаторы модулей, подключённых манифестом; ядро дописывает их в закрытый `z.enum` (modules.ts). */
export const GENERATED_MODULE_IDS = [
  "chat-archive",
  "pet-care"
] as const;

import type { ComponentMetadata } from "../component-manifest";
export const GENERATED_MODULE_METADATA: Record<string, ComponentMetadata> = {
  "chat-archive": {
    "version": "1.0.0"
  },
  "pet-care": {
    "version": "1.0.0"
  }
};

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
    "id": "chat-archive",
    "kind": "additional",
    "required": false,
    "label": "Архив чатов",
    "summary": "Разговоры с ИИ-агентами (Claude Code, Codex) в исходном виде: каждая строка транскрипта без изменений, чтение, поиск и выгрузка оригинала.",
    "owns": "Личный архив разговоров каждого участника: разговор (источник, id сессии, проект, заголовок) и строки его транскрипта — исходная строка и извлечённый текст.",
    "livesWithout": "Полностью самостоятелен: не требует и не использует другие предметные модули.",
    "provides": [
      "Панель «Архив чатов»: список разговоров, чтение, поиск, выгрузка оригинала",
      "Импорт транскрипта Claude Code или Codex файлом",
      "Автосохранение разговоров Claude Code хуком (chat-archive-push.mjs)",
      "Опциональный автосбор: периодическое сканирование локальных транскриптов Claude Code/Codex, явный тумблер на источник (ORION_MODE=local)",
      "Поиск и чтение прошлых разговоров для ИИ-агентов"
    ],
    "optionalDependencies": [],
    "disableBehavior": "Панель, API и инструменты агентов скрываются, хук получает отказ. Сохранённые разговоры остаются и вернутся при включении.",
    "panelId": "chat-archive",
    "defaultEnabled": true
  },
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
  "chat-archive": "conversation",
  "pet-care": "pet"
};

/** Имена миграций модуля в порядке применения (G11): манифест компонента и `GET system/components` сверяют их с базой. */
export const GENERATED_MODULE_MIGRATIONS: Record<(typeof GENERATED_MODULE_IDS)[number], readonly string[]> = {
  "chat-archive": [
    "20261020222504_chat_archive",
    "20261028120000_chat_archive_auto_source"
  ],
  "pet-care": [
    "20261018120000_pet_care",
    "20261019150000_pet_care_wellbeing",
    "20261020200000_pet_care_weight"
  ]
};

export * from "./chat-archive";
export * from "./pet-care";
