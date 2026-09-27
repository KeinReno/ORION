# Надёжность, данные и выпуск

## 1. Backup: сначала честность, потом полнота

Текущий снимок JSON не равен резервной копии всей установки. В нём нет части предметных таблиц, файловых байтов, полной identity/configuration модели. Нельзя просто добавить несколько spec() и объявить проблему закрытой.

### Этап A: остановить потенциально разрушительный путь

Owner-only. До полной проверки нового формата restore старого неполного формата должен безопасно отказываться, если не может гарантировать поддержанную область восстановления. Не удалять текущие данные, чтобы потом обнаружить несовместимость. UI объясняет ограничения существующих архивов, а не обещает их исправление задним числом.

### Этап B: реестр покрытия

Для каждой Prisma-модели: `included`, `derived`, `identity-excluded`, `secret-excluded`, `ephemeral-excluded` и причина. Тест сравнивает реестр со schema; новая workspace-модель без решения ломает quality gate.

Предметные included: проекты/вехи/dependencies, задачи/иерархия/dependencies/views, notes/links/revisions/attachments, events/overrides, documents/versions/annotations, finance tables, time, habits/entries, lists/items, inventory/items/movements, inbox/entity links. Параметры modules/plugins/restrictions — отдельная явная workspace config section. Уведомления/доставки — продуктовая политика архива, не случайное выпадение.

Membership/users/sessions/refresh tokens не импортировать как обычные записи workspace. Для восстановления на новой установке нужен отдельно спроектированный mapping пользователей и создание workspace; существующий restore допускает только тот же workspaceId. Не обещать disaster recovery на чистом сервере, пока identity mapping не реализован и не испытан.

### Этап C: новый формат

Версионированный manifest: formatVersion, app/schema compatibility, workspaceId, createdAt, table list/counts, file entries/key/size/checksum, completeness flags. Все даты/enum/references проходят schema validation до очистки. Не использовать `as WorkspaceSnapshot` как валидацию внешних данных.

Файлы: immutable backup copies или content-addressed blobs внутри backup namespace, включая исторические версии и находящиеся в корзине данные в пределах retention. Указатель на текущее live WebDAV-хранилище не является backup — файл может быть удалён позже.

Публикация: сначала временные/immutable объекты → проверка checksum → manifest complete → указатель latest. Ошибка не должна перезаписывать последнюю работоспособную копию частичным содержимым.

### Этап D: restore transaction plan

1. Получить архив, расшифровать, проверить schema, лимиты, workspace, ссылки и файлы.
2. Построить preview с добавлением/заменой/удалением по доменам, размером и ограничениями.
3. Создать restorePlanId с hash snapshot и ревизией/маркером состояния workspace, сроком действия.
4. После явного подтверждения повторно проверить owner/access, актуальность плана и сделать защитный снимок.
5. Блокировать конкурирующие изменения этого workspace на время критической стадии. Не держать глобальную блокировку приложения.
6. Файлы заранее staging; DB apply атомарен. Для неатомарного DB+filesystem использовать restore journal с фазами и безопасным recovery; компенсация и порядок должны быть описаны.
7. Сверить counts/checksums/references. Только после этого success, invalidation clients и release lock.

Не применять `skipDuplicates` для сокрытия нарушенных ссылок. Любой отфильтрованный/непринятый row — явная ошибка либо документированное исключение в preview. Restore не отправляет заново старые reminder события.

### Обязательные fault tests

Нет файла; неверный checksum; неизвестная версия; невалидный FK; чужой workspaceId внутри row; duplicate ID; разрыв WebDAV; ошибка после staging; ошибка DB apply; падение между commit и cleanup; два restore одновременно; write после preview. Тестировать на isolated fixture, никогда на рабочем workspace.

## 2. Режимы запуска

`local` и `server` — явная конфигурация, а не догадка по User-Agent.

- Local: API слушает loopback; account picker допустим; PIN только в документированных локальных условиях; проверка brute-force обязательна даже локально.
- Server: парольный вход без public directory, отключён PIN login, явная политика регистрации/invite, throttling/lockout, корректная proxy trust настройка, секреты без fallback и безопасные ответы.
- Перевод установки local→server: preflight пользователей с PIN/отсутствующим email, миграция учётных данных без раскрытия их значений; отказ старта server mode, если условия не соблюдены.

Не использовать CORS как замену authentication/host binding. Не добавлять cloud hosting как часть этой задачи.

## 3. Исходящие запросы и файлы

ICS/WebDAV: явные timeout, maximum body/file size, redirect policy, разрешённые протоколы, запрет передачи auth headers на другой origin. Для server mode разрешение hostname должно проверять реальные адреса/редиректы, включая IPv6 и link-local; исключение private endpoints — только явная администраторская настройка.

Файлы/Markdown/HTML preview: оценить существующие sanitization и iframe/CSP правила до изменения. `tauri.conf.json` сейчас содержит `csp: null`: разработать минимальную production CSP под реальные worker/blob/media подключения, проверить PDF, CodeMirror, WebGL и detached windows. Не включать политику наугад и не заявлять безопасность по одному флагу.

## 4. Сохранение и offline

v1 — online с устойчивостью к обрыву, не offline-first. Dirty draft хранится локально и явно подписан; mutations не показывают success до подтверждения. После reconnect refetch и CAS. Никакой молчаливой очереди финансовых операций с at-least-once повтором без idempotency key.

Refresh-token handling уже покрыт unit tests, не переписывать без проблемы. Проверить simultaneous tabs refresh, expired session во время редактирования, logout из другого окна. Чувствительный query cache очищается при смене identity.

## 5. Производительность

Целевые тестовые наборы: 10k задач, 5k заметок, 10k документов, 50k операций, 5k time entries, 100 проектов. Это синтетические границы проверки, не текущие обещания поддержанной нагрузки.

- API списков: page/cursor contract с стабильной сортировкой и ограничением max page size.
- Серверные totals не равны сумме текущей страницы.
- Поиск scope/access → фильтрация → ranking → limit, не наоборот.
- Не загружать body всех notes ради sidebar titles.
- Lazy renderers уже существуют; контролировать bundle, не вносить тяжёлые импорты в общую оболочку.
- Метрики latency/size записать на конкретном тестовом окружении. Целевой ориентир P95 обычного list/search ≤500ms локально на fixture; если не достигнут — измерить причину, не ослаблять correctness.

## 6. Desktop и обслуживание

Тонкую Tauri-обёртку сохранить. Launcher должен проверять readiness API/БД/web, показывать состояние/ошибку запуска, не создавать второй конфликтующий процесс при повторном запуске. Сборка UI не должна выглядеть как полноценная автономная установка, если backend по-прежнему отдельно.

Нужны runbook: первый запуск, обновление без потери данных, расположение БД/бинарных файлов, восстановление, диагностика, занятый порт, недоступный WebDAV. Логи без секретов. Автообновление приложения — отдельный этап с signing/rollback, не обязательное расширение v1.

## 7. Release gates

Typecheck, lint, unit, isolated integration, production web build, desktop export. Native installer проверяется на Windows отдельно. Для UX — browser E2E и screenshots основных сценариев. Документировать skipped checks и причины. Pass unit suite не означает pass backup/recovery/security.

Продуктовые правила: `rule/error-states-recovery`, `rule/preserve-user-input`, `rule/name-object-scope-consequence`. Остальное — инженерный coverage gap.
