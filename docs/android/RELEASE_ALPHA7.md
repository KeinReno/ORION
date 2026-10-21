# Android alpha.7 — быстрые действия, порядок задач, актуальная дата

21.10.2026; версия 0.1.6 / code 7. Целевое устройство OPPO Reno8 5G.

## Реализовано
QuickActions — типизированная мобильная поверхность действий создания.
Удержание 420ms в пустом месте главного shell открывает меню вокруг центра;
сдвиг >10px до истечения задержки отменяет hold и оставляет прокрутку.
После удержания: выделение под пальцем, отпускание над пунктом запускает его;
отпускание без выбора/pointercancel/потеря capture/blur отменяют меню.
Touchmove блокируется только после активации; поля/кнопки/текст/строки задач
не запускают фоновое удержание. Жесты внутри редактора не перехватываются.
Видимая «+» открывает те же 4 кнопки: задача, заметка, расход, доход.
Фокус внутри dialog; Tab/Escape, обычное касание и native Back доступны.
Модульные ограничения remote tasks/notes учитываются. Никаких destructive пунктов.
Незавершённый draft открывается вместо его тихой замены; финансовый ввод
с неподтверждённой записью блокирует новые quick actions.

TaskList: отдельный touch-action:none handle, threshold 8px, pointer capture,
подсветка места вставки до/после строки, drop commit; cancel/outside не меняет порядок.
Обычная строка остаётся прокручиваемой. Нажатие handle показывает «Выше»/«Ниже».
Завершённые задачи остаются отдельной группой; поиск/сохранение блокируют reorder.
Порядок — presentation metadata snapshot.taskOrder[phone|remoteScopeHash],
а не изменение Task/SyncOp. Не отправляется на ПК. Logout/revoke удаляет remote
order keys вместе с remote cache, сохраняя phone order. Настройка порядка не
входит в portable JSON backup (экспорт предметных записей не менялся).

FinanceDraft.dateMode: today/custom. Новая операция в today; дата обновляется
на полуночи, по focus/visibility/native appStateChange, и повторно вычисляется
в repository при сохранении. Периодическая сверка учитывает смену системного
времени/часового пояса. Ручной выбор и редактирование операции используют custom;
«Сегодня» возвращает автоматический режим. Новый ввод после сохранения снова today.
Месяц журнала следует текущему месяцу, пока пользователь не выбрал другой.
Старые draft без dateMode читаются как custom, чтобы не менять выбранную ранее дату;
для них доступна кнопка «Сегодня». Persisted операции не переписываются.

## Проверки
Workspace typecheck PASS; общий lint 0 errors/29 warnings; финальный scoped lint PASS.
Architecture, module-docs, plugin-contract (11 tests) PASS.
33 mobile-core tests PASS, включая 3 новых: scoped durable order/rollback,
неизменность domain/outbox, automatic date на save после полуночи, custom и legacy draft.
Все 6 mobile smoke PASS: tasks/notes, settings, finance, speech (mock native), themes,
new gestures/date. Новый smoke включает Chromium CDP touch hold→slide→release,
threshold прокрутки, сохранность черновика, mouse pointer reorder/restart/buttons,
quick income, fake-clock midnight/custom/Today, 320px и Escape. Это браузерная
эмуляция, а не физический OPPO. Mechanical design detector changed UI: no findings.
Android assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS; 9 прежних JVM tests.
Android lint 0 errors / 31 warnings. Full unit suite/DB integration/desktop installer
не запускались: scoped tests и все мобильные regression flows. CI billing ранее блокировал запуск.

APK signed debug, прежний test key, apksigner/package/signature/code6→7 PASS.
4 309 680 bytes; SHA-256:
`aceaac252094c7fed1af0ddaa6b3f9fea0a4941687ed4dd9d93b093b56d50a27`.
Release: https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.6-android-alpha.7
Desktop/API/schema sync не менялись. Вся работа в изолированной Android-ветке.

## OPPO acceptance
Обновить поверх alpha.6; удерживать пустой фон → навести/отпустить → создать запись.
Проверить прокрутку, отмену в центре/Back и «+» без удержания. За handle переставить
задачи, закрыть/открыть приложение. Смена суток/возврат из background с today,
ручная дата, «Сегодня», новая операция и редактирование старой.
Реальные gestures/TalkBack/ColorOS, native speech и физическое обновление NOT RUN.
Порядок заметок, синхронизация task view order и OCR в alpha.7 отсутствуют.

## Будущий ввод из изображений
Поручение владельца зафиксировано как future scope, без добавления разрешений/загрузки файлов.
Фото чека или выбор скриншота → распознавание → finance draft → проверка/сохранение.
Сумма/валюта/дата/вид (расход, доход, перевод)/счёт/категория показываются явно;
неуверенные поля выделяются, итог не создаётся молча. Один чек не равен автоматически
одной операции: возвраты, переводы, дубли и несколько сумм требуют проверки.
Дедуп по hash/идентичности документа + атомарный idempotent commit. Offline failure
сохраняет исходник/черновик. Cloud OCR требует явного выбора пользователя; без
скрытой отправки банковских скриншотов. Будущий adapter использует public finance
input contracts и optional capability; для нового capture contribution сначала
Extension Proposal (NEW_EXTENSION_POINT_REQUIRED), без зависимостей Core на OCR vendor.
Выбор OCR engine, attachments/backup/privacy и приёмка русских чеков — отдельный срез.
