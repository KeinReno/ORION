# Android alpha.5 — общие темы KAIDEN

21.10.2026. 0.1.4 / versionCode 5.

## Реализовано
Android импортирует public theme-only entry @orion/ui/theme, который реэкспортирует
существующие theme-engine/design-tokens. Палитры не скопированы и не поддерживаются
вторым набором CSS. Текущий theme-engine.ts совпадает по SHA-256 с рабочей desktop-копией.
Desktop entry, темы, компоненты и сохранённые данные не менялись.
Новый leaf entry избегает загрузки desktop shell/document viewers/scene effects на телефон.

Android связывает CSS-роли с --kaiden-*; Precision/Obsidian/Midnight/Emerald/Crimson
выбираются как тёмные палитры, светлый режим использует Arctic. System реагирует на
matchMedia change. darkTheme добавляется с default kaiden-precision; прежние
mode/update preferences, задачи, заметки, финансы и очереди сохраняются.
Общие радиусы 6/8px, иерархия заголовков, цвета навигации/форм/кнопок; касания ≥48px.
Это первый этап визуального единства, не полная приёмка экранов desktop/mobile.
Автоматической синхронизации personal/workspace theme нет.

Проект жестов и голосового capture: [DESIGN_AND_CAPTURE.md](DESIGN_AND_CAPTURE.md).
Drag/drop, marking menu, microphone/recognition НЕ реализованы в alpha.5.

## Проверки
- Workspace typecheck PASS.
- Scoped ESLint и общий lint PASS (0 ошибок / 29 предупреждений).
- 92 focused tests PASS (mobile-core, shared theme-engine и design-tokens),
  plugin-contract 11 tests PASS; architecture/module-docs PASS.
- Browser tasks/notes, settings/updater, finance, themes smoke PASS.
  Темы: все 5 dark presets, точные RGB shared fixtures, restart, system change,
  Arctic, 320px/font130 и отсутствие page errors/горизонтального overflow.
- Render inspection: Precision tasks 412px и Arctic finance 320px/font130.
- assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS, 9 JVM tests.
- Финальный web bundle ~520 KB minified / ~142 KB gzip, прежний Vite size warning.
- APK signed debug, package/signature проверены относительно alpha.4, code 4→5.
  4 301 296 bytes; SHA-256:
  `2e7e52fdf5d1995d72671e60b53621e2ffe514fd0aa7269b70d2ee7e6ccba603`.
- Новый полный unit run не запускался: фокус на changed theme/preferences boundaries
  и существующих domain smoke. DB integration/desktop installer не запускались.
- OPPO/native keyboard/TalkBack/system bars/ColorOS и физическое обновление NOT RUN.
  GitHub Actions ранее не стартовали из-за billing policy; результаты здесь локальные.

## Публикация
https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.4-android-alpha.5
Public repo содержит только binaries, checksums, manifest и описания.
Встроенный feed обновляется после проверки опубликованного APK; CDN может кэшировать старую версию.

## Следующая работа
Меню создания с доступными кнопками и удержанием; затем отдельный надёжный native
аудиозахват/вложения/backup, после него транскрибация. Drag/drop — после определения
persisted порядка, без конфликта с прокруткой и меню удержания.
