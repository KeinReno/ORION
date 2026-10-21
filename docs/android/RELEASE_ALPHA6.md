# Android alpha.6 — системная диктовка

21.10.2026; 0.1.5 / versionCode 6. Устройство: OPPO Reno8 5G.
Основание: собственная кнопка вызывает Android-транскрибацию без клавиатуры.

## Реализация
Кнопка «Надиктовать» в редакторах задач/заметок. Перед запуском исходный draft
фиксируется через существующий repository; ошибка диска не запускает диктовку.
Автофокус текстового поля снят, фокус редактора остаётся на заголовке.

OrionSpeechPlugin делегирует запись и UI установленной Android activity через
RecognizerIntent.ACTION_RECOGNIZE_SPEECH, ru-RU/free-form, один финальный результат.
Клавиатуру/службу IME напрямую не вызывает. RECORD_AUDIO приложению не добавлен:
звуком и соответствующими разрешениями управляет вызываемый системный сервис.
ActivityNotFound, отмена, пустой ответ и ошибка запуска обрабатываются явно.
EXTRA_PREFER_OFFLINE — лишь подсказка; сервис может её игнорировать и использовать сеть.
Нет cloud API Orion, фонового прослушивания, непрерывной записи или аудиофайла.

Результат сохраняется отдельно в приватных preferences до добавления/отмены.
После возврата человек выбирает «Добавить в название»/«Добавить в текст»;
существующий текст дополняется, а не заменяется. Превышение 200/20 000 символов
не обрезает результат: его можно скопировать из readonly поля в другую запись.
Если preferences не записались, результат остаётся в UI с явным предупреждением.
При возврате в редактор незавершённый результат перечитывается. Pending transcript
не входит в JSON backup, пока его явно не добавили в draft.

Сначала сохраняется draft, потом подтверждается потребление native result.
lastDictationId переживает restart и предотвращает повтор вставки при неудачном ack.
Marker — только метаданные draft; shared Task/Note/SyncOp не расширены.
Работает и с remote draft через прежний scoped repository; отправка на ПК требует
существующего явного сохранения/синхронизации. Desktop/API не менялись.

## Проверки
- Workspace typecheck PASS; общий ESLint PASS, 0 errors / 29 warnings.
- 30 mobile-core tests PASS, из них 3 новых — append/idempotence/limits/restart/disk rollback.
- Architecture, module-docs, plugin-contract (11 tests) PASS.
- Browser задачи/заметки, settings/updater, финансы и темы PASS.
- Новый browser synthetic-native speech smoke PASS: result, сохранение исходного
  текста, ack failure/retry без дубля, cancel/error, pending после reload, title/body,
  сохранение записи и 320px. Это mocked bridge, не реальное распознавание.
- Android assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS; 9 JVM tests
  прежних TLS/update policy. Отдельного speech instrumented test нет.
- APK подписан тем же тестовым debug key; apksigner/package/version compatibility PASS,
  code 5→6. Размер 4 305 622 bytes, SHA-256:
  `3bef9f5c577d151bb595d3e52e832c63e28d4389cd41c0b1e73695ed715b5108`.

## Ограничения и приёмка
Сервис/интерфейс распознавания зависит от установленного Android provider. Русская
офлайн-модель, разрешения provider, шум, process death/ColorOS во время внешней
activity, TalkBack/keyboard на реальном OPPO — NOT RUN. Восстановление pending
возможно после полученного callback; получение результата после убийства процесса
ОС не гарантируется без физической проверки. Исходный draft сохранён заранее.
Полный workspace unit run/DB integration/desktop packaging не запускались;
проверки сфокусированы на изменённых input/draft boundaries и регрессии mobile flows.
GitHub CI ранее блокировалась billing policy; результаты выше локальные.

Ручная приёмка: обновить без удаления → Заметки/Создать → Надиктовать → говорить →
Добавить в название/текст → проверить → сохранить. Проверить отмену, повтор,
отсутствие сети и возврат после переключения приложения. Проверить так же задачу.
Release: https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.5-android-alpha.6

## Не забыть следующий срез
Владелец отдельно напомнил про «холо» и drag-and-drop. Оба остаются явными задачами:
1. Доступное меню создания + веер удержания (нейтральная зона, release/cancel,
   подписи, обычные кнопки/TalkBack, исключение случайных destructive действий).
2. Перетаскивание задач за отдельный handle после проверки persisted sortOrder;
   жест не перехватывает scroll и не конкурирует с меню удержания.
Подробности: DESIGN_AND_CAPTURE.md. В alpha.6 эти жесты не заявлены как реализованные.
