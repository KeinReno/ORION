# Укрепление платформы — 25.10.2026

Статус: реализация и проверка в `codex/platform-hardening`; исходная база `1aa806d` после Windows beta 21. Этот этап не выпускает новый установщик. Утверждённое направление — PLATFORM.md, текущие факты — STATUS.md.

## Изменения

1. Generated ownership различает modules-ext/<id>. Architecture-check проверяет чужие модели и внутренние сервисы между подключаемыми модулями и между ними и Base. Собственные модели, Core и публичные контракты разрешены. Сохраняются прежние пределы статического анализа: *.service.ts, известные receivers, без анализа сырого SQL.
2. ^0.0.x фиксирует patch, ^0.x.y — minor, ^1.x.y — major. Нули слева, неподдерживаемые диапазоны и числа вне безопасного диапазона отвергаются. Версии/требования source JSON сохраняются генератором. При включении platform/contracts/обязательные зависимости проверяются до записи и hooks, в той же транзакции; guard не даёт default-on обойти несовместимость. Выключение сохраняет данные. ADR-0025 описывает контракт и 409 component_incompatible.
3. Contacts.merge больше не пишет Capture. Новый транзакционный EntityReferenceRegistry вызывает владельца Capture; исключение откатывает всю команду. Удалено одно существующее boundary exception, остальные не расширяются. ADR-0026; тесты проверяют перенос, rollback и чужое пространство.
4. Capability map генерируется из реестров, контрактов, владения моделями, паспортов и публичных путей. `pnpm platform-map --component <id>` показывает только нужный компонент. Unit и CI проверяют актуальность JSON. Это декларации, не тестовый сертификат и не выдача полномочий.
5. Snapshot host-контрактов больше не требует ручного bump Core при добавлении независимого modules-ext/permissions. Полные runtime-каталоги не урезаны. create:module обновляет карту автоматически.

## Исходные проверки на c363f18

Среда: Windows / PowerShell. PostgreSQL 16 отдельно на 127.0.0.1:5444; новые синтетические `orion_platform_integration`, `orion_platform_browser`, `orion_platform_probe`. Рабочая БД и пользовательский checkout не изменялись.

- Полный unit повторно: **1474 passed / 189 файлов**, 54.95 с. После уточнения индексирования shared-contract paths выполнен focused повтор map/semver: 29 passed; поведение сервера после полного прогона не менялось.
- Typecheck прошёл; production API/web build прошёл также в основной копии без fixture.
- Полный integration: **571 passed / 1 skipped**, 104 passed-файла, 395.29 с. Включены новые HTTP-случаи owner/member, несовместимые platform/contracts/dependency versions, выключенный host, сохранность данных и rollback переноса anchors.
- ESLint: **0 ошибок / 30 существующих предупреждений**; финальная точечная проверка последних изменений — 0 ошибок / 0 предупреждений.
- Architecture-check, registry, module-docs, platform-map и contract snapshot проходят; plugin contracts входят в полный unit.
- Браузер, production API/web: **48 passed / 1 failed / 1 skipped**, 2.8 мин. Passed: default-full/plugins-off панели, Knowledge, публикации, настройки, питомцы, импорт контактов. Skipped: scaffold fixture, намеренно отсутствующий в продуктовой копии. Failed: исходный сценарий карточки контакта после Escape — подробности ниже. Снимки панелей не обновлялись ради прохождения.

## Полный эксперимент нового модуля — пройден

Отдельный managed worktree `module-probe`, checkpoint платформы `1ec8c237b355eceec3dd8ad11e5657ea336963c8`, fixture commit `50e0c41`. Создан `platform-probe` командой `pnpm create:module platform-probe --label "Проверка платформы"`. Затем изменены только **собственные** version/requires его JSON (2.4.1, module contract ^1.3.0) и повторно вызваны registry/docs/map. Копия после эксперимента передана в archive_worktree; fixture не переносится в продуктовую ветку.

1. Prisma Client generate; отдельная БД, **144 миграции**, включая новую таблицу; полный typecheck — passed.
2. Сгенерированные HTTP/изоляционные тесты и структурный RLS — **7 passed**.
3. Host contract snapshot и capability map — **3 passed** без ручного bump Core после добавления компонента.
4. Production API/web build (55 страниц вместо 54) — passed. Скомпилированный API содержит runtime manifest platform-probe **2.4.1**, требования исходного JSON сохранены. `/system/components` является диагностикой миграций, а не endpoint версий; версии проверены непосредственно в compiled shared-types.
5. Chromium на портах 4146/3146 — **1 passed**: создание через UI, PATCH через API и reload, отказ чужому пользователю, plugins-off, выключение/повторное включение без потери записи, удаление через UI.
6. **20 затронутых файлов, 0 ручных файлов Core**. Только собственные каталоги, копия миграции, generated реестры/карта и разрешённые области Prisma schema. Точный список: [scaffold-footprint.json](platform-evidence/2026-10-25/scaffold-footprint.json). Единственная ручная правка предметного исходника — version/requires внутри собственного манифеста.

Воспроизведение: отдельный checkout этого этапа → pnpm install --frozen-lockfile → create:module → db:generate → собственная тестовая DATABASE_URL/APP_DATABASE_URL → migrate deploy → typecheck → generated integration. Браузер: `ORION_SCAFFOLD_MODULE=platform-probe`, E2E_DATABASE=orion_platform_probe, E2E_API_PORT=4146, E2E_WEB_PORT=3146, `node scripts/e2e-local.mjs e2e/module-scaffold.spec.ts`. Скрипт пересоздаёт только указанную синтетическую БД; никогда не указывайте рабочую БД.

## Исходные находки на c363f18 (до продолжения)

- **Контакты, невидимая exit-подложка:** исходный e2e/contacts.spec.ts:64 не может нажать фильтр после Escape. Screenshot показывает уже исчезнувшую карточку; DOM сохраняет dialog/backdrop с перехватом pointer events. Повтор исходного сценария и попытка reduced-motion с явным ожиданием удаления dialog воспроизвели проблему. Код ContactsPanel/Sheet/анимаций в платформенном изменении не менялся; причина общего overlay lifecycle не установлена, исправление интерфейса в этот scope не включено. Экспериментальные изменения теста отменены; failing evidence не выдаётся за green. Keyboard/animation acceptance здесь не закрыта.
- **Фоновый outbox deadlock:** в полном integration зарегистрирован PostgreSQL 40P01 внутри DomainEventDispatcherService.fanOut/createMany. BackgroundJobsService поймал ошибку; набор тестов завершился успешно. Это отдельное наблюдение, не доказательство причины прежнего HTTP 500 grants и не доказательство потери событий. Нужен отдельный разбор конкурентной очистки/доставки и повторов; event bus в этой задаче не переписывался.

## Продолжение: закрытие двух находок

- Modal/Sheet получили отдельную внутреннюю AnimatePresence-границу: exit внешней оболочки больше не зависит от
  shared-layout анимаций содержимого (в карточке контакта — SegmentedControl). Дополнительных DOM-обёрток нет;
  длительности, размеры, фокус и стек окон сохранены. Проверки требуют удаления dialog из DOM и обычного клика по
  фильтру после Escape; добавлены повторное открытие, закрытие кнопкой и оба режима prefers-reduced-motion.
- Fan-out блокирует родительское пространство до события (`FOR KEY SHARE ... SKIP LOCKED`), исключая обратный
  порядок с каскадным удалением и FK создаваемой доставки. Транзакционность и уникальный ключ доставок сохранены.
  Два новых интеграционных сценария проверяют пропуск занятого пространства, commit/rollback удаления и повторный
  проход двумя диспетчерами с единственной доставкой. На исходной реализации оба сценария падают из-за ожидания FK
  до истечения 5-секундной транзакции; после исправления все 7 outbox-проверок проходят. Это подтверждает исправление
  данного порядка блокировок; не является доказательством причины прежнего HTTP 500 grants.

Финальная проверка продолжения, та же Windows/изолированная PostgreSQL:

- Полный unit: **1474 passed / 189 файлов**, 53.87 с.
- Полный integration: **573 passed / 1 skipped**, 104 passed-файла, 389.67 с; `40P01/deadlock` в логе отсутствуют.
  Искусственные HTTP 500 из capability-lifecycle тестов ожидаемы и проверяют rollback. После уточнения теста
  блокировок (таймеры cron остановлены, добавлено незанятое пространство) повтор outbox: **7 passed**, 12.99 с.
- Полный typecheck и последующий API/test typecheck passed. ESLint: **0 ошибок / 30 прежних предупреждений**;
  последние затронутые файлы — 0 ошибок / 0 предупреждений. Architecture, registry, module-docs, platform-map passed;
  plugin contracts и snapshot входят в полный unit.
- Production API/web build: passed, 54 страницы. Chromium: **50 passed**, 1.9 мин — панели default-full/plugins-off,
  Knowledge, настройки, precision shell и контакты. Дополнительный финальный прогон: **7 passed**, 27.3 с —
  контакты, Modal в обычном/reduced-motion режимах, публикации и питомцы. Три сценария контактов повторяются;
  всего **54 различных** браузерных сценария. Проверены DOM-удаление, реальные клики, возврат фокуса Modal,
  повторное открытие и закрытие во время layout-анимации. Screenshot списка контактов после закрытия просмотрен.
- В первом дополнительном прогоне два новых Modal-теста искали FeedbackButton на detached route, где этой кнопки
  нет (5 passed / 2 failed). Исправлен только маршрут теста на рабочую оболочку; финальные 7 сценариев выше проходят.
- GitHub check `121125158819`: job не стартовал из-за failed payments/spending limit; локальные результаты не
  означают зелёный GitHub CI. Новый Windows installer этим продолжением не собирался.

Исходные failed-наблюдения выше сохранены как история; они не подменяются обновлением снимков или ослаблением assertions.

## Следующие ограничения

Выполняется первый перенос межмодульной зависимости; остаются 27 файлов в exception-list (64 model entries / 19 service entries), отдельные задачи. Compatibility применяется при toggle и в HTTP module/plugin guards; универсальная startup/quarantine policy и охват всех фоновых обработчиков этим этапом не добавлены. Нет автоматического обнаружения breaking changes, установки произвольного серверного кода или sandbox из массива permissions. CI по последней проверке блокировался billing; локальные результаты не следует называть зелёным GitHub CI.
