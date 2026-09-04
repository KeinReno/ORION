# ORION

Ядро для соло-разработчика: модульный монолит на NestJS + Postgres, общий
TypeScript-core, переиспользуемый между веб- и десктоп-клиентом. v0 — рабочий
скелет (auth → workspace → один демо-модуль "Заметки"), не финальный продукт.

Полный контекст решений и почему они такие — `C:\Users\Reno\.claude\plans\structured-hatching-cherny.md`.

## Монорепозиторий

```
apps/
  api/        — NestJS: auth, workspaces, notes
  web/        — Next.js: сайдбар-оболочка + страницы
  desktop/    — Tauri: тонкая обёртка над web-билдом
packages/
  shared-types/  — zod-схемы + типы DTO
  core/           — API-клиент, хранение токена
  core-react/     — CoreProvider, useAuth, useNotes и т.д.
  ui/             — Sidebar, примитивы, TiltCard
infra/
  postgres/       — docker-compose для локальной БД
```

## Быстрый старт

```bash
pnpm install
pnpm db:up               # поднимает Postgres в Docker (порт 5433)
cp apps/api/.env.example apps/api/.env   # уже создан локально со своим JWT_SECRET
pnpm db:generate
pnpm db:migrate           # применяет схему
pnpm dev:api               # NestJS на :4000
pnpm dev:web               # Next.js на :3010
```

Открыть `http://localhost:3010` → регистрация создаёт пользователя и личное
рабочее пространство автоматически → дашборд и раздел "Заметки" (CRUD).

## Десктоп (Tauri)

```bash
pnpm --filter @orion/desktop tauri:dev     # окно поверх :3010 (нужен запущенный dev:web)
pnpm --filter @orion/web build:desktop      # статический экспорт в apps/web/out
pnpm --filter @orion/desktop tauri:build    # .exe / NSIS-инсталлятор
```

## Осознанные упрощения v0 (не забытые, а отложенные)

- Нет offline-sync/outbox — только обычный REST, всегда онлайн.
- Нет Postgres RLS — тенантность проверяется в коде NestJS (`WorkspacesService.assertMember`).
- Нет refresh-токенов — только access JWT.
- Tauri не содержит бизнес-логики — только окно.
- Мобильного клиента нет.

Причины — в плане (`structured-hatching-cherny.md`), основаны на разборе
реальных багов в других проектах (в частности, сломанного sync-движка у
NiVar FinControl).

## Модульный контракт

Модуль = запись в `apps/web/lib/module-registry.ts` (пункт сайдбара) +
NestJS-модуль в `apps/api/src/<module>/` со своими роутами, обязательно
принимающими `workspaceId` и проверяющими членство через `WorkspacesService`.
Сайдбар (`packages/ui`) никогда не меняется при добавлении модуля.
