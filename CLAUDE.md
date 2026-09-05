# CLAUDE.md — ориентация для агентов

ORION — ядро для соло-разработчика: модульный монолит **NestJS + Prisma + Postgres**
(`apps/api`) и общий **TypeScript-core**, переиспользуемый веб-клиентом
(`apps/web`, Next.js) и десктопом (`apps/desktop`, тонкая Tauri-обёртка).

- **Почему всё устроено именно так** — [`docs/PLAN.md`](docs/PLAN.md). Это история
  решений v0 → v0.3 с обоснованиями (в т.ч. на разборе реальных багов других
  проектов). Читай его перед любой архитектурной правкой.
- Быстрый старт и обзор — [`README.md`](README.md).
- Комментарии в коде намеренно подробные и объясняют «почему» (особенно
  `apps/api/src/common/prisma.service.ts`, `infra/postgres/init/01-app-roles.sql`,
  `apps/api/src/auth/auth.service.ts`) — доверяй им, не переписывай не разобравшись.

---

## Команды

```bash
pnpm install
pnpm db:up            # Postgres 16 в Docker на 127.0.0.1:5433
pnpm db:generate      # prisma generate
pnpm db:migrate       # prisma migrate dev
pnpm dev:api          # NestJS на :4000
pnpm dev:web          # Next.js на :3010
pnpm --filter @orion/desktop tauri:dev   # окно поверх запущенного :3010

pnpm typecheck        # tsc --noEmit по всем пакетам
pnpm lint             # eslint .
pnpm test             # vitest run — юнит-тесты в packages/**, без БД
pnpm build            # сборка всех пакетов
```

Гейт перед коммитом — `pnpm typecheck && pnpm lint && pnpm test`.
`pnpm test` покрывает только чистую логику в `packages/` (zod-схемы =
контракт, `ApiClient` 401→refresh→retry, `TokenStore`). Тестов на
NestJS-сервисы и БД-интеграцию пока нет — эти пути закрыты ручными
сценариями «Проверка» в `docs/PLAN.md`.

---

## Карта репозитория

```
apps/
  api/       NestJS. Модули: auth, workspaces, notes, tasks, notifications
  web/       Next.js app-router. Оболочка (sidebar) + страница на модуль
  desktop/   Tauri. Только окно + плагин нативных уведомлений, без бизнес-логики
packages/
  shared-types/  zod-схемы + выведённые из них типы DTO — единственный источник истины
  core/          ApiClient (typed fetch), TokenStore, StorageAdapter — без React и DOM
  core-react/    CoreProvider + хуки use* (react-query поверх ApiClient)
  ui/            Sidebar, примитивы, TiltCard, Calendar — тупые презентационные компоненты
infra/
  postgres/  docker-compose + init/01-app-roles.sql (роли orion_app / orion_system)
```

Клиент строится из четырёх слоёв, зеркалящих друг друга:
`shared-types` (контракт) → `core/api-client.ts` (HTTP) → `core-react/use-*.ts`
(состояние) → `apps/web/app/(app)/<модуль>/page.tsx` (UI).

---

## Модульный контракт

**Модуль = вертикальный срез через все слои, зеркало уже существующего `notes/`.**
`packages/ui` (в частности `sidebar.tsx`) при добавлении модуля **никогда не
меняется** — меняется только `apps/web/lib/module-registry.ts`.

Инварианты, которые обязан соблюдать каждый workspace-scoped модуль:

1. Роут всегда вида `workspaces/:workspaceId/<ресурс>` (см. `NotesController`).
2. Каждый метод сервиса первым делом вызывает
   `WorkspacesService.assertMember(userId, workspaceId)` **и** идёт через
   `PrismaService.withUser(userId, tx => …)` (см. ниже про RLS).
3. Валидация входа — только через zod-схему из `shared-types` и
   `ZodValidationPipe`, не через class-validator.
4. Наружу отдаётся DTO, собранный руками функцией `toDto(...)` в конце файла
   сервиса (даты → ISO-строки). Prisma-модели за пределы сервиса не выходят.

### Чек-лист: добавить модуль `X` (копируем `notes/`)

| # | Файл | Что делаем |
|---|------|-----------|
| 1 | `apps/api/prisma/schema.prisma` | модель `X` (обязательно `workspaceId` + `@@index([workspaceId])`, `@@map("xs")`), затем `pnpm db:migrate` |
| 2 | `apps/api/prisma/migrations/…enable_rls/` образец | **добавить RLS-политики для новой таблицы** в новой миграции (raw SQL): `ENABLE` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` по `current_setting('app.current_user_id', true)` |
| 3 | `apps/api/src/x/x.module.ts` `x.controller.ts` `x.service.ts` | один в один структура `notes/`; модуль импортирует `AuthModule`, `WorkspacesModule` |
| 4 | `apps/api/src/app.module.ts` | добавить `XModule` в `imports` |
| 5 | `packages/shared-types/src/x.ts` + `index.ts` | `xSchema`, `createXInputSchema`, `updateXInputSchema` |
| 6 | `packages/core/src/api/api-client.ts` | `listX / createX / updateX / deleteX` (копия `*Note`) |
| 7 | `packages/core-react/src/use-x.ts` + `index.ts` | `useX / useCreateX / useUpdateX / useDeleteX` (копия `use-notes.ts`), `queryKey: ["x", workspaceId]` |
| 8 | `apps/web/app/(app)/x/page.tsx` | страница в стиле `notes/page.tsx` |
| 9 | `apps/web/lib/module-registry.ts` | одна строка: `{ href: "/x", label: "…", icon: … }` |

---

## Postgres RLS — самое частое место ошибок

Изоляция между рабочими пространствами держится на **двух** независимых
предохранителях, и оба обязательны:

- **Явная проверка в коде** — `WorkspacesService.assertMember` → `403 Forbidden`.
  Даёт внятную ошибку вместо «тихо пустого списка».
- **Row Level Security в самой БД** — даже если код где-то забыл фильтр, Postgres
  физически не отдаст чужие строки.

### Две роли БД (`infra/postgres/init/01-app-roles.sql`)

| Роль | Когда | Как получить |
|------|-------|--------------|
| `orion_app` | все обычные запросы. `NOSUPERUSER NOBYPASSRLS` — FORCE RLS реально действует | `APP_DATABASE_URL` в `.env` |
| `orion_system` | только регистрация и крон просроченных задач — операции поверх всех пространств | `SET LOCAL ROLE orion_system` внутри `PrismaService.asSystem()` |
| `orion` (superuser) | **только миграции** (`DATABASE_URL`). BYPASSRLS — политики на него не действуют | — |

### Два метода `PrismaService`

- `withUser(userId, tx => …)` — транзакция с
  `set_config('app.current_user_id', userId, true)`. **Любой** запрос к
  workspace-таблицам (notes, tasks, workspaces, workspace_members) должен идти
  через него. Забыл — получишь пустой результат, а не всё подряд.
- `asSystem(tx => …)` — `SET LOCAL ROLE orion_system`, осознанный аудируемый
  обход RLS. Это **не** `SET LOCAL row_security = off` (та GUC для не-BYPASSRLS
  ролей ломает запросы, а не обходит их).

### Три места, где наивная реализация ломается

1. **Крон просроченных задач** (`DueTaskCheckerService.runCheck`) обходит все
   пространства — у него нет «текущего пользователя» → `asSystem`.
   (Ручной триггер `runCheckForUser` — наоборот, `withUser`, чтобы юзер
   дёргал напоминания только по своим данным.)
2. **Регистрация** (`AuthService.register`) создаёт workspace **до** первой
   membership-строки, а политика на `workspaces` проверяет membership → курица
   и яйцо → вся транзакция через `asSystem`.
3. `WorkspacesService.assertMember` / `listForUser` сами обязаны идти через
   `withUser`, иначе после FORCE RLS вернут пусто даже легитимному владельцу.

---

## Осознанные упрощения v0 — НЕ «чинить» без запроса

Отложено намеренно (обоснование — `docs/PLAN.md`), это не забытый техдолг:

- **Нет offline-sync / outbox.** Только обычный REST, всегда онлайн.
- **Tauri не содержит бизнес-логики.** Единственное расширение за весь проект —
  плагин нативных уведомлений (`@tauri-apps/plugin-notification`), и это
  платформенный биндинг, а не логика. Больше в `src-tauri` ничего не добавляем.
- **Windows-уведомления** (`useDesktopDueReminders`) — посессионное курьерское
  напоминание, пока окно открыто, а не фоновая служба. Это by design.
- **Telegram-уведомления** работают в dry-run (лог в консоль) без токена; с
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` в `.env` начинают слать реально —
  **без единой правки кода**. Не хардкодить токен, не менять ветвление.
- Мобильного клиента нет.

`/.autopilot.json` в корне — заглушечный конфиг от стороннего инструмента,
код ORION его **не читает**. Не опираться на него.

---

## Навигация: сначала graft

Репо проиндексировано graft (`graft/` — локальный кэш, в gitignore). Для «где
это», «кто вызывает», «что сломается» — сначала `graft_find_code` /
`graft_trace_calls` / `graft_file_api`, потом уже grep/Read. Если индекс устарел
после больших правок — `graft build`.

---

## Стиль кода

- Пользовательские строки (ошибки, лейблы) — **на русском**, как в существующем коде.
- Источник истины для форм данных — zod-схемы в `shared-types`; типы выводятся
  через `z.infer`, руками не дублируются.
- `ApiClient` — единственное место, где живёт HTTP и логика ретрая по 401
  (ротация refresh-токена). Хуки `use*` и `useSession` про это не знают.
- Именование файлов — kebab-case; NestJS — `*.module.ts` / `*.controller.ts` /
  `*.service.ts` рядом в папке модуля.

### Про размер файлов

Сейчас весь исходник — ~2600 строк, самый большой файл ~210. **Дробить файлы на
мини-модули по 300–500 строк не нужно** и вредно: ломает зеркальность
`notes/ ↔ tasks/`, по которой ориентируешься. Резать файл стоит, только когда он
переваливает за ~400 строк **и** содержит два реально независимых concern'а
(тогда: `api-client.ts` — по ресурсам; `tasks/page.tsx` — доска отдельно от
формы задачи). До тех пор — один модуль остаётся цельным.
