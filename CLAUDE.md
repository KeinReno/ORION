# CLAUDE.md — историческая ориентация по существующему коду

> Актуальные правила изменений: [`AGENTS.md`](AGENTS.md) →
> [`ORION_CONSTITUTION.md`](ORION_CONSTITUTION.md) →
> [`docs/AI_REFACTOR_MIGRATION_MAP.md`](docs/AI_REFACTOR_MIGRATION_MAP.md).
> Этот файл описывает сложившуюся реализацию и историю решений; при расхождении
> с новой архитектурой следуйте указанным документам. ORION рассчитан и на
> личное/семейное использование, и на небольшие команды.

ORION — платформа для личных пространств и небольших команд: модульный монолит **NestJS + Prisma + Postgres**
(`apps/api`) и общий **TypeScript-core**, переиспользуемый веб-клиентом
(`apps/web`, Next.js) и десктопом (`apps/desktop`, тонкая Tauri-обёртка).

- **Актуальные продуктовые решения** — [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md)
  и [`docs/ROADMAP.md`](docs/ROADMAP.md). Исторические обоснования старых
  реализаций доступны через [`docs/HISTORY.md`](docs/HISTORY.md).
- Быстрый старт и обзор — [`README.md`](README.md).
- Комментарии в коде намеренно подробные и объясняют «почему» (особенно
  `apps/api/src/common/prisma.service.ts`, `infra/postgres/init/01-app-roles.sql`,
  `apps/api/src/auth/auth.service.ts`) — доверяй им, не переписывай не разобравшись.

---

## Команды

```bash
pnpm install
pnpm db:up            # Postgres 16 без Docker на 127.0.0.1:5433
pnpm db:down          # остановить кластер (данные в infra/postgres/data)
pnpm db:up:docker     # тот же контракт, если Docker уже есть
pnpm db:generate      # prisma generate
pnpm db:migrate       # prisma migrate dev
pnpm dev:api          # NestJS на :4000
pnpm dev:web          # Next.js на :3010
pnpm --filter @orion/desktop tauri:dev   # окно поверх запущенного :3010

pnpm typecheck        # tsc --noEmit по всем пакетам (+ apps/api/test через tsconfig.test.json)
pnpm lint             # eslint .
pnpm test             # vitest run — юнит-тесты в packages/**, без БД
pnpm test:integration # API + реальная PostgreSQL/RLS; требует db:up и миграции
pnpm test:e2e:local   # Playwright: каждая панель в default-full и plugins-off на отдельной БД orion_e2e
                      # (порты 4100/3110; --skip-build, --update-snapshots). В CI — pnpm test:e2e после build
pnpm build            # сборка всех пакетов
pnpm quality          # typecheck + lint + unit tests + build
pnpm clean            # удалить регенерируемые артефакты (target/.next/out/dist); --dry-run, --deps
```

Локальный гейт перед коммитом — `pnpm quality`. Workflow CI при публикации в GitHub дополнительно запускает
`pnpm test:integration` на чистой PostgreSQL после всех Prisma-миграций.
`pnpm test` покрывает только чистую логику в `packages/` (zod-схемы =
контракт, `ApiClient` 401→refresh→retry, `TokenStore`, движок повторений,
wiki-ссылки, дерево документов). Критический путь API → workspace membership →
PostgreSQL RLS покрыт интеграционным тестом
`apps/api/test/api-rls.integration.test.ts`: изоляция заметок и строк
транзакций для второго пользователя, CORS-preflight для Tauri и — отдельно —
**структурная проверка, что у каждой таблицы с колонкой `workspaceId` есть
`ENABLE` + `FORCE ROW LEVEL SECURITY` и хотя бы одна политика**. Именно этот
тест ловит забытую RLS-миграцию для новой таблицы (так был найден пропуск у
`finance_transaction_lines`). Детальные сценарии модулей и внешние
WebDAV/Telegram-интеграции пока остаются ручными.

**Чистка после интеграционного теста обязана удалять и пространство, не только
пользователя.** `WorkspaceMember.userId` каскадится, поэтому `user.deleteMany`
уносит лишь строку членства, а workspace со всеми данными остаётся — так
накопилось 166 осиротевших пространств (v0.18). `afterAll` в
`api-rls.integration.test.ts` теперь удаляет пространства тестовых
пользователей и проверяет, что после него ничего не осталось.

---

## Карта репозитория

```
apps/
  api/       NestJS. Модули: auth, workspaces, modules (каталог + enable/disable
             без удаления данных, `@RequireModule`), notes (+ вложения заметок:
             NoteAttachmentsService поверх DocumentsService), tasks,
             notifications (+ notification-center — лента уведомлений в
             приложении, не крон), projects, inbox, search, settings, system,
             time (учёт времени), habits (привычки), finance (+ budget-alerts),
             events (+ calendar-connections — входящие ICS-фиды; calendar-feed —
             исходящий фид по токену), documents. storage/ — StorageAdapter
             (local|webdav) для бинарных файлов (@Global-модуль)
  web/       Next.js app-router. Оболочка (sidebar + Workbench-док) + панель на
             модуль. Панели в `lib/panel-registry.ts`: dashboard, tasks, calendar,
             notes, projects, inbox, time, habits, finance, documents, sync,
             settings
  desktop/   Tauri. Только окно + плагин нативных уведомлений, без бизнес-логики;
             frontendDist указывает на экспорт `apps/web/.next-desktop`
packages/
  shared-types/  zod-схемы + выведённые из них типы DTO — единственный источник истины
  core/          ApiClient (typed fetch), TokenStore, StorageAdapter — без React и DOM
  core-react/    CoreProvider + хуки use* (react-query поверх ApiClient)
  ui/            Sidebar, Workbench (dockview), примитивы, PanelShell/Header,
                 overlays (Modal/Sheet/DropdownMenu/Popover), Toast, hooks,
                 TiltCard, Calendar, MarkdownEditor/View, FilePreview, DiffView —
                 тупые презентационные компоненты
infra/
  postgres/  портативный Postgres (`pnpm db:up`) + docker-compose запасной путь,
             init/01-app-roles.sql (роли orion_app / orion_system)
```

Клиент строится из четырёх слоёв, зеркалящих друг друга:
`shared-types` (контракт) → `core/api-client.ts` (HTTP) → `core-react/use-*.ts`
(состояние) → `apps/web/panels/<Модуль>Panel.tsx` (UI, открывается в
Workbench-доке — см. «Модульный контракт» ниже).

---

## Модульный контракт

**Модуль = вертикальный срез через все слои, зеркало уже существующего `notes/`.**
`packages/ui` (в частности `sidebar.tsx` и `workbench.tsx`) при добавлении
модуля **никогда не меняется** — меняется только `apps/web/lib/panel-registry.ts`.

С v0.5 фронтенд-часть модуля — не роут, а **панель**, живущая в одном
постоянном `<Workbench />` (обёртка над [dockview](https://dockview.dev/),
рендерится один раз в `apps/web/app/(app)/layout.tsx`, чтобы не
размонтироваться при переключении между модулями). Клик в сайдбаре не
делает `router.push`, а зовёт `workbenchApi.addPanel(...)`
(открыть-или-сфокусировать, без дублей) — см. `openPanel` в
`app/(app)/layout.tsx`. Панели общаются друг с другом не через URL
(`?focus=id` было в v0), а через `apps/web/lib/panel-bus.ts` — маленький
pub/sub, а не стейт-менеджер; смотри его, прежде чем городить что-то
крупнее для нового кросс-панельного сигнала.

**Панели-экземпляры.** Проект открывается не Sheet'ом над списком, а своей
вкладкой дока `project:<id>` (`ProjectWorkspacePanel`, `openProject()` в
`panel-bus.ts`): контейнеру нужна вся ширина — «Дальше»/«Горит»/веха на
обзоре, задачи по вехам, Гант, материалы. В реестре это `instanced: true`
(id записи приходит в `params.instanceId`, dockview сам сохраняет его в
раскладке), `navParent` подсвечивает родительский пункт сайдбара, окно
открепления — `/panel/project?instance=<id>`. Логика обзора —
`apps/web/lib/project-focus.ts` (с тестами). Sheet остаётся для одиночных
записей (задача, событие, операция). Старые роуты (`/tasks`,
`/calendar`, `/notes`) остались тонкими редирект-заглушками на `/dashboard`
ради старых закладок — сами по себе ничего не рендерят.

Инварианты, которые обязан соблюдать каждый workspace-scoped модуль:

1. Роут API всегда вида `workspaces/:workspaceId/<ресурс>` (см. `NotesController`).
2. Каждый метод сервиса первым делом вызывает
   `WorkspacesService.assertMember(userId, workspaceId)` **и** идёт через
   `PrismaService.withUser(userId, tx => …)` (см. ниже про RLS).
3. Валидация входа — только через zod-схему из `shared-types` и
   `ZodValidationPipe`, не через class-validator.
4. Наружу отдаётся DTO, собранный руками функцией `toDto(...)` в конце файла
   сервиса (даты → ISO-строки). Prisma-модели за пределы сервиса не выходят.
   Следствие: **новая колонка в схеме = правка `toDto`**, иначе `pnpm typecheck`
   покажет расхождение с контрактом (так в v0.14 нашлись `projectId`,
   `currency`, `extractedText`, `reconciledAt`/`importedRef`).
5. Ссылка на другой объект по id (`projectId`, `accountId`, `categoryId`)
   проверяется на принадлежность **этому же** пространству — `assertProjectTx`
   (`notes`/`events`/`inbox`/`documents`), `assertAccountInWorkspace` /
   `assertCategoryInWorkspace` / `assertProjectInWorkspace`
   (`finance-refs.util.ts`). Пользователь может быть членом двух пространств,
   и RLS тут не спасает: обе строки ему видны, просто их нельзя смешивать.
6. Zod-схемы **ответов** (`xSchema`) пишутся без `.default(...)`: дефолт у
   ответа молча выдумывает значение, которого сервер не прислал, и расщепляет
   входной/выходной типы схемы (`ApiClient.request<T>` такую схему не примет).
   Дефолты уместны только во входных схемах (`createXInputSchema`).
7. «Задача ещё открыта» решается только через `isTaskClosed` /
   `TASK_CLOSED_STATUSES` из `shared-types/src/task.ts` — не сравнением со
   строкой `"done"` в очередном месте (с появлением `canceled` шесть таких
   сравнений начали считать отменённые задачи просроченными).
8. **Любой новый производитель уведомлений спрашивает
   `NotificationPolicyService.allows(workspaceId, kind)`** перед отправкой —
   иначе он будет игнорировать тумблеры и тихие часы из настроек (ровно этот
   баг прожил два релиза: `UserPreference` никто не читал). Пропущенное по
   политике напоминание **не** помечается доставленным: оно сработает, когда
   настройки разрешат. Ручные действия пользователя («напомнить сейчас»)
   политику игнорируют осознанно.
9. **Выключение модуля не удаляет данные.** Каталог — `MODULE_CATALOG` в
   `shared-types/src/modules.ts` (дашборд, инбокс, поиск, настройки, sync —
   оболочка, не предметные модули). Состояние — `Workspace.disabledModules`.
   Контроллер домена несёт `@RequireModule("x")` (409, если выключен). На
   клиенте сосед не зовёт чужой API: `useX(isEnabled("x") ? workspaceId : undefined)`.
   Панель в реестре помечается `moduleId`. Страница модуля — Настройки → Модули.

### Фоновые задачи (`@Cron`) — их пять, и все обходят RLS через `asSystem`

| Сервис | Расписание | Зачем |
|---|---|---|
| `DueTaskCheckerService` | каждую минуту | просроченные задачи → Telegram + лента; спрашивает политику |
| `EventReminderService` | каждую минуту | напоминания событий (дедуп — `sent_reminders`); спрашивает политику |
| `RecurringCheckerService` (finance) | каждый час | материализует повторяющиеся платежи |
| `CalendarConnectionsService` | каждые 30 минут | тянет включённые внешние ICS-фиды |
| `NoteTrashPurgeService` / `DocumentTrashPurgeService` | в 3:00 | чистка корзины заметок (и ревизий) и файлов старше 30 дней |

Владельца пространства для политики ищет `NotificationPolicyService`
(роль `owner`, иначе любой участник) — напоминания в ORION
workspace-scoped, а не per-user; историческое обоснование — `docs/HISTORY.md` (v0.16).

### Чек-лист: добавить модуль `X` (копируем `notes/` / `tasks/`)

| # | Файл | Что делаем |
|---|------|-----------|
| 1 | `apps/api/prisma/schema.prisma` | модель `X` (обязательно `workspaceId` + `@@index([workspaceId])`, `@@map("xs")`), затем `pnpm db:migrate` |
| 2 | `apps/api/prisma/migrations/…enable_rls/` образец | **добавить RLS-политики для новой таблицы** в новой миграции (raw SQL): `ENABLE` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` по `current_setting('app.current_user_id', true)` |
| 3 | `apps/api/src/x/x.module.ts` `x.controller.ts` `x.service.ts` | один в один структура `notes/`; модуль импортирует `AuthModule`, `WorkspacesModule` |
| 4 | `apps/api/src/app.module.ts` | добавить `XModule` в `imports` |
| 5 | `packages/shared-types/src/x.ts` + `index.ts` | `xSchema`, `createXInputSchema`, `updateXInputSchema` |
| 6 | `packages/core/src/api/api-client.ts` | `listX / createX / updateX / deleteX` (копия `*Note`) |
| 7 | `packages/core-react/src/use-x.ts` + `index.ts` | `useX / useCreateX / useUpdateX / useDeleteX` (копия `use-notes.ts`), `queryKey: ["x", workspaceId]` |
| 8 | `apps/web/panels/XPanel.tsx` | компонент-панель в стиле `panels/NotesPanel.tsx`: каркас `PanelShell`/`PanelHeader`/`PanelBody` из `@orion/ui`, без `Suspense`/роут-обвязки. Строки для пользователя — по-русски, время — через `lib/format.ts` |
| 9 | `apps/web/lib/panel-registry.ts` | `{ id: "x", label: "…", icon: …, component: XPanel, moduleId: "x" }` |
| 10 | `packages/shared-types/src/modules.ts` + контроллер | строка в `MODULE_CATALOG` и `@RequireModule("x")` вместо голого `JwtAuthGuard` |

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

Следующие упрощения относятся к описываемой исторической реализации; актуальная очередь — в `docs/ROADMAP.md`:

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
- **В Tauri нет перетаскивания панели за край экрана в отдельное окно**, как в
  Obsidian — только явная кнопка «открепить» (`⧉` в хедере группы,
  `DetachHeaderAction` в `apps/web/app/(app)/layout.tsx`). Причина —
  `window.open()` в Tauri v2 по умолчанию открывает системный браузер, а не
  нативное окно, и у dockview нет точки расширения для переопределения
  своего popout-механизма. В браузере (не Tauri) popout — родной, через
  dockview (`public/popout.html`).
- **UI-примитивы v0.6 написаны руками, без Radix / Headless UI.** Overlays,
  Toast, SegmentedControl и т.п. — свои. Drag-and-drop задач и пилюль
  календаря — нативный HTML5 DnD, без `@dnd-kit` и т.п. Не «улучшать»
  добавлением UI-библиотек без запроса.
- **Исключение (v0.9, по явному запросу): редактор тела заметки.**
  `MarkdownEditor` в `@orion/ui` — обёртка **CodeMirror 6** (source-markdown,
  режим «как в Obsidian»), просмотр — `MarkdownView`/`renderMarkdown` через
  **`markdown-it`**. Историческое обоснование — `docs/HISTORY.md` (v0.9).
  `whitespace-pre-wrap` для тела заметки больше не актуален.
- **Исключение (v0.12, по явному запросу): просмотрщики файлов.**
  `FilePreview` в `@orion/ui` (`file-preview/*`) — `React.lazy` на три
  тяжёлых рендерера, каждый отдельным чанком: **`pdfjs-dist`** (PDF),
  **`mammoth`** (Word), **`xlsx`**/SheetJS (Excel/CSV). Изображения/видео/
  аудио — нативно, текст/Markdown — `MarkdownView`/`<pre>`. Воркер pdf.js
  копируется в `apps/web/public/pdf.worker.min.mjs` скриптом
  `scripts/copy-pdf-worker.mjs` (перед dev/build). Обоснование —
  `docs/HISTORY.md` (v0.12).
- **Поиск/фильтры в панелях — клиентские** (по уже загруженному списку через
  `useNotes`/`useTasks`/`useDocuments`). Серверного поиска нет by design
  (кроме full-text заметок/задач v0.7 и оконного `events?from&to` v0.10).
- **Модуль documents — бинарное хранилище (v0.12).**
  - `Document.parentId` (дерево папок) — **осознанное исключение** из
    правила «без `parentId`» выше: папки — суть модуля.
  - Блобы живут за `StorageAdapter` (`apps/api/src/storage/`), драйвер —
    `STORAGE_DRIVER=local|webdav` в `.env` (S3 — будущий третий). `local` и
    `webdav` **зеркалят дерево папок как реальную структуру каталогов**
    (навигируется в Проводнике); БД авторитетна, путь блоба выводится из
    цепочки `parentId`, отдельной колонкой не хранится. Корзина на диске —
    `<ws>/.trash/<id>`.
  - `GET workspaces/:id/documents/:docId/content` — первый авторизованный
    бинарный стрим (`@Res()`, `Range` → `206`). `POST …/documents/upload` —
    первое не-JSON тело (`multipart/form-data`, `FilesInterceptor`);
    в `ApiClient.request()` для `FormData` не ставится `Content-Type`.

Заглушечный `/.autopilot.json` стороннего инструмента удалён при чистке
репозитория: код ORION его не использовал. Не восстанавливать его как
конфигурацию уведомлений.

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

**Дробить файлы на мини-модули по 300–500 строк не нужно** и вредно: ломает
зеркальность `notes/ ↔ tasks/`, по которой ориентируешься. Резать файл стоит,
только когда он переваливает за ~400 строк **и** содержит два реально
независимых concern'а. Примеры, где это уже сделано: `TasksPanel.tsx` — доска,
а форма задачи вынесена в `panels/task-form.tsx` (переиспользуется и в `Modal`
«новая», и в `Sheet` деталей), виды — в `panels/tasks/saved-views.tsx`,
карточка — в `panels/tasks/task-card.tsx`; у проектов так же
`panels/project-form.tsx`. `NotesPanel.tsx` цельный намеренно (мастер-деталь +
встроенный `NoteEditor`, ~800 строк), но вплотную подошёл к порогу: следующий
крупный концерн в нём — повод выносить, а не «на всякий случай» резать сейчас.

### Вес репозитория

Исходники ORION — единицы мегабайт. Всё остальное в каталоге — регенерируемые
артефакты, и они **уже в `.gitignore`**: `apps/desktop/src-tauri/target`
(Rust-кэш `tauri build`, самый тяжёлый — легко переваливает за 5 ГБ),
`apps/web/.next` / `.next-desktop` / `out`, `node_modules`. Если «проект весит
много» — сначала посмотри сюда, а не в код: удалять их безопасно, они
собираются заново (`tauri build`, `next build`, `pnpm install`). Глобальный
pnpm-store (`%LOCALAPPDATA%\pnpm\store`, общий для всех проектов машины) вне
репозитория и чистится `pnpm store prune`.

### Настройки внешнего вида и уведомлений

- Тумблеры и тихие часы из `UserPreference` **работают**: их читает
  `NotificationPolicyService` на сервере и `useDesktopDueReminders` в
  десктопе. Меняешь поведение напоминаний — спроси политику, не изобретай
  свою проверку.
- `accent`/`density` применяются рантаймом: `PreferencesEffect`
  (`apps/web/lib/preferences-effect.tsx`) ставит `data-accent`/`data-density`
  на `<html>`, значения живут CSS-переменными в `globals.css`. Добавляешь
  цвет, зависящий от настроек, — заводи переменную, а не hex в конфиге
  Tailwind.
- `theme` — сохранённое, но не применённое поле: приложение однотёмное
  (dockview `themeAbyss`), переключателя в панели поэтому нет. Не добавляй
  контрол, который ничего не делает.

### Встроенный браузер, интеграции, плагины (v0.21)

- **Браузер** (`panels/BrowserPanel.tsx`, панель `browser`, группа «Инструменты») — страницы http(s) во вкладках внутри
  панели, как «Веб-просмотр» в Obsidian. Фрейм песочный (`sandbox`, без реферера); адреса проходят через
  `lib/browser-url.ts` (`javascript:`, `data:`, `file:`… отклоняются, не-URL превращается в поиск). Сайты, запрещающие
  встраивание, остаются пустыми — для них «Открыть во внешнем браузере»; настоящего веб-вью Tauri тут нет (Rust недоступен).
  Клик по ссылке в просмотре заметки открывает её здесь (`openInBrowser`), Ctrl/Cmd+клик — как обычно. CSP десктопа получил `frame-src http: https:`.
- **Поиск и вкладки браузера:** поисковик выбирается в строке адреса (Google по умолчанию, Яндекс, Bing, DuckDuckGo; `lib/browser-url.ts`, выбор — `lib/browser-pages.ts`). Вкладку браузера можно перетащить в док ORION (MIME панели, `browsertab:<id>`, адрес хранится в `orion.browser.pages.v1`) или вынести кнопкой. Выдача Google (`igu=1`) и Bing во фрейме показывается; Яндекс/DuckDuckGo запрещают встраивание и могут остаться пустыми.
- **Compass целиком в «Рынках» (v0.22).** Движок Compass (Python, FastAPI) лежит в `apps/compass-engine/` (копия `src/compass` из проекта Compass + `run_engine.py`). `CompassEngineService` (`apps/api/src/markets/`) запускает его по требованию (`POST workspaces/:id/markets/engine/start|stop`, `GET …/engine`), слушает 127.0.0.1:8766 (`COMPASS_ENGINE_PORT`), токен сессии случайный, данные — `apps/api/.data/compass/<workspaceId>` (SQLite самого Compass, не Postgres; у каждого пространства свой каталог, движок один — смена пространства его перезапускает). Только `ORION_MODE=local`. Окно Compass — песочный iframe во вкладке «Compass» панели «Рынки» (`panels/markets/compass-tab.tsx`). Нужен Python 3.11+ с `fastapi uvicorn pandas numpy ccxt httpx aiohttp anthropic` (`COMPASS_PYTHON` — путь к интерпретатору). Журнал/счета Compass пока живут в его SQLite, а сделки ORION — в Postgres; связь между ними — кнопка «Забрать журнал в ORION» (`POST …/markets/engine/sync-journal`: журнал из работающего движка → `importTrades`, идемпотентно по uid) или импорт файла резервной копии. Журнал, счета, планы, сигналы, оповещения, рисунки, прогнозы Compass остаются в его SQLite; перенос их в Postgres — не сделан. Вкладка «Compass» — его собственный React-бандл (`compass/static`) в рамке; остальные вкладки «Рынков» — **родные панели ORION** поверх API движка: `GET/POST/… workspaces/:id/markets/engine/api/*` — прокси (`CompassEngineService.proxy`: членство + `@RequireModule("markets")`, движок виден только по токену сессии; `/api/sim`, `/api/app`, `/api/live` не пробрасываются — симуляция и воспроизведение (replay) в ORION сознательно не перенесены). Клиент — `apps/web/lib/compass/` (`types.ts` и `api.ts` скопированы из Compass; `request` заменён на транспорт `setCompassTransport` → `ApiClient.compassRequest`; подключает `useCompassBinding` в `EngineGate` при **рендере**, не в эффекте), вкладки — `apps/web/panels/markets/*` (график на lightweight-charts, день/счета, журнал, сделка/планы, сигналы/оповещения/скринер, проверка: бэктест/вне выборки/лаборатория/прогноз, разбор/AI, крипта, настройки Compass). Журнал при каждом изменении переносится в «Сделки» ORION (`sync-journal`, идемпотентно). Типы `types.ts` зеркалят Compass: при изменении API движка обновляй их вручную.
- **Плагины** описаны в `docs/PLUGIN_EXTRACTION_LOG.md`; слоты — `apps/web/lib/extensions/contracts.ts`, регистрация —
  `apps/web/plugins/index.ts`. Сервер уважает выключенный плагин: `@RequirePlugin(id)` (409), `pluginOffWhere` в кронах.
- **Интеграции Compass / FinControl** — статус в конце `docs/INTEGRATIONS_COMPASS_FINCONTROL.md`; модуль `markets` по умолчанию выключен
  (`Workspace.disabledModules` по умолчанию `["markets"]`).

### Связи, подзадачи, вложения (v0.17)

- Связи между сущностями — `apps/web/components/entity-links.tsx`
  (`<EntityLinksSection workspaceId type id />`); это единственный UI для
  `entity_links`, подключай его в детали новой сущности одной строкой, а не
  пиши свой список.
- Подзадачи и ручной порядок задач живут в `apps/web/panels/tasks/subtasks.tsx`
  (чистые помощники: `parentOptions`, `orderColumnTasks`, `sortOrderForDrop`,
  `neighborSwap`). Выбор родителя обязан исключать потомков — API отвергает
  цикл 400.
- Вложения заметок не имеют своего хранилища: файл — обычный `Document` в
  папке «Вложения заметок», загрузка идёт через `DocumentsService.upload`.
  Отвязка удаляет **только связь**; байты удаляет `DocumentTrashPurgeService`.
- В контрактах есть **зарезервированные** схемы без кода
  (`financeImportResult`, `financeForecastPoint`, `documentAnnotation`,
  `shareSelector`, `connectionLink`) — они помечены комментарием
  «ЗАРЕЗЕРВИРОВАНО, кода нет». Не считать их описанием существующего API.
  Исключение: `documentVersion` (`packages/shared-types/src/document.ts`)
  **больше не зарезервирована** — с S03/S04 бэклога `DocumentVersion` реальная
  Prisma-модель с RLS, `GET .../:id/versions` отдаёт историю, а
  `blob-backup.service.ts` включает версии файлов в бэкап/восстановление (см.
  «Snapshot registry v2» ниже). `documentAnnotation` рядом в том же файле —
  по-прежнему только схема, сервисного слоя нет.

### Учёт времени (v0.18)

- `TimeEntry.endedAt = null` значит «таймер идёт». Длительность **не хранится**
  нигде: считай её `entryMinutes()` из `@orion/shared-types` — тот же расчёт
  использует сервер для DTO `minutes` и панель для тикающего таймера.
- «Один запущенный таймер на пространство» держит **партиальный уникальный
  индекс** в БД (`WHERE "endedAt" IS NULL`), а не проверка в сервисе: гонку
  двух вкладок сервис не поймает, а индекс — да. Лови `P2002` и отдавай 409.
- `projectId` в записи денормализуется из задачи — суммирование часов по
  проектам не должно превращаться в join по всем задачам.
- Стоимость времени считается по `Project.hourlyRate` (копейки за час,
  nullable) через `timeCostMinor()` из `@orion/shared-types`. **Неизвестная
  ставка — это `null`, а не `0`**: «не знаем» и «бесплатно» — разные
  утверждения, поэтому итог по проектам без ставки не досчитывается молча, а
  помечается как неоценённый.

### Привычки (v0.19)

- Отметка — `HabitEntry.day` типа `@db.Date` (день, а не момент), уникальна по
  `(habitId, day)`: `toggle` идемпотентен, двойной клик ловит база (P2002).
- **Клиент обязан передавать свой локальный день** (`habitLocalDayKey()`), иначе
  сервер подставит свой UTC-день и вечерняя отметка уедет на завтра.
  `habitDayKey` («день по UTC», то, что в `@db.Date`) и `habitLocalDayKey`
  («мой день») — разные вопросы, не объединяй их.
- `streak`/`dueToday`/`doneToday` **вычисляются**, не хранятся: единственная
  реализация — `habitStreak`/`isHabitScheduled` в
  `packages/shared-types/src/habit.ts`. Пустое расписание = каждый день;
  считаются только запланированные дни; сегодня «прощающее» (неотмеченный
  сегодняшний день не обнуляет серию).
- `DELETE /habits/:id` — архивация (история отметок сохраняется), как у
  проектов; возврат — `PATCH { archivedAt: null }`.
- Привычка — **не** задача: не переиспользуй `Task.recurrence` и `Task.status`,
  это разные модели (история — `docs/HISTORY.md`, v0.19).

### Списки (v0.2x: полный модуль)

- Модуль — для всего пространства: любой участник видит и правит любой список; кто отметил пункт, пишется в `checkedById`/`checkedAt` (ставится на переходе «не отмечен → отмечен», повторная отметка человека не меняет). Панель опрашивает сервер раз в `LISTS_POLL_MS` (15 с), поэтому семейный список обновляется без перезагрузки.
- Порядок — ручной: `List.sortOrder`/`ListItem.sortOrder` (шаг 10), `PUT lists/order` и `PUT lists/:id/items/order` принимают id «от первого к последнему», чужой id → 404. «Неотмеченные выше» — только отображение (`sortListItems`). Группы пункта — текст `section` (`groupListItems`: без группы первыми).
- Все чистые помощники (`parseListLine`/`parseListText` — «Молоко, 2 л», `# Группа`, `[x]`; `listProgress`, `formatListAsText`, …) живут в `shared-types/src/list.ts` с тестами. Цена пункта — `priceMinor`, **`null` = неизвестна, не 0** (итог по списку считает неоценённые отдельно).
- Шаблон — это список с `isTemplate` (в активном виде не показывается, `GET lists?templates=true`); «Дублировать»/`templateId` копируют пункты без отметок и без привязок к конкретной покупке (`stockedMovementId`, `expenseTransactionId`).
- «Очистить отмеченные» возвращает удалённые пункты **целиком** (`ListItemSnapshot`), «Отменить» → `POST …/items/restore` возвращает их под прежними id; ссылки на склад/операцию/автора при восстановлении перепроверяются по этому же пространству. Не пересоздавай пункты по тексту — потеряется связь со складом и можно дважды пополнить склад.
- Удалить список навсегда можно только из архива или шаблон (`DELETE lists/:id/permanent`, иначе 409); `DELETE lists/:id` по-прежнему архивирует.
- Панель одного списка — экземпляр `list:<id>` (`openList` в `panel-bus`, `panels/ListPanel.tsx`), доска `ListsPanel` показывает карточки-превью. `list` — тип сущности для общих связей (`EntityLinksSection type="list"`, поиск, `openEntity`); «пункт → задача» — `useCreateAndLink` (задача и связь с списком одной транзакцией).
- Быстрый ввод: `/купить молоко, 2 л` (`/список`, `/list`) кладёт текст в первый список вида «Покупки» (создаётся при первом использовании) — `resolveQuickCapture` + `lib/capture-to-list.ts`. Карточка «Списки» на дашборде отмечает пункты через те же `useListActions`, что и сам список, поэтому мост «Склад» срабатывает и там.
- Плагины-мосты: «Покупки → Склад» (ADR-0009) и «Покупки → Финансы» (`lists-finance`, тот же ADR): слоты `lists.item`, `lists.actions`, `lists.item.mark`. В пункте нет ссылок на чужие модули — только колонки-ключи, которые ведёт плагин.

### Release-hardening backlog (v0.20) — механизмы, которые надо знать

Актуальные релизные ворота — `docs/DEPLOYMENT_READINESS.md`; исторические
проверки и решения доступны через `docs/HISTORY.md` (v0.20).

- **`ORION_MODE` (local/server split).** `apps/api/src/common/orion-mode.ts`
  (`resolveMode()`) читает `ORION_MODE=local|server` (по умолчанию `local`,
  падает на любом другом значении) и определяет bind-host: `127.0.0.1`
  локально, `0.0.0.0` в `server` (если не переопределён `HOST`).
  `apps/api/src/common/jwt-secret.ts` (`resolveJwtSecret()`) падает при старте
  в `server`-режиме без `JWT_SECRET` — в `local` жив dev-фолбэк. В `server`
  выключен passwordless account picker (`GET /auth/accounts`, PIN-вход),
  обязателен пароль с `passwordScore >= 2`. `POST /auth/login` защищён
  `LoginRateLimitGuard` (10 попыток/5 мин, in-memory). Исходящие удалённые
  запросы (WebDAV remote, calendar ICS) идут через
  `apps/api/src/common/remote-url-guard.ts` (`assertPublicRemoteUrl`,
  `rejectRedirect`, лимит тела 5 МиБ) — SSRF-заслон. Веб-клиент (`login`/
  `register`) пока не различает режимы визуально — сервер просто отклоняет
  запрещённые в `server` пути 403/400; это известный UX-разрыв, не баг с точки
  зрения безопасности.
- **Snapshot registry v2 + blob-backup (бэкап/восстановление).**
  `apps/api/src/sync/snapshot-registry.ts` — `SNAPSHOT_MODEL_REGISTRY`,
  явный реестр **всех** workspace-scoped моделей с политикой `included` /
  `derived` / `identity-excluded` / `secret-excluded` / `ephemeral-excluded`.
  `snapshot.service.ts` при загрузке модуля сверяет список бэкапируемых моделей
  с `schema.prisma` через `Prisma.dmmf` — рассинхрон **валит процесс сразу**,
  а не тихо теряет таблицу при следующем бэкапе (так нашли 6 таблиц без
  бэкапа, включая `Milestone`/`DocumentVersion`/`DocumentAnnotation`).
  `SNAPSHOT_VERSION = 2` (v1 — legacy, `apply()` явно отвергает его отдельным
  сообщением, а не молча пытается применить). `toposortByParent()` сортирует
  самоссылающиеся строки (`Task.parentId`, `Document.parentId`) перед
  `createMany`.
  Байты файлов бэкапит `apps/api/src/sync/blob-backup.service.ts`
  (`BlobBackupService.collect()`/`.restore()`): sha256 считается **из
  реально прочитанных байт** через `StorageAdapter.getStream`, не из
  сохранённого в БД чек-сама. `.orion`-архив теперь `{ blobs, snapshot }`;
  старые архивы без блобов (до S04) отвергаются fail-closed. Восстановление —
  staging + journal + атомарный swap
  (`_restore-staging/<batchId>/...` → `_restore-old/<workspaceId>/<batchId>`),
  журнал переживает сам swap, `recover()` умеет продолжить прерванный своп.
  **Порядок важен**: блобы восстанавливаются **до** применения снапшота БД
  (`SyncService.restore()`), иначе `GET .../content` может отдать усечённое
  тело с Content-Length от новой строки БД. Известный пробел: нет проверки
  «протухшего» dry-run превью (manifest-hash между preview и apply) — S04
  подшаг 4 не сделан; WebDAV-бэкенд не покрыт fault-injection тестами (только
  `LocalDiskStorage`).
- **Notification recipientId/eventKey (адресные уведомления).**
  `Notification.recipientId` (nullable FK на `User`) — уведомление видно
  только адресату; RLS-политика `notifications_isolation` проверяет это на
  уровне Postgres, старые (безадресные, `recipientId=null`) строки остаются
  видимы всем участникам пространства. `eventKey` (nullable, частичный
  уникальный индекс `(recipientId, eventKey)`) — ключ идемпотентности
  дедупликации, например `task_due:<taskId>` или
  `event_reminder:<eventId>:<occurrenceStart>:<offset>`.
  `NotificationCenterService.createTx` **обязан** использовать
  `createMany({ skipDuplicates: true })`, а не `create()` + `catch(P2002)` —
  нарушение уникальности внутри `create()` внутри транзакции ломает всю
  транзакцию Postgres-ошибкой `25P02`, а не только текущую вставку.
  `NotificationPolicyService.allowsForUser(userId, kind)` — реальная
  per-user проверка через `UserPreference` (см. инвариант №8 выше);
  `allows(workspaceId, kind)` остался как обёртка через владельца.
  Адресат определяется продюсером: `DueTaskCheckerService` шлёт исполнителю
  задачи (`Task.assigneeId`) либо владельцу, `EventReminderService` и
  `BudgetAlertsService` — владельцу. **Первый actor-triggered продюсер**
  (не крон, а прямое действие пользователя) — комментарий к задаче (S17,
  см. ниже): такие продюсеры обязаны писать уведомление через
  `PrismaService.asSystem(...)`, а не в той же `withUser`-транзакции, что и
  само действие — иначе RLS-политика `notifications_isolation` (адресат ≠
  текущий actor) отклонит вставку ошибкой `42501`.
- **TimeEntry — actor ownership.** `TimeEntry.userId` (nullable,
  проставляется только сервером) — «один запущенный таймер» теперь
  композитный частичный уникальный индекс `(workspaceId, userId) WHERE
  "endedAt" IS NULL`, а не один индекс на пространство: раньше таймер
  одного участника блокировал старт таймера другому в том же пространстве.
  `running`/`start`/`stop`/`update`/`remove` фильтруют по вызывающему;
  унаследованные записи без `userId` (до миграции) правит автор **или** любой
  участник — осознанное решение, переназначение владельца админом не
  реализовано. `summarizeByAuthorship()` (`@orion/shared-types`) считает
  разбивку «моё/команда/автор неизвестен», но **не подключена** к
  `TimePanel`/`ProjectsPanel` — панели пока суммируют плоско; не выдавай эту
  функцию за подключённую фичу.
- **Note revision + CAS (конфликты автосохранения).** `Note.revision Int
  @default(1)`. `NotesService.update` делает атомарную проверку-и-запись
  одним запросом: `updateMany({ where: { id, revision: expectedRevision },
  data: { ..., revision: { increment: 1 } } })` — не read-then-compare.
  `count === 0` после подтверждённого существования заметки → `409` с телом
  `{ code: "note_revision_conflict", currentRevision, current }`.
  Клиент — `apps/web/lib/note-autosave.ts` (`NoteAutosave`): не более одного
  сохранения в полёте, «хвостовой» save после ответа сервера, если текст успел
  измениться ещё раз; конфликт — отдельное состояние с явным выбором
  «загрузить версию сервера» / «сохранить мою поверх» (не молчаливый мердж).
  **Заметки и задачи** — у задач то же самое (`Task.revision`, `expectedRevision`
  в `UpdateTaskInput`, 409 `task_revision_conflict`): автосохранение панели
  деталей его шлёт и при конфликте предлагает «загрузить версию сервера» /
  «сохранить мою поверх»; доска, перетаскивание и быстрые действия
  `expectedRevision` не шлют (last write wins), но тоже увеличивают ревизию.
  Проекты по-прежнему без CAS. Прямые Prisma-записи мимо
  `NotesService.update()` (`renameTag`/`deleteTag`/`restore`/
  `restoreRevision`) не увеличивают `revision` — задокументированный пробел,
  не скрытый баг.
- **TaskComment / TaskActivity.** Комментарии к задаче — CRUD под
  `workspaces/:id/tasks/:taskId/comments`, `userId` всегда проставляется
  сервером (в input-схеме поля `userId` физически нет), редактировать/удалять
  может только автор — модерации владельцем/лидом нет (не описана в
  `docs/08-TEAM-AND-ACCESS.md`, не придумывалась). `TaskComment.userId` —
  FK на `User`, а не на `WorkspaceMember`, поэтому авторство переживает выход
  участника из пространства. Рендер тела — тот же `MarkdownView`/
  `markdown-it` (`html:false`), что и у заметок, без отдельного санитайзера.
  `TaskActivity` — append-only журнал: `TasksService.update` сравнивает
  `status`/`assigneeId`/`dueAt` до/после и пишет строки в той же транзакции,
  что и само обновление задачи (голое переименование строк не создаёт).
  Создание комментария уведомляет `assigneeId` задачи через адресные
  уведомления (см. выше) — первый реальный actor-triggered продюсер в
  проекте, обязан идти через `asSystem`.
- **Recurring / inbox — ключ идемпотентности вместо in-process флагов.**
  `Transaction.(recurringRuleId, scheduledFor)` — уникальная пара
  (`recurringRuleId` nullable, `onDelete: SetNull`, удаление правила не стирает
  историю платежей). `RecurringCheckerService.materializeOne(ruleId)` берёт
  `SELECT ... FOR UPDATE` на строку правила внутри той же `asSystem`-транзакции,
  что создаёт `Transaction` и двигает `nextRunAt` — конкурентный тик того же
  правила блокируется на лок, затем видит уже сдвинутое окно и пропускает;
  уникальный индекс — резервный барьер (`P2002` → `skipped`, не падение).
  `scheduledFor` — всегда `rule.nextRunAt`, прочитанный под локом, никогда
  `new Date()`. Аналогичный паттерн для входящих: `InboxService.process()`
  атомарно захватывает элемент через `updateMany({ where: { id, workspaceId,
  processedAt: null }, data: { processedAt } })` — создаёт целевую сущность
  только если `count === 1`; проигравший запрос читает уже обработанную
  строку и отдаёт её `targetId`. **Паттерн для новых фоновых обработчиков с
  риском гонки: барьер в БД (лок строки или атомарный `updateMany`-claim +
  уникальный индекс), не проверка в коде до записи.**
- **`/invite?token=` — контракт статических ссылок-приглашений.**
  `apps/web/app/invite/page.tsx` — статический маршрут (не динамический
  `[token]`, тот несовместим с `output: "export"`, потому что Next не может
  перечислить рантайм-токены через `generateStaticParams`), читает `?token=`
  через `useSearchParams()` внутри `<Suspense>` (обязателен под Next 14
  static export); тот же паттерн у `login`/`register` для `?next=`.
  Возврат после входа — `apps/web/lib/return-to.ts`
  (`sanitizeReturnTo`): принимает только внутренние пути, отклоняет
  абсолютные URL, `//host`, `\`-трюки — открытый редирект недопустим.
  `InviteLookup.status: "pending" | "expired" | "used" | "revoked"` (было
  одно булево `expired`, схлопывавшее три разных состояния). Полный accept
  URL с токеном **не логируется** — только `workspace, invite id`; ссылка
  уходит клиенту через HTTP-ответ/буфер обмена.
  `pnpm build:desktop-export` — новая команда (`package.json`), собирает
  статический экспорт `apps/web/.next-desktop`; это единственный измеримый
  критерий готовности desktop-релиза, добавлен отдельным шагом в CI.
- **Desktop launcher — readiness и single-instance.**
  `scripts/readiness.mjs` (`pollReadiness`) опрашивает `GET /system/health`
  и различает `ready`/`wrong-service`/`crashed`/`timeout` — TCP-connect
  раньше не отличал живой ORION API от любого другого процесса на порту 4000.
  `scripts/launch-desktop.mjs` использует это вместо TCP-проверки и держит
  PID-lock (`tmp/orion-launch.lock`) — повторный запуск лаунчера видит явное
  сообщение и не стартует конфликтующий второй набор процессов. Это **не**
  `tauri-plugin-single-instance` (для него нужен Rust/Cargo, недоступный в
  агентских сессиях) — минимально достаточный Node-уровневый лок, не умеет
  фокусировать уже открытое окно. Production CSP в
  `apps/desktop/src-tauri/tauri.conf.json` больше не `null` — выведена чтением
  кода (`script-src 'self'`, `style-src 'self' 'unsafe-inline'` для
  Tailwind/CodeMirror, `worker-src 'self' blob:` для pdf.js, `connect-src
  'self' http://127.0.0.1:* http://localhost:*`). Ни CSP-совместимость, ни
  сам `tauri dev`/`tauri:build` не проверялись живьём ни в одной сессии
  бэклога — нет Rust/Cargo/Tauri CLI в среде агента.
