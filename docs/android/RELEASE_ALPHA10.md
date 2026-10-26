# Android alpha.10 — настраиваемая глубина и проверка датчика

21.10.2026; 0.1.9 / code 10. Устройство приёмки: OPPO Reno8 5G.

## Что имел в виду владелец
Физический наклон телефона должен создавать ощущение объёма: интерфейсные слои
поворачиваются и смещаются относительно друг друга. Это sensor-driven parallax,
а не анимация при перелистывании. Сила теперь настраивается в Appearance.

## Найденные причины
Alpha.9 ограничивала эффект 2.5px/3° и применяла его к logo/empty/finance summary.
Основные записи оставались плоскими. Кроме того, фокус checkbox считался вводом:
после включения depth переключатель мог удерживать эффект на паузе. Исключены
checkbox/radio/range; настоящий ввод, касание, фон и reduced motion сохраняют паузу.
Native deadband отбрасывал неподвижные samples: нельзя было отличить рабочий
датчик от отсутствия данных. Теперь valid samples отправляются и в покое, ≤20Hz.
Это найденные code paths, не утверждение о воспроизведении на физическом OPPO.

## Изменения
- Additive MobileSettings.depthStrength, integer 0..100, default 60; старые данные,
  заметки, outbox и настройка depthEffects сохраняются. Slider сохраняется после
  отпускания/клавиши/ухода фокуса, без записи snapshot на каждом движении пальца.
- Предел 100%: 14 CSS px/12°. Default: 8.4px/7.2°. Заголовки/описания записей
  используют 45% смещения, decor/preview foreground — полное, background — обратное.
- Hit rectangles кнопок, navigation, quick actions, drag controls остаются плоскими.
- В настройках есть двухслойный preview и состояние: ожидание, получены реальные
  native samples, недоступен, ошибка, нет данных 2.5s, пауза и reduced motion.
  Сообщение о работе появляется после sample, не только после успешного start().
- Сила обновляется через ref без перезапуска native subscription. После touch
  baseline заново определяется native start. Нет хранения/отправки samples,
  permissions, wake locks и новой зависимости. Desktop код не изменён.

## Проверки
- Workspace typecheck PASS; scoped ESLint PASS.
- Mobile-core: 34 tests PASS, включая legacy defaults и invalid strength.
- Architecture / module-docs PASS; plugin contracts 11 tests PASS.
- Все 9 mobile browser scripts PASS. Новый depth regression: 0/60/100%, persistence,
  stable hit target, touch/input/background/reduced-motion, checkbox focus,
  unavailable/start failure/silent sensor и восстановление sample. Мост синтетический.
- После последней правки input gate заново прошли depth regression и Android build.
- assembleDebug / assembleRelease / lintDebug / testDebugUnitTest PASS.
  Release variant unsigned; распространяется debug APK с прежней тестовой подписью.
- Browser screenshot проверен, включая контрольную карточку и длинные пояснения.
  Предупреждение Vite о размере bundle сохраняется.

## Ограничения и приёмка
ADB/реального OPPO нет: знак направления, чувствительность native sensor и ColorOS
ещё не приняты на устройстве. Android с выключенными системными анимациями оставляет
плоский UI; состояние явно объясняет причину. Browser mock не доказывает работу железа.
Держать телефон удобно, включить depth, выставить 60–100%, отпустить экран, плавно
наклонить. Сообщение должно смениться на «Датчик работает», два preview слоя должны
двигаться по-разному. Затем проверить задачи/заметки, pause при вводе, возврат из фона
и сохранение силы после перезапуска. При проблеме сообщить показанное состояние.

## Файлы
apps/android/src/{use-depth.ts,settings.tsx,main.tsx,presentation.css,updates.ts};
apps/android/package.json; apps/android/android/app/build.gradle;
apps/android/android/app/src/main/java/io/kaiden/orion/android/OrionDepthPlugin.java;
packages/mobile-core/src/{index.ts,android-updates.test.ts};
scripts/{android-depth-smoke.mjs,android-settings-smoke.mjs}; docs/android/README.md
и этот отчёт. Доменные контракты и desktop не менялись.
