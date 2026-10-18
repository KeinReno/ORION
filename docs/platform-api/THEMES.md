# Theme API (G18)

## Как сейчас (v1.0, зафиксировано)

- **Документ темы.** `themeDocumentSchema`, `schemaVersion: 1` (`packages/shared-types/src/theme-document.ts`): `id`, `name`,
  `baseMode` (`dark|light`) и ровно 18 hex-токенов `colors`: `canvas, surface, elevated, hover, textPrimary, textSecondary,
  textSubtle, border, borderStrong, accent, accentHover, accentForeground, focus, success, warning, danger, info, tint`
  (`.strict()` — лишние ключи отвергаются).
- **Пресеты:** `THEME_PRESET_IDS` (6: `kaiden-precision, obsidian, midnight, emerald, crimson, arctic`), `DEFAULT_THEME_ID`.
- **Библиотека тем пользователя:** `THEME_LIBRARY_MAX = 24`, `UserPreference.themeLibrary` / `activeThemeId` /
  `workspaceThemeMode` (`follow|personal`); запись только `PUT/DELETE settings/themes/:id` под блокировкой строки (CLAUDE.md);
  конфликт ревизий — `themeRevisionConflictSchema`.
- **Тема пространства:** `Workspace.theme`, меняет только владелец (`PUT workspaces/:id/theme`, `WorkspacesService.setTheme`).
- **Какая палитра видна:** только `resolveApplicationTheme` (`apps/web/lib/effective-application-theme.ts`): пространство → своя → Precision.
- **Применение:** `packages/ui/src/theme-engine.ts`, `theme-provider.tsx`, `design-tokens.ts`, `theme.css`; переменные на `<html>`.
- **Тесты:** `theme-engine.test.ts`, `design-tokens.test.ts`, `apps/web/lib/theme-*.test.ts`, `custom-theme.integration.test.ts`.

## Контракт v1.0 как есть

Для плагинов гарантия — «использовать токены дизайн-системы, а не жёсткие цвета» (правило, не проверка). Набор
гарантированных токенов равен 18 ключам `colors`; он не вынесен в отдельный версионируемый список.

## Целевое состояние

Версия Theme API отдельно от `schemaVersion`; перечень токенов — часть контракта (добавление — MINOR, удаление или
переименование — MAJOR, см. [README](README.md)); автоматическая проверка «в `apps/web/plugins` нет hex/rgb и не-токенных
цветов»; визуальный прогон каждого плагина по 6 пресетам и пользовательской теме.

## Не сделано

Проверка жёстких цветов в плагинах (в `scripts/architecture-check.mjs` её нет — G18); перевод части экранов и плагинов на
токены (`docs/STATUS.md`, волна 2.4); версия Theme API как отдельная величина.
