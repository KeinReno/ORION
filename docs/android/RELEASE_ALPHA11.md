# Android alpha.11 — согласованные объёмные карточки

21.10.2026; 0.1.10 / code 11. Устройство приёмки: OPPO Reno8 5G.

## Причина и модель
В alpha.10 смешивались независимые transforms: text-only rotation, finance
summary и обратное XY-смещение preview background. Это давало разнобой.
Референс владельца: https://ui.aceternity.com/components/3d-card-effect
Прочитан официальный source https://ui.aceternity.com/registry/3d-card.json:
perspective → общий rotate контейнера → translateZ дочерних слоёв.
Принцип адаптирован к native sensor вместо mouse. Пакет не добавлялся,
исходный компонент не копировался. Изменения ограничены Android surface.

DepthCard задаёт общую rotation matrix для всей карточки. Содержимое только
приподнимается по положительной Z: до 48px, preview foreground до 96px.
Нет обратного XY-смещения. Сила 0..100%, default 60; максимум 12°.
ResizeObserver увеличивает camera distance длинной формы: max(1000px, height*8).
Это уменьшает перспективное выпирание на соседний блок, без layout animation.

Покрытие: brand, heading, search, empty state, task/note rows, editor, finance
context/form/history heading/summary/transactions, settings и connection sections.
Записи получили рамку и фон, чтобы текст и действия воспринимались единым объектом.
Fixed bottom navigation и quick-actions overlay остаются вне 3D-контейнеров.

## Взаимодействия
При pointerdown useDepth сохраняет фактические computed matrices card-body inline
и ставит data-depth=paused. Карточка замирает под пальцем, samples игнорируются.
После отпускания resume delay 200ms; baseline определяет native start как прежде.
Input/background/reduced-motion/off очищают matrices, CSS vars и Z.
Прозрачные контейнеры не перехватывают pointer events; кнопки, поля, labels,
summary и ссылки остаются интерактивными. Native sensor и domain data не менялись.

## Проверки
- Workspace typecheck PASS; workspace lint 0 errors / 29 existing warnings.
- Финальный Android build/typecheck/scoped ESLint PASS.
- Mobile-core 34 tests, plugin contracts 11 tests, architecture/module-docs PASS.
- Все 9 mobile browser scripts PASS: CRUD/offline/finance/themes/updates/
  dictation/gestures/visual/hold и depth. Depth bridge synthetic, не hardware.
- Depth regression: shared rotation matrix, positive-Z preview без inverse XY,
  frozen bbox во время contact, открытие редактора при максимальном tilt,
  strength persistence, input/background/reduced motion, unavailable/error/silence.
- assembleDebug / assembleRelease / lintDebug / testDebugUnitTest PASS.
- Visual pass обнаружил перекрытие заголовка длинной формой; adaptive perspective
  и восстановление section spacing проверены контрольным снимком.
- Vite bundle warning сохраняется. Physical FPS/ColorOS не измерены.

## Поставка и приёмка
Публикуется debug APK с прежним сертификатом и code 11; unsigned release variant
не распространяется для установки. Источники остаются private ORION/PR62.
Нет подключённого OPPO/ADB: физический знак осей и ощущение требуют приёмки.
Проверить силу 60–100%, четыре направления наклона, записи, финансы, настройки,
нажатия и drag, ввод, background/resume и OS reduced motion. Карточка и содержимое
должны наклоняться вместе, навигация и меню остаются на месте.

## Файлы
apps/android/src/depth-card.tsx, main.tsx, task-list.tsx, finance.tsx, settings.tsx,
connection.tsx, presentation.css, use-depth.ts, updates.ts; apps/android/package.json;
apps/android/android/app/build.gradle; scripts/android-depth-smoke.mjs;
scripts/android-settings-smoke.mjs; docs/android/README.md и этот отчёт.
Desktop не редактировался.
