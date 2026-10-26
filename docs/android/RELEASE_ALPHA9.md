# Android alpha.9 — устойчивое удержание, глубина и компоновка

21.10.2026; 0.1.8 / code 9. Целевое устройство: OPPO Reno8 5G.

## Quick actions: дефект и изменение поведения
Владелец сообщил: первое удержание иногда сразу закрывает меню.
В alpha.8 host слушал lostpointercapture без проверки event.target. Android
implicit capture на дочернем элементе при передаче host создаёт всплывающее
lostpointercapture; оно ошибочно трактовалось как отмена active gesture.
Native воспроизведение на OPPO отсутствует: это выявленный code path, проверенный
детерминированной browser regression, а не доказательство единственной причины на устройстве.

Alpha.9 игнорирует descendant capture loss. Реальные pointercancel/потеря host
capture после раскрытия оставляют меню в tappable mode; движение до hold threshold
по-прежнему отменяет long press и не мешает scroll. Пока палец удерживается,
программный фокус не переводится на пункт. Синтетический click после отпускания
подавляется, но новый deliberate pointerdown снимает suppression: второй тап не нужен.

Продуктовое решение: hold/release без выбора оставляет меню открытым. Выбор
slide/release запускает пункт, движение без выбора отменяет; «×», Escape/native Back,
тап снаружи/реальный уход окна закрывают меню. Не включать обратно старое правило
«любой lost capture/нейтральное отпускание = close». Rule/cover-reachable-states.

## Depth
Read-only host adapter OrionDepthPlugin: gravity, fallback accelerometer; baseline
при старте/смене ориентации экрана, низкочастотная фильтрация, ≤20 events/sec,
deadband и finite/clamp guard. Нет permissions, wake locks, логов samples или отправки.
handleOnPause/Destroy снимают listener. После resume start калибруется заново.
Платформенное основание:
https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview

useDepth использует serial start/stop, одну native подписку и rAF только при новом sample.
CSS пределы 3°/2.5px. Двигаются только logo/empty illustration/readonly finance totals;
кнопки/поля/меню/drag hit boxes не меняют положение. Touch/input/background/reduced
motion выключают sensor и сбрасывают transforms. Без датчика — flat fallback.
MobileSettings.depthEffects default true, переключатель в appearance; additive
чтение старых settings сохраняет domain data/outbox. Браузер сам sensors не запрашивает.

## Компоновка
Финансы: сумма до type selector, компактная строка контекста phone/RUB, read-only
summary layers. Задачи: счётчики и записи выше, инструкция drag после списка.
Public finance/task DTO и server sync не менялись; desktop не редактировался.

## Проверки
- Workspace typecheck PASS; ESLint 0 errors/29 warnings; финальный scoped lint PASS.
- Mobile-core 33 tests PASS, включая migration/default preferences.
- Architecture/module-docs PASS; plugin-contract 11 tests PASS.
- Все 9 browser mobile scripts PASS (7 прежних + hold regression + depth mock).
- Hold regression: 8 CDP touch holds, bubbled lost capture, active cancel, release
  latch, первый deliberate tap; slide selection проверяется existing gesture script.
- Depth mock: bounded samples, неизменный button rectangle, pause/resume/input/touch,
  reduced motion и persisted выключатель. Это synthetic native bridge, не датчик OPPO.
- Render QA: 412px dark tasks/finance/menu, existing 320px/light/font130 smoke;
  mechanical detector changed UI: no findings. Это Chromium surface screenshots.
- Android assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS;
  9 прежних JVM tests; lint 0 errors/31 warnings. Финальные assemblies после web sync PASS.
- Физические OPPO gestures/sensors, FPS/battery/ColorOS/system bars/TalkBack NOT RUN.
  Восемь browser повторов не заменяют cold-start stress на телефоне.
- Full workspace unit/DB integration/desktop installer не запускались; scoped unit
  и все mobile flows выше. GitHub CI ранее блокировалась billing policy.

## APK
Signed debug, прежний test key; apksigner/package/signature/code8→9 PASS.
4 317 348 bytes; SHA-256:
`5d7c0aaa7a4b3c0c87a99baba6f2e72c10d2e99e007be88511eea07f9ae1ad18`.
https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.8-android-alpha.9

## Приёмка владельцем
Обновить без удаления. На холодном старте повторить 10–20 удержаний в разных пустых
областях; проверить hold/release, slide/release, первый тап, scroll и Back.
Проверить depth с включёнными системными анимациями: наклонить относительно исходного
положения, коснуться/ввести текст, свернуть/вернуть, отключить switch и системные animations.
Отдельно проверить landscape baseline. Если сброс остаётся, следующий шаг — локальная
диагностика порядка gesture events без текста заметок/финансов/идентификаторов пользователя.
