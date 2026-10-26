# Android alpha.28 — редакторы задач и заметок

Статус: HISTORICAL, 26.10.2026. Базовый HEAD 9cfe5a9; точная ревизия
привязана к private GitHub release. Текущие факты — [STATUS](../STATUS.md),
направление — [PLATFORM](../PLATFORM.md). Продолжение ограниченного UI/UX-среза.

## Что изменено

- Заметки используют существующее форматирование задач: жирный, курсив,
  заголовок, список и цитата. Выделение сохраняется после команды, повторное
  действие снимает формат. Исходный Markdown не заменяется HTML.
- Группа команд доступна обычным Tab; роль toolbar без реализации arrow navigation
  заменена на group. Размеры кнопок не меньше 48px.
- Команда, результат которой длиннее 20 000 символов, отклоняется целиком:
  исходный текст не обрезается и не переписывается. Снять формат на пределе можно.
  Счётчик связан с textarea и располагается сразу после неё.
- EditorFeedback показывает состояние черновика в начале редактора. Только
  ошибка получает focus/scroll в видимую область; успешные фоновые записи не
  уводят курсор. Ошибки валидации и хранилища используют тот же путь.
- На ширине до 380px сохранение занимает отдельную строку шапки: при font200
  заголовок больше не разбивается на слоги. Иконка Back и native Back сохранены.
- STATUS alpha.27 был по ошибке вставлен внутрь старого HTML comment; запись
  перенесена в видимую часть под главным заголовком.

Ни схемы хранения, ни shared contracts, ни LAN/синхронизация, ни desktop UI
не менялись. Финансы остаются phone-local.

## Проверки

- 99 Android/mobile-core unit tests,11 registry contracts,11 JVM tests PASS.
- Android typecheck/Vite production build/Capacitor sync PASS.
- Scoped ESLint, architecture-check, module-docs:check, platform-map:check PASS.
- android-editor-recovery-smoke PASS: частичное выделение и toggle, список/
  Markdown preview, черновик после reload, отказ форматирования без обрезки,
  снятие разметки при предельной длине, focus/видимость ошибки, invalid tags/
  retry/save/reopen. Изолированные синтетические данные.
- android-entry-fields-smoke PASS: даты/статус, теги/summary/pin, валидация,
  synthetic disk full/retry и сохранение текста.
- android-task-creation-smoke PASS: staged checklist, extraction, formatting,
  narrow reflow и long-press selection lock.
- Общий WebView UI просмотрен в Chromium dark/light на 412 и 320px; 900px и
  font200 проверены сценариями. Найденная шапка с переносом по слогам исправлена;
  финальный narrow screenshot подтверждён. Mechanical detector [] до локальной
  правки шапки; финальный typecheck/build/smoke пройдены.
- assembleDebug / assembleRelease / lintDebug / testDebugUnitTest PASS.
  Vite сохраняет warning о chunk >500kB; это не блокирует сборку, code splitting
  в этот срез не включался.

Физическая OPPO-приёмка alpha.28 НЕ выполнялась; телефон/живые записи не трогались.
Browser не подтверждает ColorOS keyboard/selection handles/TalkBack/font scale,
native SQLite и LAN. На OPPO следующий smoke: выделить часть заметки и нажать
форматирование с открытой клавиатурой; вернуться/восстановить черновик; проверить
читабельность шапки и доступность ошибки сохранения на крупном системном шрифте.

## APK

0.1.27 / alpha.28 / code28, io.kaiden.orion.android. 4423946 байт.
SHA-256: `a18895f45b3ae3cd2b12a12d740c12d71082961058c3646eb24fe4b9b25ff720`.
Signer SHA-256: `5154216cb718e2d66a6811ce8168fd571ecfcacd7c15fd6e39d2e0ad29023b39`.
Release helper подтвердил code27→28, прежний package/signer, UI/native consistency,
size/hash. Публикуется debug-signed test APK; release variant unsigned.
[Публичный релиз](https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.27-android-alpha.28).

Файлы: app/App.tsx, features/editor-feedback.tsx, presentation.css, Android version
files, scripts/android-editor-recovery-smoke.mjs, STATUS и этот отчёт.
