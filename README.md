<div align="center">

# KAIDEN · ORION

### Одно рабочее пространство. Множество процессов. Управляемая автоматизация.

**Модульная платформа для личной работы, семьи и небольших команд**  
Задачи · Проекты · Заметки · Календарь · Финансы · Документы · Интеграция ИИ-агентов

[Возможности](#возможности) · [Архитектура](#архитектура) · [Быстрый-старт](#быстрый-старт) · [Документация](#документация) · [Развитие](#развитие)

</div>

---

> [!IMPORTANT]
> **ORION находится в активной разработке.** Ниже разделены функции текущего кода и направления развития. Наличие спецификации не означает готовую реализацию. Точная проверенная картина — в [STATUS.md](docs/STATUS.md), критерии выпуска — в [DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md).

## Что такое ORION

**KAIDEN Orion** объединяет повседневные процессы в одном контексте: проект связывает задачи, события, заметки, документы и финансовые операции. Рабочие пространства позволяют разделять личную и совместную деятельность, а модульный подход — развивать систему без превращения интерфейса в набор разрозненных приложений.

Отдельное направление — **управление ИИ-агентами**: подключение, права, контекст, делегирование и контролируемое выполнение действий. Это направление развивается поэтапно; детали реализованных механизмов и будущих возможностей указаны в [документации Agent Gateway](docs/AGENT_MANUAL.md) и [архитектуре Agent Hub](docs/AGENT_HUB_ARCHITECTURE.md).

## Возможности

| Пространство и организация | Ежедневная работа | Данные и контроль |
| --- | --- | --- |
| Изолированные рабочие пространства, проекты, роли | Задачи, подзадачи, повторы, зависимости, учёт времени | PostgreSQL RLS, журнал изменений, управление сессиями |
| Workbench и отдельные desktop-панели | Календарь, привычки, заметки, инбокс | Документы, финансы, уведомления, поиск |
| Управление модулями | Связанные записи между модулями | Зашифрованные WebDAV-бэкапы и dry-run восстановления |

**Текущее состояние и ограничения** каждого направления следует проверять по [STATUS.md](docs/STATUS.md), а не по историческим отчётам.

### Вектор развития

- **AI & Agent orchestration:** контекст, безопасное подключение агентов, делегирование и контроль действий.
- **Модульная платформа:** границы Core / Module / Plugin и последовательная экстракция компонентов.
- **Устройства и синхронизация:** развитие локального, сетевого и гибридного режимов.
- **Продуктовый интерфейс:** единый Workbench, контекстные панели, связанные представления и мобильные сценарии.

Это **направления**, а не обещание доступности всех функций в текущей сборке. См. [PLATFORM.md](docs/PLATFORM.md), [ROADMAP.md](docs/ROADMAP.md) и [SYNC.md](docs/SYNC.md).

## Интерфейс

ORION проектируется как **рабочая оболочка**, а не последовательность несвязанных форм: навигация по пространствам, контекст проекта, dockable Workbench, отдельные окна в desktop и компактные мобильные сценарии.

> [!NOTE]
> Визуальная галерея будет добавлена после проверки актуальных скриншотов и удаления персональных данных. Здесь намеренно нет макетов, выдаваемых за действующий интерфейс. Спецификация: [FRONTEND_WORKSPACE_SPEC.md](docs/FRONTEND_WORKSPACE_SPEC.md).

## Архитектура

```text
                  Next.js / React
                         │
                shared UI / Workbench
                         │
                  core-react hooks
                         │
               core API client + DTO
                         │
                   NestJS API
                         │
                PostgreSQL + RLS

Desktop: Tauri shell → web UI + packaged API/runtime
Contracts: shared-types / Zod
```

**Стек:** TypeScript · NestJS · Next.js · React · Prisma · PostgreSQL 16 · Tauri · Rust (desktop shell) · pnpm.

```text
apps/api/             API, Prisma, фоновые задачи
apps/web/             Web UI и панели
apps/desktop/         Tauri и desktop-интеграции
packages/shared-types/ DTO и Zod-контракты
packages/core/         API-клиент и token storage
packages/core-react/   React hooks
packages/ui/           Workbench и UI-компоненты
infra/postgres/        Локальная БД и роли
```

Архитектурные инварианты: [ORION_CONSTITUTION.md](ORION_CONSTITUTION.md), [AGENTS.md](AGENTS.md). План миграции: [AI_REFACTOR_MIGRATION_MAP.md](docs/AI_REFACTOR_MIGRATION_MAP.md).

## Быстрый старт

**Для разработки:** Node.js 24.15+, Corepack / pnpm 9; для desktop-сборки дополнительно Rust и зависимости Tauri. Локальная PostgreSQL 16 поднимается из портативных бинарников — Docker не обязателен.

```powershell
corepack pnpm install
corepack pnpm db:up
copy apps\api\.env.example apps\api\.env
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm dev:api
corepack pnpm dev:web
```

Web: `http://localhost:3010` · API: `http://localhost:4000`.

> [!WARNING]
> Перед запуском замените dev-секреты и пароль `orion_app` в `apps/api/.env`. `ORION_MODE=local` предназначен для локального использования, `server` — для сценариев с внешним доступом и более строгими требованиями к конфигурации. Подробнее: [infra/postgres/README.md](infra/postgres/README.md).

**Windows desktop:** готовый установщик NSIS `.exe` — в Releases, когда соответствующая сборка опубликована. [Инструкция](docs/WINDOWS_INSTALLER.md). Для разработки: `corepack pnpm dev:app`. Для подготовки инсталлятора: `corepack pnpm build:desktop-installer`.

### Проверки

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm build:desktop-export
```

Интеграционные тесты требуют подготовленной PostgreSQL. Для полного локального gate: `corepack pnpm quality`. Детали CI и readiness: [DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md).

## Документация

| Если вы хотите… | Начните здесь |
| --- | --- |
| Понять продукт и его направление | [PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) · [PLATFORM.md](docs/PLATFORM.md) |
| Узнать, что действительно реализовано | [STATUS.md](docs/STATUS.md) · [ROADMAP.md](docs/ROADMAP.md) |
| Установить и собрать Windows-версию | [WINDOWS_INSTALLER.md](docs/WINDOWS_INSTALLER.md) |
| Разобраться в архитектуре | [ORION_CONSTITUTION.md](ORION_CONSTITUTION.md) · [MODULES_AND_PLUGINS.md](docs/MODULES_AND_PLUGINS.md) |
| Работать с ИИ-агентами | [AGENT_MANUAL.md](docs/AGENT_MANUAL.md) · [AGENTS.md](AGENTS.md) |
| Разобраться с данными и бэкапами | [SYNC.md](docs/SYNC.md) |
| Найти спецификацию или исторический отчёт | **[Полная карта документации](docs/README.md)** |

## Развитие

Основные ориентиры: [ROADMAP.md](docs/ROADMAP.md), [PLUGIN_EXTRACTION_LOG.md](docs/PLUGIN_EXTRACTION_LOG.md), [DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md). Исторические ТЗ и отчёты — свидетельства на дату выполнения, а не актуальный список незавершённых задач.

---

<div align="center">

**KAIDEN ORION** · Рабочее пространство, которое развивается вместе с задачами.

</div>
