# ORION

> **Документация:** [карта документов](docs/README.md) · [правила актуальности](docs/DOCUMENTATION_LIFECYCLE.md) · [фактическое состояние](docs/STATUS.md) · [архивный индекс](docs/archive/README.md). Документы прошлых срезов и отчёты по PR — свидетельства на дату выполнения, не задания для повторного исполнения.

ORION — рабочее пространство для личных/семейных дел и небольших команд:
задач, календаря, заметок, финансов и документов. Проект построен как модульный монолит: NestJS API и
PostgreSQL обслуживают общий TypeScript-клиент, который используется Next.js
веб-приложением и тонкой Tauri-обёрткой.

Актуальные архитектурные правила — в [`AGENTS.md`](AGENTS.md) и
[`ORION_CONSTITUTION.md`](ORION_CONSTITUTION.md); карта поэтапного перехода —
[`docs/AI_REFACTOR_MIGRATION_MAP.md`](docs/AI_REFACTOR_MIGRATION_MAP.md).
Актуальная карта документов — в [`docs/README.md`](docs/README.md),
продуктовая модель и порядок работы — в
[`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md) и
[`docs/ROADMAP.md`](docs/ROADMAP.md). Резервное копирование и архитектурная
развилка устройств — в [`docs/SYNC.md`](docs/SYNC.md), правила работы с
существующим кодом — в [`CLAUDE.md`](CLAUDE.md). Ворота развёртывания — в
[`docs/DEPLOYMENT_READINESS.md`](docs/DEPLOYMENT_READINESS.md),
план интеграции Compass/FinControl — в
[`docs/INTEGRATIONS_COMPASS_FINCONTROL.md`](docs/INTEGRATIONS_COMPASS_FINCONTROL.md).
Согласованные решения по рабочей оболочке, заметкам, календарю, проектам,
открепляемым видам и схемам — в
[`docs/FRONTEND_WORKSPACE_SPEC.md`](docs/FRONTEND_WORKSPACE_SPEC.md).
Документы о plugin SDK и новой архитектуре описывают **целевое состояние**:
текущий код ещё проходит поэтапный переход и должен сохранить существующий UX.

## Возможности

- регистрация, access/refresh JWT, ротация сессий, смена пароля и список устройств;
- несколько изолированных рабочих пространств с PostgreSQL RLS;
- проекты — общий контекст для задач, заметок, событий, документов и операций;
- инбокс: захват мысли как есть, разбор «на сегодня» без ухода с очереди,
  либо в задачу / заметку / событие;
- задачи с приоритетами, сроками, напоминаниями, зависимостями, повторами,
  подзадачами, ручным порядком, сохранёнными видами, комментариями и
  журналом изменений статуса/исполнителя/срока;
- учёт времени: таймер, часы по задачам и проектам, ручные записи;
- привычки: расписание по дням недели, отметки по дням и серии;
- календарь с повторениями, исключениями, read-only ICS-лентой и подписками
  на внешние календари;
- заметки с тегами, wiki-ссылками, backlinks, историей, вложениями и корзиной;
- финансовые счета, проводки, бюджеты, правила, цели и отчёты;
- дерево документов с локальным или WebDAV-хранилищем и preview;
- глобальный поиск (⌘K) по всем модулям, связанные записи и адресный центр
  уведомлений (уведомление видит только тот участник, кому оно предназначено);
- зашифрованные WebDAV-бэкапы и восстановление с dry-run preview;
- dockable Workbench и отдельные окна панелей в desktop-версии;
- Настройки → Модули: включение и выключение предметных модулей без удаления данных;
- дашборд «Сегодня»: просроченное, инбокс, фокус дня, события, привычки, таймер и итог недели;
- первый запуск объясняется на дашборде; на узком экране меню выезжает шторкой.

## Структура

```text
apps/
  api/          NestJS, Prisma, фоновые задачи и REST API
  web/          Next.js App Router и функциональные панели
  desktop/      Tauri-обёртка и нативные уведомления
packages/
  shared-types/ Zod-схемы и DTO — источник истины контрактов
  core/         framework-agnostic API-клиент и token storage
  core-react/   React Query hooks и CoreProvider
  ui/           Workbench, layout и презентационные компоненты
infra/postgres/ локальная PostgreSQL 16 и роли для RLS
```

Клиентский вертикальный срез каждого модуля проходит через
`shared-types → core → core-react → apps/web/panels`. Backend-маршруты данных
имеют вид `workspaces/:workspaceId/<resource>` и защищены одновременно явной
проверкой членства и PostgreSQL Row Level Security.

## Быстрый старт

Для воспроизводимой установки и тестов требуется Node.js 24.15+ и Corepack/pnpm 9. Docker больше не нужен для
локальной базы: `pnpm db:up` поднимает Postgres 16 из портативных бинарников
на `127.0.0.1:5433`. Для desktop-сборки — Rust и зависимости Tauri.

```bash
corepack pnpm install
corepack pnpm db:up
copy apps\api\.env.example apps\api\.env
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm dev:api
corepack pnpm dev:web
```

API запускается на `http://localhost:4000`, web — на
`http://localhost:3010`. Перед первым запуском замените секреты и пароль
`orion_app` в `apps/api/.env`; локальные роли описаны в
[`infra/postgres/README.md`](infra/postgres/README.md).

`ORION_MODE` в `apps/api/.env` — `local` (по умолчанию: dev-секреты живы,
bind на `127.0.0.1`, доступен passwordless account picker/PIN) или `server`
(обязателен `JWT_SECRET`, bind на `0.0.0.0`, picker/PIN и pin-регистрация
отключены, пароль строже, вход ограничен по частоте). Однопользовательский
десктоп — всегда `local`; `server` — для варианта с внешним доступом.

## Проверки

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:integration  # требует подготовленную PostgreSQL
corepack pnpm build
corepack pnpm build:desktop-export  # статический экспорт apps/web/.next-desktop для Tauri
corepack pnpm quality           # unit quality gate без БД
```

GitHub Actions дополнительно поднимает чистую PostgreSQL, применяет все Prisma
миграции, проверяет API/RLS isolation интеграционным тестом и отдельным шагом
проверяет статический desktop-экспорт (`build:desktop-export`).

## Вес проекта

Исходники ORION занимают единицы мегабайт; почти всё остальное в каталоге —
регенерируемые артефакты сборки, и они уже в `.gitignore`:

| Каталог | Размер | Что это |
|---|---|---|
| `apps/desktop/src-tauri/target` | до нескольких ГБ | Rust-кэш `tauri build` / `cargo` |
| `apps/web/.next`, `.next-desktop`, `out` | ~0.3 ГБ | кэш и экспорт Next.js |
| `node_modules` | ~1 ГБ | зависимости (pnpm) |

Удалять их безопасно — они собираются заново (`tauri build`, `next build`,
`pnpm install`). Отдельно есть глобальный pnpm-store
(`%LOCALAPPDATA%\pnpm\store`), он вне репозитория и общий для всех проектов
машины; чистится `pnpm store prune`.

## Desktop

Для обычной установки Windows x64 скачайте NSIS `.exe` из GitHub Releases.
Пакет содержит локальный PostgreSQL, API и интерфейс; инструкции первого
запуска, данные и ограничения — в [docs/WINDOWS_INSTALLER.md](docs/WINDOWS_INSTALLER.md).
Путь разработки `scripts/launch-desktop.cmd` запускает ORION из текущего кода.

```bash
corepack pnpm dev:app
# или двойной клик: scripts/launch-desktop.cmd

corepack pnpm build:desktop-installer  # автономный NSIS-пакет для Windows x64
```

Tauri не содержит бизнес-логики: он показывает web-build и добавляет только
нативные возможности платформы. API разрешает web-origin из `WEB_ORIGIN` или
`WEB_ORIGINS`, а также стандартные origins Tauri.

Одна лишь команда `tauri build` без `build:desktop-installer` не готовит
вспомогательный runtime. Tauri остаётся тонкой оболочкой; бизнес-логика
работает в упакованном NestJS API. При первом запуске API и PostgreSQL
инициализируются в локальном профиле пользователя.

## Статус Sync

Готова Стадия 1: конфигурация WebDAV, проверка соединения, зашифрованные полные
снимки, список бэкапов, dry-run и подтверждённое восстановление. Бэкап собран
по явному реестру моделей (`snapshot-registry.ts`, версия схемы снимка 2) и
включает не только строки БД, но и файлы документов с их версиями
(`blob-backup.service.ts`) — см. CLAUDE.md «Snapshot registry v2 +
blob-backup» и [`docs/DEPLOYMENT_READINESS.md`](docs/DEPLOYMENT_READINESS.md)
для процедуры обновления/отката.
Двусторонняя поэлементная синхронизация и командные шары из Стадий 2–3
остаются roadmap и не показываются как готовые функции.
