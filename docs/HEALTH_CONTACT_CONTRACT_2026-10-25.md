# Health → Contacts: публичная проверка ссылки врача

Исходная база: master `750ebec80dfdf18bc3466be83c0cae578a23f496`, PR #69.
Реализация: `codex/health-contact-contract`; [ADR-0028](adr/ADR-0028-contact-reference-reader.md),
[контракт](platform-api/CONTACT_REFERENCES.md). UI, schema, миграции и права не меняются.

## Изменения

- HealthService больше не читает Contact. Узкий ContactReferences возвращает только boolean;
  владельцем запроса остаётся Contacts. Публичный Nest-модуль независим от ContactsModule/ContactsService.
- Реализация находится в `.service.ts` и проверяется architecture-check. Запрос включает id/workspaceId,
  выбирает только id, сохраняет исходную транзакцию и RLS; нет новой транзакции или смены роли.
- Health сначала проверяет медицинский доступ, затем ссылку врача. Ошибка остаётся HTTP 400 с прежним текстом;
  null очищает ссылку. Архивный/выключенный Contacts не нарушает существующую ссылку, CRUD guard сохраняется.
- Файл health.service.ts целиком удалён из exceptions: **27 → 26 файлов**, **63 → 62 model entries**;
  service entries остаются 19. Новое исключение не добавлялось.
- Integration API 1.3.0 / Platform API 1.4.0: аддитивный контракт. Snapshot, capability map и паспорта обновлены;
  оба public entry point проверяются unit-тестом карты.

## Проверки

Windows / PowerShell, отдельная PostgreSQL 16 на 127.0.0.1:5444; синтетические
orion_platform_integration и orion_platform_browser. Рабочая БД и первичная копия с пользовательскими правками
не изменяются.

Focused Health + Contacts: **29 passed**, 22.53 с. Шесть новых Health-сценариев проверяют create/update/null,
невалидную замену без изменения записи, доступ к обоим пространствам без разрешения смешивать их контакты,
архив/выключенный Contacts, RLS и видимость ещё не закоммиченной строки в исходной транзакции. Проверено,
что отказ в медицинском доступе происходит до вызова reader, и Health создаёт визит при физически исключённом
ContactsModule с сохранённым SDK. После focused проверки добавлен явный случай удалённого врача в тот же сценарий.

Полный unit: **1476 passed / 190 файлов**, 59.75 с. Typecheck прошёл; lint: **0 ошибок / 30 прежних
предупреждений**. Architecture-check, module-docs, module-registry и platform-map проходят; plugin contracts
и snapshot входят в полный unit. Production API/web build: passed, **54 страницы**.

Production Chromium: **47 passed**, 1.6 мин — 42 панели default-full/plugins-off, 3 сценария контактов и
2 новых сценария выбора врача/создания визита с reload в обоих профилях плагинов. Снимки действий не обновлялись.
Код интерфейса не менялся. Полный integration на пересозданной тестовой БД: **587 passed / 1 skipped**,
105 passed-файлов, 371.90 с. Включает все шесть новых сценариев и явный случай удалённого врача; исходный
случай «ссылка на отсутствующий контакт» по-прежнему возвращает HTTP 400 без изменения медицинской записи.
В логе нет 40P01/deadlock; искусственные HTTP 500 из lifecycle rollback тестов ожидаемы.
Compiled API содержит вызов ContactReferences и Platform API 1.4.0. GitHub CI учитывается отдельно от локальных
проверок; установленный Windows runtime и физическое удаление SDK/таблиц не проверялись.

## Границы

Проверка отсутствующего ContactsModule — про состав Nest, не про удаление SDK/таблиц и не про готовую установку
произвольного server-кода. Не добавлены общий startup/background compatibility enforcement или новый Windows
installer. Остальные 26 файлов исключений остаются отдельной очередью; beta 21 этим этапом не обновляется.
