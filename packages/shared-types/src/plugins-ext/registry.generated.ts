// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из plugins-ext/*/plugin.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import type { OrionModuleId } from "../modules";

/** Идентификаторы плагинов, подключённых манифестом; ядро дописывает их в закрытый `z.enum` (plugins.ts). */
export const GENERATED_PLUGIN_IDS = [
  "agent-hub-task-assignment",
  "habits-insights"
] as const;

import type { ComponentMetadata } from "../component-manifest";
export const GENERATED_PLUGIN_METADATA: Record<string, ComponentMetadata> = {
  "agent-hub-task-assignment": {
    "version": "1.0.0"
  },
  "habits-insights": {
    "version": "1.0.0"
  }
};

/** Форма записи каталога (структурно совпадает с `PluginManifest`; тип задан здесь, чтобы не зациклить plugins.ts). */
export interface GeneratedPluginCatalogEntry {
  id: (typeof GENERATED_PLUGIN_IDS)[number];
  extendsModuleId: OrionModuleId;
  label: string;
  summary: string;
  provides: string[];
  disableBehavior: string;
  defaultEnabled: boolean;
}

/** Записи каталога плагинов; `PLUGIN_CATALOG` добавляет их к встроенным. */
export const GENERATED_PLUGIN_CATALOG: readonly GeneratedPluginCatalogEntry[] = [
  {
    "id": "agent-hub-task-assignment",
    "extendsModuleId": "agent-hub",
    "label": "Назначение задач ИИ-агентам",
    "summary": "Назначение существующего профиля ИИ-агента на задачу.",
    "provides": [
      "Действие назначения агента в меню задачи"
    ],
    "disableBehavior": "Действие скрывается при выключении плагина или Agent Hub; существующее назначение сохраняется.",
    "defaultEnabled": true
  },
  {
    "id": "habits-insights",
    "extendsModuleId": "habits",
    "label": "Аналитика привычек",
    "summary": "Неделя по каждой привычке и 12-недельная карта активности рядом с ежедневным списком.",
    "provides": [
      "Блок «Неделя» с листанием прошлых недель",
      "Блок «Активность» (12 недель)",
      "Отметка любого дня — включая дни вне расписания"
    ],
    "disableBehavior": "Блоки «Неделя» и «Активность» скрываются; отметки, серии и список «Сегодня» работают как прежде, данные не удаляются.",
    "defaultEnabled": true
  }
];

/** Поверхности плагинов (G17), если плагин их объявил; манифест компонента берёт их отсюда. */
export const GENERATED_PLUGIN_SURFACES: Record<string, readonly ("dock" | "side" | "widget" | "floating" | "window")[]> = {};
