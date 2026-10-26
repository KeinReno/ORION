# Android alpha.8 — KAIDEN finish и движение

21.10.2026; 0.1.7 / versionCode 8. Устройство приёмки OPPO Reno8 5G.
Поручение: повторно пройти визуал, добавить стиль/эффекты/анимации.

## Изменения
Мобильный presentation.css поверх существующей shared KAIDEN theme palette:
бренд-панель, заголовки, поверхности форм/кнопок, selected navigation, финансовые
суммы и границы итогов. Чекбокс использует компактный desktop силуэт внутри
прежней ≥48px touch area. Цвета берутся из @orion/ui/theme; новой палитры нет.
При фокусе input/textarea/select FAB скрывается, чтобы не перекрывать ввод.

Motion thesis: орбитальное меню — главный акцент; остальное короткий feedback.
- Press light в точке касания через CSS pseudo-element; без pointermove render loop.
- Смена экрана после pointer — 160ms/6px fade-through; draft input не перезапускает её.
- Галочка завершения — конечная 180ms stroke sequence.
- Меню — veil 90ms, glyph 160ms, orbit 260ms. Hit targets не двигаются.
- Drag: цвет поднятой строки/места вставки; исходная reorder logic не меняется.
Постоянно работающих анимаций/шейдеров нет; внешние библиотеки движения не добавлены.

useVisualMotion различает pointer/keyboard: клавиатурные переходы без анимации.
prefers-reduced-motion учитывается и при изменении; активные animations отменяются.
OrionMotionPlugin читает ValueAnimator.areAnimatorsEnabled (API26+) / animator scale
(API24/25) и transition scale. Никаких настроек не записывает и permissions не добавляет.
На native до успешного чтения/при ошибке чтения effects выключены; App resume
обновляет системную preference. CSS поддерживает reduced mode самостоятельно.

## Проверка
- Workspace typecheck PASS; общий ESLint 0 errors / 29 warnings; финальный scoped lint PASS.
- Architecture/module-docs PASS; plugin-contract 11 tests PASS.
- Mobile-core 33 tests PASS. Domain/shared schema/API/desktop не менялись.
- Все 7 mobile browser scripts PASS: tasks/notes, settings/updater, finance, speech
  (mock native), themes, gestures/date, новый visual smoke.
- Visual smoke: press feedback, неизменные menu rectangles во время animation,
  заполненные/пустые состояния, themes, 320px/font130, reduced motion=0 running
  animations и keyboard route без движения. Это Chromium WebView surface evidence.
- Render QA: 412px Precision tasks/menu/finance/settings; 320px Arctic/font130.
  Один пакет исправлений: FAB при фокусе в поле и компактный checkbox с прежней hit area.
  Mechanical design detector changed presentation/menu: no findings.
- assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS; 9 прежних JVM tests.
  Android lint: 0 errors / 31 warnings. Speech/motion instrumented tests отсутствуют.
- Bundle ~539 KB minified / ~147 KB gzip; существующее Vite size warning сохраняется.
- Новый full workspace unit/DB integration/desktop packaging не запускались:
  изменения визуального слоя покрыты focused tests и всеми mobile flows.
- Физический OPPO/emulator не подключён. FPS/refresh rate, Remove animations,
  ColorOS/system bars/IME и TalkBack — NOT RUN на устройстве. Browser не заменяет
  Android screen capture и hardware performance acceptance.
- GitHub CI ранее блокировалась billing policy; результаты здесь локальные.

## APK
Подписанный debug APK, прежний test key; apksigner/package/signature/code7→8 PASS.
4 312 748 bytes, SHA-256:
`029211f1ac1df4bb981322a3f88d24d40e025c3b8f901ad40ffa462e4c2c3f1f`.
https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.7-android-alpha.8
Публично — только APK, checksum/manifest и описание, исходники приватны.

## Приёмка
Обновить поверх alpha.7; пройти задачи/финансы/темы, открыть «+» и hold menu,
завершить задачу и переставить её. Проверить ручной ввод с открытой клавиатурой.
В системных настройках отключить анимации, вернуться в Orion — эффекты должны
исчезнуть; вернуть анимации и проверить снова. Темы/данные должны сохраниться.
