# Мобильные поверхности модулей

Статус **PROPOSED**, 21.10.2026. Источники: packages/shared-types/src/modules.ts,
modules-ext/registry.generated.ts и нормативная AI_REFACTOR_MIGRATION_MAP.
Наличие модуля в desktop catalog не означает готовность Android API/offline.
Связанные документы: [архитектура](FRONTEND_ARCHITECTURE.md), [настройки](SETTINGS_SPEC.md).

## 1. Общий шаблон — одинаковый язык, разные рабочие поверхности

Brief: один пользователь или команда хотят выполнить основное действие модуля
с телефона и продолжить на ПК. Нужны чтение, создание, изменение, завершение/
архивирование/удаление по реальным правам, а не набор статичных карточек.
Последствие: mobile UI меняется, domain ownership и DTO не перепридумываются.
Успех: основной сценарий доступен без жестов и проходит весь жизненный цикл.

Шаблон: scope → title + одно primary action → фильтры/query → содержимое →
detail/editor → menu вторичных действий. Длинный редактор — отдельная страница,
короткий picker — sheet/inline; разрушительное подтверждение называет объект.
Phone показывает list или detail, wide может показывать list-detail. Не переносить
desktop Dockview, таблицу из 30 столбцов или Гант в уменьшенную телефонную рамку.
rule/one-primary-action, rule/structure-before-containers, rule/inline-before-modal,
rule/navigation-vs-action, rule/keyboard-complete-flow.

Карточка всегда имеет явное главное действие и доступное меню. Создание без edit,
delete/archive/status/recovery не считается завершённым базовым срезом.
Delete semantics берутся из domain API: отсутствие mobile корзины не даёт права
называть необратимое удаление перемещением в корзину. Нет честного undo — не показывать.
Безусловное удаление на long press запрещено. Offline command сохраняется durable
до success. rule/name-object-scope-consequence, rule/destructive-proportional,
rule/preserve-user-input, rule/cover-reachable-states.

## 2. Каталог целевых экранов

В последнем столбце указаны требования к будущему адаптеру, не готовые возможности.

| ID / модуль | Первый полезный мобильный экран и действие | Detail и настройки | Данные / ограничение |
|---|---|---|---|
| tasks / Задачи | Список с Сегодня/Открытые/Завершённые; создать | Полная страница title/body/priority, доступные status/deadline/assignee по контракту; явные edit/delete; local view/order отдельно от общих workflows | Сейчас phone + task replica, ввод title/body/priority и done; остальные поля отдельным проверенным срезом |
| notes / Заметки | Список с clean excerpt, поиском и архивом | Editor сохраняет Markdown без потерь; edit/archive/delete, позднее links/history через SDK; display defaults в settings | Сейчас phone + note replica. Аудиофайл не является body/base64; full history/trash restore ещё нет |
| finance / Финансы | Быстрый доход/расход и журнал; месяц/счёт | Amount/type/account/category/date/note → edit/delete; default account личный, categories — domain management | Сейчас только локальный RUB. Sync, multicurrency, budgets/OCR не выдавать за готовые |
| calendar / Календарь | Agenda + компактная полоса дат; добавить событие | Event detail/full editor; timezone/source/permissions; week start/view prefs | Публичный domain API есть в платформе; mobile cache/commands/event sync ещё спроектировать. Task source — ссылка, не дубликат Event |
| documents / Документы | Файлы/папки и недавние; добавить файл | Preview → full viewer/editor по capabilities; download/offline files; sort/cache limits | Native file pipeline, size quotas, attachment integrity и media backup до offline promises; не JSON snapshot |
| projects / Проекты | Список и project overview: статус/следующий шаг/срок | Tasks/Materials/Plan как routes одного проекта; mobile plan сначала agenda/timeline, крупный Gantt позже | Пользователь видит те же entity IDs. Связи по public bridges; остальные модули могут быть отключены |
| time / Время | Текущий таймер + журнал дня; начать/остановить | Edit time entry/project links; personal view defaults; billing только contribution | Durable timer transition/interruption/process death и server reconciliation; running timer не просто React interval |
| habits / Привычки | Чеклист дня; отметить выполнение | Habit detail/history; start-of-day/reminder settings, insights отдельно по ownership | Day boundary/timezone и offline idempotence до выпуска; не удваивать отметку на retry |
| lists / Списки | Списки → строки checklist; добавить/отметить | Item edit/order, archive/delete по API; templates через contribution | Протокол уже знает list/listItem, Android adapter/UI пока нет; это не готовая функция из одной регистрации |
| inventory / Склад | Поиск номенклатуры/остатков; приход/расход | Item detail, movement confirm, units; thresholds scoped; costing optional | Остаток — результат учтённых движений, не local number overwrite; concurrent writes отдельно проверять |
| markets / Рынки | Watchlist и выбранный инструмент | Chart/detail; source/freshness, display prefs | Cached quote явно устаревшая; ни фиктивного realtime, ни торговых операций без отдельного workflow |
| opportunities / Возможности | Pipeline/список и ближайший шаг | Detail/actions, source/status; integrations отдельные capabilities | Read-only capture можно первым. Отклик/внешняя отправка — явная проверка и полномочия, не автоматический tap в сети |
| home / Дом | Объекты дома/платежи/события по public module contract | Object detail; contextual tabs/cards registered contributions | Это domain «Дом», НЕ shell «Обзор». Модель не дублирует finance/calendar |
| contacts / Контакты | Поиск контактов; создать | Contact card/edit + разрешённые links; format prefs | Импорт адресной книги требует отдельного разрешения/preview; не загружать phone contacts автоматически |
| health / Здоровье | Журнал и личные записи | Edit/history по domain; единицы/приватность | Sensitive scopes и export/privacy; не делать медицинские выводы из пустых/непроверенных данных |
| chat-archive / Архив чатов | Источники/разговоры → оригинальный transcript | Search, original export, source metadata; readable длинные сообщения | Не подменять источник summary. Incremental paging/full text/media contract до больших архивов |
| pet-care / Питомцы | Карточки питомцев + запись ухода | Дневник/событие/история; reminders по provider | Отдельный domain adapter; не импортировать desktop panel. Notification bridge только public |

## 3. Shell surfaces и расширения

Обзор, поиск, inbox, уведомления, sync, backup, settings — platform surfaces,
не новые domain IDs. В Overview каждая карточка имеет module owner, scope и
путь к исходнику; агрегат не владеет второй копией задач/финансов. Без вкладов
карточки не рисуются. Search поддерживает источник и freshness.
Цели и дополнительные представления остаются по текущей карте Base/Plugin/Bridge;
не объявлять их новым mobile module ради отдельной иконки.
rule/preserve-mental-model, rule/structure-before-containers.

Модульный settings вклад описывает field/page ID, scope и binding; тяжелые
операции управления сущностями ведут в domain screen. Нельзя переселять журналы
финансов или editor заметки в app settings под видом «расширенных параметров».

## 4. Реестр доступности и пустые состояния

| Ситуация | Что видит пользователь | Действие |
|---|---|---|
| Нет записей | Понятное название объекта и один первый шаг | Создать, если разрешено |
| Фильтр дал 0 | Показан активный фильтр, не onboarding | Сбросить фильтр |
| Есть cached content, нет сети | Контент + дата/статус копии | Работать поддержанными командами / повторить обмен |
| Renderer не поставлен в APK | В каталоге поддержки объяснение | Открыть desktop / проверить обновление, без пустой вкладки |
| Module disabled | Состояние policy; данные сохранены | Owner может включить, участник видит объяснение |
| Нет прав | Ограничение конкретного объекта/действия | Вернуться / запросить доступ по поддержанному сценарию |
| Durable save failure | Ввод остаётся, success отсутствует | Повторить / экспортировать draft |
| Conflict / stale revision | Сохранён ввод и canonical version | Разобрать конфликт, не silent overwrite |

Для всех строк: rule/cover-reachable-states, rule/error-states-recovery,
rule/empty-state-action, rule/preserve-user-input. Offline cache не обходит revocation.

## 5. Очередность без массового переноса

Сначала довести Tasks/Notes/Finance до надёжного базового lifecycle и вынести shell.
Далее предложенный первый кандидат — Lists: протокол уже знает сущности, но нужны
реальные adapter/UI, permissions и convergence tests. Calendar/Projects — после
контракта данных/связей и native reminder решения. Documents/audio — после file
storage/backup foundation. Остальные идут по потребности владельца; порядок не
выдаётся за одобренный roadmap платформы. rule/smallest-intervention.

## 6. Definition of ready / done для каждого нового модуля

До кода: MODULE.md/AI_CONTEXT/ownership, DTO/use cases, offline mode, rights,
capabilities/settings ownership, draft/attachment/delete semantics, render states.
После: полная цепочка создать → найти → открыть → изменить → сохранить →
завершить/архивировать/удалить → restart, отрицательные роли, disk/network failure,
unknown deep link, выключение/включение без удаления данных, module-disabled host.
Обязательны Android Back/keyboard/safe areas/320px/крупный шрифт, native smoke,
две replicas для sync, OPPO отдельно. Скриншот пустого экрана не является приёмкой.
