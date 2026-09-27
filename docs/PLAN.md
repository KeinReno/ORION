# ORION — план

## v0: ядро (СДЕЛАНО)

Монорепозиторий поднят и закоммичен (`3246a54`): NestJS + Prisma + Postgres
(`apps/api`, модули `auth`/`workspaces`/`notes`), общий TS-core
(`packages/shared-types`, `core`, `core-react`, `ui`), Next.js веб
(`apps/web`) и тонкий Tauri-десктоп (`apps/desktop`), собранный в реальный
`.exe`/NSIS-инсталлятор. Сознательно отложено: offline-sync, Postgres RLS
(сейчас проверка на уровне кода — `WorkspacesService.assertMember`),
refresh-токены. "Заметки" были только proof-of-pipeline.

## v0.1: модуль "Задачи" + уведомления + календарь (СДЕЛАНО)

### Контекст

Первый настоящий бизнес-модуль поверх ядра. Выбор пал на таск-трекер
(вместо CRM/финансов) — он опирается на уже начатые в `.autopilot.json`
хуки для уведомлений и годится для ведения задач по ORION/Stella
Mortis/GMap сразу. По ходу обсуждения выяснилось: `.autopilot.json` в
корне — конфиг с заглушками (`YOUR_BOT_TOKEN_HERE`), похоже, от другого
инструмента, не читается кодом ORION — уведомления делаем отдельным,
собственным конфигом в `apps/api/.env`.

Требования, уточнённые с пользователем:
1. Telegram-уведомления о просроченных задачах — подготовить полностью, но
   без реального токена сейчас: должно работать в "dry-run" (лог в консоль),
   а после того как в `.env` впишут `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
   — заработать без единой правки кода.
2. Плюс нативные уведомления Windows — как подстраховка, через сам
   Tauri-десктоп (пока приложение открыто; не фоновая служба).
3. Полноценный календарь — чтобы сразу ориентироваться по датам, не только
   список/канбан.

### Модель данных (Prisma, `apps/api/prisma/schema.prisma`)

Новая модель `Task` рядом с `Note`, тот же паттерн (id, workspaceId, ...):
- `title`, `description?`
- `status`: enum `todo | in_progress | done`
- `dueAt`: `DateTime?`
- `projectTag`: `String?` (свободная метка — "ORION" / "Stella Mortis" / "GMap")
- `notifiedAt`: `DateTime?` — когда сервер уже отправил Telegram по этой
  задаче, чтобы не слать повторно каждый цикл крона.

### Бэкенд (`apps/api/src`)

- **`tasks/`** — `TasksModule`/`TasksController`/`TasksService`, один в один
  повторяет структуру `notes/` (`workspaces/:workspaceId/tasks`,
  `WorkspacesService.assertMember` для скоупинга, zod-пайп для валидации).
- **`notifications/`** — новый модуль:
  - `telegram.service.ts`: `sendMessage(text)` — если
    `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` заданы в `.env`, реальный POST на
    `https://api.telegram.org/bot<token>/sendMessage`; иначе
    `console.log('[notifications] (dry-run) ' + text)`. Никакой ветки кода
    менять не придётся, когда токен появится — только `.env`.
  - `due-task-checker.service.ts`: через `@nestjs/schedule` (`@Cron`, раз в
    15 минут) выбирает задачи с `dueAt <= now()`, `status != done`,
    `notifiedAt IS NULL`, шлёт `TelegramService.sendMessage`, проставляет
    `notifiedAt`.
  - Новая зависимость `@nestjs/schedule`, `ScheduleModule.forRoot()` в
    `AppModule`.
- `apps/api/.env.example` и локальный `.env` — добавить
  `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_CHAT_ID=` (пустые по умолчанию).

### Общий core (пакеты)

- `packages/shared-types/src/task.ts` — `taskSchema`,
  `createTaskInputSchema`, `updateTaskInputSchema`, `taskStatusSchema`.
- `packages/core/src/api/api-client.ts` — `listTasks`, `createTask`,
  `updateTask`, `deleteTask` (тот же паттерн, что `*Note` методы).
- `packages/core-react` — `use-tasks.ts`: `useTasks`, `useCreateTask`,
  `useUpdateTask`, `useDeleteTask` (копия `use-notes.ts`).

### Фронтенд (`apps/web`)

- **`/tasks`** — канбан-лайт в 3 колонки (todo/in_progress/done), карточка
  задачи показывает `projectTag` и `dueAt`, кнопки смены статуса,
  создание/редактирование/удаление — стиль как у `/notes`.
- **`/calendar`** — новый месячный грид (свой компонент в
  `packages/ui/src/calendar.tsx`, без внешней библиотеки): навигация
  вперёд/назад по месяцам, подсветка сегодняшнего дня, в ячейках дней —
  небольшие "пилюли" задач с `dueAt` в этот день, клик по пилюле
  прокручивает/подсвечивает задачу.
- `lib/module-registry.ts` — добавить пункты "Задачи" и "Календарь".

### Windows-уведомления (только в Tauri, пока окно открыто)

- Добавить `@tauri-apps/plugin-notification` (JS) и
  `tauri-plugin-notification` (Rust) — единственное реальное расширение
  "тонкого" Tauri-слоя за весь проект, и оно оправдано: показ нативного
  тоста — это платформенный биндинг, а не бизнes-логика. Регистрируется в
  `apps/desktop/src-tauri/src/main.rs` через `.plugin(...)`, право
  `notification:default` — в `capabilities/default.json`.
- В `apps/web` (общий код, выполняется и в браузере, и в Tauri-вебвью) —
  хук `useDesktopDueReminders()`: определяет, что выполняется внутри Tauri,
  раз в минуту сверяет уже загруженные через `useTasks` просроченные задачи
  со списком id, по которым уже показывали тост в этой сессии
  (`localStorage`), и вызывает `sendNotification()` из плагина. Это
  курьерское, посессионное напоминание, а не надёжный фоновый сервис — и
  сознательно не больше того.

### Порядок реализации

1. Prisma-модель `Task` + миграция.
2. `tasks/` модуль бэкенда (CRUD, зеркало `notes/`).
3. `notifications/` модуль (Telegram dry-run + `@nestjs/schedule` крон).
4. `shared-types`/`core`/`core-react` для задач.
5. Страница `/tasks` + пункт в сайдбаре.
6. `packages/ui/calendar.tsx` + страница `/calendar` + пункт в сайдбаре.
7. Tauri-плагин уведомлений + хук `useDesktopDueReminders`.

### Проверка

1. `pnpm db:migrate` — новая таблица `tasks` создаётся.
2. API: создать задачу с `dueAt` в прошлом → в логе API появляется
   `[notifications] (dry-run) ...` в течение 15 минут (или вызвать метод
   крона вручную для быстрой проверки).
3. Веб: `/tasks` — создать/сменить статус/удалить задачу; `/calendar` —
   задача с `dueAt` отображается в правильной ячейке месяца.
4. Desktop (`tauri dev`): задача с прошедшим `dueAt` → нативный тост
   Windows появляется один раз за сессию.
5. Вписать реальные `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` в `.env`,
   перезапустить API, убедиться что вместо dry-run лога приходит реальное
   сообщение в Telegram.

## v0.2: настоящий Postgres RLS (СДЕЛАНО)

### Контекст

Первый пункт из отложенного в v0 техдолга (по порядку: RLS, затем
refresh-токены — это следующий этап после текущего). Сейчас изоляция между
рабочими пространствами держится только на том, что каждый сервис-метод не
забывает вызвать `WorkspacesService.assertMember` и добавить `where:
{workspaceId}` в запрос. Это работает, но одна забытая проверка в новом
модуле — и данные одного пространства станут видны другому. RLS переносит
эту гарантию на уровень самой базы: даже если код где-то забудет фильтр,
Postgres физически не отдаст чужие строки.

### Механизм (важные нюансы, не только "включить RLS")

- Тот же Postgres-пользователь (`orion`), что обслуживает обычные запросы,
  является и владельцем таблиц — а владельцы по умолчанию **обходят** RLS.
  Поэтому включаем `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, иначе вся
  функция окажется бутафорской (ровно тот "фиктивный предохранитель", о
  котором мы говорили на примере бага FinControl).
- Каждый запрос должен явно сообщить Postgres, кто он: через
  `SET LOCAL app.current_user_id = '<userId>'` в рамках транзакции.
  Политики RLS сверяются с `current_setting('app.current_user_id', true)`.
- **Три места, где это ломает наивную реализацию, если не учесть заранее:**
  1. Крон-джоб просроченных задач (`DueTaskCheckerService`) обходит все
     рабочие пространства сразу — у него нет "текущего пользователя". Для
     него нужен официальный, документированный обход:
     `SET LOCAL row_security = off` (доступно владельцу таблицы даже при
     FORCE RLS — это осознанный, видимый в коде обход, а не дыра).
  2. Регистрация (`AuthService.register`) создаёт workspace и
     workspace_member в одной транзakции, но политика на `workspaces`
     проверяет "есть ли уже membership" — а на момент создания самого
     workspace membership ещё не существует (курица и яйцо). Регистрация —
     по сути системная операция бутстрапа, а не запрос от лица
     существующего пользователя с доступом к чему-то, поэтому её
     транзakция тоже идёт через `row_security = off`.
  3. `WorkspacesService.assertMember`/`listForUser` тоже обязаны сами
     проходить через `withUser(...)`, иначе после включения FORCE RLS они
     будут получать пустой результат даже для легитимного владельца.
- `assertMember` как явная проверка с понятным `403 Forbidden` **остаётся**
  — RLS не заменяет её, а подстраховывает. Без явной проверки на уровне
  кода пользователь просто получал бы пустой список вместо внятной ошибки.

### Реализация

- `apps/api/src/common/prisma.service.ts` — два новых метода:
  - `withUser<T>(userId, fn)`: `$transaction` с
    `SELECT set_config('app.current_user_id', $1, true)` в начале.
  - `asSystem<T>(fn)`: `$transaction` с `SET LOCAL row_security = off` в
    начале — для кода, который осознанно работает поверх всех пространств.
- Новая Prisma-миграция (raw SQL, `prisma migrate dev --create-only`):
  `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE
  POLICY` для `workspace_members`, `workspaces`, `notes`, `tasks`.
  `users` RLS не получает — вход/регистрация должны искать по email без
  ограничений, до того как личность вообще установлена.
- `notes.service.ts`, `tasks.service.ts` — каждый вызов `this.prisma.*`
  оборачивается в `this.prisma.withUser(userId, (tx) => tx.note...)`.
- `workspaces.service.ts` — `assertMember`/`listForUser` через `withUser`.
- `auth.service.ts` — транзakция в `register()` — через `asSystem`.
- `notifications/due-task-checker.service.ts` — `runCheck()` — через
  `asSystem`.

### Проверка

1. Применить миграцию, перезапустить API.
2. Обычный сценарий (KAI): логин → список задач/заметок по-прежнему виден,
   создание/редактирование/удаление работает как раньше — RLS невидим для
   легитimного пользователя.
3. Регистрация нового пользователя всё ещё создаёт личное пространство
   (проверяет обход в `register()`).
4. Ручная проверка изоляции: создать второго пользователя, попытаться
   запросить `workspaces/:чужой-id/notes` под его токеном → 403 от
   `assertMember` (не 500 и не "тихо пустой список" от RLS).
5. `POST /notifications/check-due` с просроченной задачей в пространстве
   KAI по-прежнему находит и уведомляет — подтверждает, что
   `asSystem`-обход в кроне действительно виден все пространства.

## v0.3: refresh-токены с ротацией (СДЕЛАНО)

### Контекст

Последний пункт из техдолга, отложенного в v0. Сейчас `AuthService` выдаёт
только один access-JWT на 1 день — либо сессия живёт неудобно долго с
невозможностью отозвать её раньше времени, либо (если укоротить TTL)
пользователя будет разлогинивать каждый час. Нужна пара токенов: короткий
access (для API-запросов) + долгий refresh (только чтобы получить новый
access), с ротацией — каждый refresh-токен одноразовый, использование
порождает новую пару и гасит старую. Ровно тот паттерн, что мы разбирали
как сильную сторону FinControl (`POST /auth/refresh`, `logout-all`).

### Модель данных

Новая таблица `RefreshToken` (без RLS — это identity-слой, как `users`, не
workspace-scoped данные):
- `id`, `userId` (FK на `User`, `onDelete: Cascade`)
- `tokenHash` — хранится хэш, не сам токен (утечка БД не должна давать
  готовые сессии), уникальный индекс
- `expiresAt`, `revokedAt?`, `replacedById?` (self-relation — цепочка
  ротации для аудита), `createdAt`

### Бэкенд (`apps/api/src/auth`)

- `auth.service.ts`:
  - `hashToken(raw)` — sha256 (не argon2: это уже случайная строка с
    полной энтропией, не пароль, медленный хэш тут не нужен).
  - `issueTokenPair(user)` — общий метод для register/login/refresh:
    короткий access JWT (`JWT_EXPIRES_IN=15m`) + новый refresh (случайные
    48 байт, hex), сохраняет хэш в БД с `expiresAt = now + REFRESH_TOKEN_TTL_DAYS (30)`.
  - `refresh(rawToken)`: находит по хэшу активный (не отозван, не истёк)
    токен → отзывает его (`revokedAt`, `replacedById` на новый) → выдаёт
    новую пару. Просроченный/чужой/уже использованный токен → 401.
  - `logout(rawToken)`: отзывает конкретный refresh-токен (идемпотентно).
  - `logoutAll(userId)`: отзывает все активные refresh-токены пользователя.
- `auth.controller.ts`: `POST /auth/refresh`, `POST /auth/logout` (без
  JWT-гварда — предъявленный refresh-токен сам по себе учётные данные),
  `POST /auth/logout-all` (под `JwtAuthGuard`, отзывает по access-токену).
- `shared-types/src/auth.ts`: `AuthResponse` получает `refreshToken`;
  `refreshInputSchema`/`logoutInputSchema` — `{ refreshToken: string }`.
- `.env`/`.env.example`: `JWT_EXPIRES_IN` → `15m` (было `1d`),
  `REFRESH_TOKEN_TTL_DAYS=30`.

### Общий core / фронтенд

- `packages/core/src/auth/token-store.ts`: хранит access и refresh раздельно
  (`orion.auth.accessToken` / `...refreshToken`).
- `packages/core/src/api/api-client.ts`:
  - `register`/`login` сохраняют оба токена.
  - `refreshAccessToken()` — вызывает `/auth/refresh`, сохраняет новую пару.
  - `request()` — при 401 (и это не сам `/auth/refresh`/`/auth/login`) один
    раз пробует `refreshAccessToken()` и повторяет исходный запрос; если
    рефреш тоже не удался — чистит токены и пробрасывает исходную ошибку
    (пользователь увидит экран логина через уже существующий `useSession`).
  - `logout()` — шлёт `/auth/logout` с refresh-токеном (best-effort), затем
    чистит локальное хранилище.
- Frontend-код `useSession`/`useLogin`/`useRegister`/`useLogout` не
  меняется по форме — вся логика инкапсулирована в `ApiClient`.

### Проверка

1. Логин → в `localStorage` (веб) появляются оба токена; access реально
   короткий (проверить `exp` в JWT).
2. Подождать/принудительно поставить `JWT_EXPIRES_IN=5s` на время теста →
   через 5 секунд обычный запрос (например, список задач) не падает
   видимой ошибкой — `ApiClient` тихо обновляет токен через `/auth/refresh`
   и повторяет запрос.
3. Использовать один и тот же refresh-токен дважды вручную (curl) → второй
   раз 401 (ротация: токен одноразовый).
4. `POST /auth/logout-all` → все старые refresh-токены отозваны, следующий
   `/auth/refresh` с любым из старых 401.
5. Полный сценарий в браузере под KAI: логин → работа с задачами →
   логаут → редирект на `/login`, повторный логин работает.

## v0.4: багхант — 5 проходов code-review + фиксы (СДЕЛАНО)

5 проходов `code-review` (общий, security-фокус на RLS/ролях, фронтенд,
desktop/UI, финальный full-sweep max). 11 подтверждённых находок, все
исправлены и перепроверены живым сценарием (не только typecheck):

- **RLS был полностью бутафорским**: `orion` — суперпользователь Postgres
  (`rolsuper=t, rolbypassrls=t`), суперюзеры игнорируют RLS независимо от
  FORCE. Решение: `infra/postgres/init/01-app-roles.sql` заводит
  `orion_app` (NOSUPERUSER, NOBYPASSRLS — на нём RLS реально действует) и
  `orion_system` (NOLOGIN, BYPASSRLS, выдан через `GRANT` orion_app).
  `PrismaService` теперь коннектится через `APP_DATABASE_URL` (orion_app);
  `asSystem()` делает `SET LOCAL ROLE orion_system` вместо неверного
  `SET LOCAL row_security = off` (это работало только благодаря тому, что
  роль была суперпользователем — для обычной роли-владельца эта настройка
  не даёт обход, а роняет запрос ошибкой). Существующий контейнер обновлён
  вручную (`docker exec ... psql < 01-app-roles.sql`), новые окружения
  получат роли автоматически через `docker-entrypoint-initdb.d`.
- `/notifications/check-due` был доступен любому авторизованному
  пользователю и сканировал все пространства — `DueTaskCheckerService`
  разделён на `runCheck()` (система, только крон) и `runCheckForUser()`
  (только свои пространства через `withUser`, вызывается контроллером).
- Гонка при ротации refresh-токена — отзыв теперь один атомарный
  `updateMany({ revokedAt: null })`; проигравший запрос откатывает и свою
  свежевыпущенную пару.
- `replacedById` хранил хэш вместо id новой записи — исправлено.
- Неудачная отправка в Telegram всё равно помечала задачу как
  уведомлённую — `sendMessage` теперь возвращает `boolean`, `notifiedAt`
  проставляется только при реальной доставке.
- Перенос `dueAt` у уже уведомлённой задачи не давал повторного
  уведомления — `notifiedAt` сбрасывается при изменении `dueAt`.
- `toDatetimeLocal` на `/tasks` сдвигал время на UTC-офсет при каждом
  сохранении — переписан на локальные компоненты даты.
- Любая ошибка (не только 401) в `useSession` стирала refresh-токен —
  теперь только настоящий `ApiError` со статусом 401.
- Гонка в `useDesktopDueReminders` могла показать один тост дважды —
  id теперь резервируются синхронно, до `await` на permission-check.
- Кнопки `Calendar` без `type="button"` — добавлено.
- 3 отдельные транзакции на один запрос (assertMember/getOwned/мутация) —
  `NotesService`/`TasksService` сведены к одной `withUser`-транзакции на
  метод; `WorkspacesService.assertMemberTx` работает поверх чужого `tx`.

Проверено вживую: логин, регистрация нового юзера (bootstrap через
`orion_system`), кросс-пространственный доступ (403, теперь подкреплён
настоящим RLS — проверено напрямую через `psql` от имени `orion_app` с/без
`app.current_user_id`), scoped-уведомления, гонка refresh-токена (ровно
1 успех из 2 параллельных), повторное уведомление после переноса срока.

## v0.5: Obsidian-style докинг панелей (СДЕЛАНО)

### Контекст

Пользователь хотел свободно расставлять модули (Задачи/Календарь/Заметки)
внутри окна — двигать, закреплять слева/справа/сверху/снизу, разбивать на
вкладки, как в Obsidian/Cursor, плюс возможность вынести панель в отдельное
окно. Своя реализация докинг-менеджера с нуля не рассматривалась — резать
resize/drag-таргеты/вкладки/сериализацию с нуля не стоит того, когда есть
готовые библиотеки. Сам Obsidian — закрытый исходный код (публичны только
типы его plugin API, не реализация workspace), поэтому взят открытый
**dockview** (`dockview` + `dockview-react`, MIT — самый живой и активно
поддерживаемый вариант среди `flexlayout-react`/`rc-dock`/`golden-layout`,
нулевые зависимости, табы/группы/грид/сплиты/drag-and-drop/попаут из коробки).

**Десктоп и браузер решены по-разному** из-за одного нюанса: popout
dockview жёстко завязан на `window.open()` без точки расширения. В Tauri v2
`window.open()` по умолчанию открывает системный браузер, а не нативное
окно приложения — то есть встроенный popout dockview в десктопе увёл бы
пользователя из приложения. Решение: в браузере — родной popout dockview
(`public/popout.html`, там `window.open()` и так открывает обычное окно
браузера); в Tauri — своя кнопка «открепить в окне»
(`DetachHeaderAction` в `apps/web/app/(app)/layout.tsx`) через
`@tauri-apps/api/webviewWindow`, открывающая отдельный нативный маршрут
`/panel/[panelId]` с той же панелью и закрывающая исходную. Это не полный
drag-за-край-экрана, как в Obsidian, а явное действие кнопкой — осознанный
компромисс ради скорости (см. «Осознанные упрощения v0» в `CLAUDE.md`).

### Смена модульного контракта: роуты → панели

Next.js layout (`(app)/layout.tsx`) не размонтируется при переходах между
дочерними роутами, а страницы — размонтируются. Значит рабочая область
должна быть **одним постоянным Workbench**, живущим в layout, а не набором
страниц — иначе переключение между модулями каждый раз теряло бы их
состояние. Модуль теперь = запись в `apps/web/lib/panel-registry.ts` (`id`,
`label`, `icon`, компонент-панель) + пункт в сайдбаре, который по клику
открывает/фокусирует панель в доке через `DockviewApi.addPanel` (или
`panel.api.setActive()`, если уже открыта — без дублей), а не делает
`router.push`.

Четыре существующие страницы (`app/(app)/{tasks,calendar,notes,dashboard}/page.tsx`)
превратились в чистые компоненты `apps/web/panels/*Panel.tsx` без
роут-обвязки. Единственное поведенческое отличие — `TasksPanel`: раньше
переход по клику на пилюлю календаря нёс `?focus=id` в URL и
`useSearchParams` в `/tasks` подсвечивал и скроллил к задаче; у панелей нет
URL, поэтому появился `apps/web/lib/panel-bus.ts` — маленький pub/sub
(`focusTask(id)` → открывает панель "tasks" и уведомляет подписчиков,
`useFocusedTaskId()` — хук подписки). Старые роуты `/tasks`, `/calendar`,
`/notes` остались как тонкие редиректы на `/dashboard` ради старых
закладок; `/dashboard` сам ничего не рендерит — Workbench открывает панель
дашборда по умолчанию, если нет сохранённой раскладки.

### Реализация

- `packages/ui/src/workbench.tsx` — тонкая обёртка над `DockviewReact`
  (тема `themeAbyss`), пробрасывает `components` и `rightHeaderActionsComponent`,
  отдаёт `DockviewApi` через `onReady`.
- `apps/web/panels/{Dashboard,Tasks,Calendar,Notes}Panel.tsx` — перенесённое
  содержимое старых страниц.
- `apps/web/lib/panel-registry.ts` — реестр модулей (зеркало старого
  `module-registry.ts`, который удалён как мёртвый код).
- `apps/web/lib/panel-bus.ts` — межпанельная коммуникация без URL.
- `packages/ui/src/sidebar.tsx` — `SidebarLinkItem` получил `onClick` и
  `isActive` как альтернативу `href`/`activeHref`.
- `apps/web/app/(app)/layout.tsx` — рендерит `<Workbench />` один раз;
  `onReady` восстанавливает раскладку из `localStorage`
  (`orion.dockLayout`) через `fromJSON`, иначе открывает дашборд по
  умолчанию; `onDidLayoutChange` (дебаунс 300мс) сохраняет `toJSON()`
  обратно. `DetachHeaderAction` — кнопка «открепить» для Tauri.
- `apps/web/app/panel/[panelId]/page.tsx` (+ `panel-window.tsx`) —
  отдельный маршрут вне `(app)`-группы для попаут-окна: без
  сайдбара/Workbench, только выбранная панель. `generateStaticParams()`
  перечисляет `panelRegistry`, т.к. десктопная сборка — статический экспорт
  без сервера.
- `apps/web/public/popout.html` — пустой шаблон для браузерного popout
  dockview (сам dockview переносит DOM панели и копирует стили после
  загрузки — рендерить тут нечего).
- `apps/desktop/src-tauri/capabilities/default.json` — добавлены
  `core:webview:allow-create-webview-window` и `core:window:allow-create`
  (нужны для создания окна из JS; ни один не входит в `core:default`).

### Проверка

`pnpm typecheck && pnpm lint && pnpm test` — чисто (15/15 тестов). Живая
проверка в браузере/`tauri dev` (drag-to-dock, restore из localStorage,
popout, детач-кнопка, фокус задачи из календаря) на момент написания ещё
не проводилась — Docker/Postgres временно выключены пользователем
намеренно, поднимать без спроса нельзя (см. `CLAUDE.md`).

## v0.6: дизайн-система + переработка панелей (СДЕЛАНО)

### Контекст

После v0.5 панели остались «скелетом»: моно-палитра на `white/[0.03]`,
ноль семантических токенов, дашборд — приветствие и одна карточка, у
«Заметок» нет ни поиска, ни детального вида, у «Задач» статус меняется
кнопками `→`, календарь — только чтение и только месяц. Пользователь
попросил переработать вид всех режимов, ориентируясь на
Aceternity UI / shadcn/ui / Headless UI.

**Решение по зависимостям — ноль новых рантайм-пакетов.** Единственный
добавленный — `react-dom` в `peerDependencies` `@orion/ui` (+
`@types/react-dom` в dev) ради `createPortal`: он и так стоит в воркспейсе,
`pnpm install --offline` только перелинковал. Overlay-примитивы
(Modal/Sheet/DropdownMenu/Popover/Toast), command-палитра, drag-and-drop
задач — всё написано руками на React + уже присутствующем `framer-motion`.
shadcn взят как **словарь** (имена токенов `background`/`foreground`/
`muted-foreground`/`border`/`accent`/`destructive`, набор примитивов),
Aceternity — как **точечные эффекты** (Bento-грид дашборда, радиальное
свечение на дашборде и логине; TiltCard уже был), Headless UI —
концептуально, реализация своя, чтобы не тянуть Radix.

### Что сделано

- **Токены** (`apps/web/tailwind.config.js` `theme.extend.colors` — плоский
  hex, одна тёмная тема, все токены работают с `/opacity`; `globals.css` —
  тонкие скроллбары `.orion-scroll`, гармонизация `themeAbyss` под токены).
- **`packages/ui` — новые файлы** (зеркалят уже раздельные
  `sidebar.tsx`/`calendar.tsx`/`tilt-card.tsx`, `sidebar.tsx`/`workbench.tsx`
  по-прежнему не трогаются при добавлении модуля):
  - `panel-shell.tsx` — `PanelShell` / `PanelBody` / `PanelHeader` /
    `PanelSection`. Убирает копипасту
    `flex h-full flex-col gap-6 overflow-y-auto p-8` из всех панелей.
  - `overlays.tsx` — `Modal`, `Sheet` (+`bare`), `DropdownMenu`, `Popover`
    (fixed-позиционирование от rect триггера — работает в клиппящей ячейке
    календаря). Портал в `document.body`, Escape + клик-вне, lock скролла.
  - `toast.tsx` — `ToastProvider` + `useToast` (стек справа внизу,
    авто-скрытие, опциональная кнопка «Отменить»). Смонтирован в
    `apps/web/lib/providers.tsx` → доступен и в `(app)`, и в `/panel/[id]`.
  - `hooks.ts` — `useResizeWidth` (ResizeObserver — панель в доке резайзится
    независимо от вьюпорта), `useOnClickOutside`, `useEscapeKey`,
    `useMounted`, `useHotkey`.
  - `primitives.tsx` дополнен: `IconButton`, `Badge`, `Kbd`, `Skeleton`,
    `Spinner`, `EmptyState`, `SegmentedControl`, `Select`, `Divider`, `cx`;
    `Button` получил `outline`/`subtle` варианты и `size`.
  - `calendar.tsx` переписан: виды **Месяц / Неделя / Список**, клик по дню
    (`onDayClick`), перенос задачи перетаскиванием (`onItemDrop`, HTML5
    DnD), пилюли красятся по `projectTag` (стабильный HSL), overflow-день —
    в `Popover`, навигация `←/→/T` с фокусом на гриде.
- **`ConfirmDialog`** в `overlays.tsx` (поверх `Modal`) — да/нет для
  необратимых удалений (нет restore-эндпоинта); используется в Notes и Tasks.
- **`apps/web/lib`**: `format.ts` (`relativeTime` «2 часа назад»,
  `shortDateTime`, `dueBucket`, `projectColor` — та же хеш-раскраска, что в
  календаре, `to/fromDatetimeLocal` перенесены сюда из `TasksPanel`),
  `command-center.tsx` (⌘K палитра: действия «Новая задача»/«Новая заметка»
  с префиллом быстрого ввода + переходы к панели/задаче/заметке; ⌘⇧N —
  быстрый ввод из любого места; общаются с доком только через `panel-bus`),
  `panel-bus.ts` получил `focusNote` /
  `useFocusedNoteId` (обобщён `makeFocusChannel`).
- **Панели**:
  - `DashboardPanel` — Bento-грид: герой (TiltCard, приветствие по времени
    суток), быстрый ввод, баннер просрочки, тайлы «Сегодня» / «Ближайшее» /
    «Прогресс» / «Проекты» / «Недавние заметки», пустое состояние,
    скелетоны.
  - `NotesPanel` — мастер-деталь (две колонки при ширине панели ≥720px,
    иначе список + `Sheet`-редактор), поиск, сортировка
    (Изменённые/Созданные/А–Я), hover-действия через `DropdownMenu`
    (дублировать/удалить), относительное время, скелетоны. Удаление — через
    `ConfirmDialog` (restore-эндпоинта нет, откат невозможен).
  - `TasksPanel` — DnD между колонками (HTML5), группировка
    по статусу / проекту / сроку, фильтр-чипы по проектам, поиск,
    чекбокс-переключатель «готово», карточка с цветным тегом и чипом срока,
    `Sheet` с деталями, `Modal` «новая задача», колонка «Готово»
    сворачивается до 5 карточек («Показать все»), удаление — через
    `ConfirmDialog`. Форма вынесена в `panels/task-form.tsx` — ровно тот
    раздел файла, который CLAUDE.md называет допустимым для разреза
    (доска ↔ форма задачи, файл > ~400 строк).
  - `CalendarPanel` — прокидывает новые пропсы `Calendar`: `onDayClick` →
    `Modal` с `TaskForm` (`defaultDueAt` = день), `onItemDrop` → перенос
    срока с тостом.
- **Сайдбар**: слот `header` (аватар + имя воркспейса), подсветка активной
  панели (`onDidActivePanelChange` в layout → `isActive`), бейдж числа
  просроченных у «Задач». API обратно совместим (все новые пропсы
  опциональны).
- **`eslint.config.mjs`** — в `ignores` добавлен `**/.next-desktop/**`
  (сборка `build:desktop` писала артефакт, который линтер разбирал → 3.7k
  ложных ошибок; `.next` и `out` уже игнорировались, это добор той же
  дыры).

### Отложено на бэкенд (следующий шаг, нужен работающий Postgres)

Чистый фронт сделан целиком; для этого нужен полный вертикальный срез по
чек-листу «добавить модуль» + RLS-миграция, поэтому не трогалось при
выключенном Docker:

- `Task.priority` (`low|normal|high`) — точка-индикатор и сортировка на
  карточке; сейчас «срочность» выводится только из близости `dueAt`
  (`dueBucket`).
- `Note.pinnedAt` — закреплённые заметки сверху списка.
- Теги заметок как отдельная сущность (пока переиспользуется идея
  `projectTag` только у задач).
- Дата у заметки → показ заметок в календаре.
- Серверный полнотекстовый поиск (сейчас весь поиск — клиентский фильтр по
  уже загруженному списку).
- Markdown-рендер тела заметки — отложен как продуктовое решение (пока
  `whitespace-pre-wrap`), не привязан к бэку, но требует новой зависимости.

### Проверка

`pnpm typecheck` (7/7 пакетов) · `pnpm lint` (чисто) · `pnpm test` (15/15) ·
`pnpm --filter @orion/web build` и `build:desktop` (14/14 страниц) —
перепроверено самостоятельно после переноса изменений, не только со слов.

Docker/Postgres к этому моменту снова подняты (том `postgres_orion_pgdata`
и роли `orion_app`/`orion_system` пережили простой), поэтому живую
серверную проверку удалось довести до конца:

- `dev:api` (:4000) и `dev:web` (:3010) подняты; под существующим
  пользователем KAI (`kai@orion.kaiden`) `/auth/login` → `/workspaces/me` →
  `/workspaces/:id/tasks|notes` отдают реальные данные — бэкенд не
  затронут переработкой и продолжает работать как раньше.
- Первый прогон `/panel/[panelId]` через уже работавший (со времён v0.5)
  `next dev` дал 500 — протухшее HMR-состояние webpack не подхватило
  объём правок другого агента на лету. После чистого перезапуска
  `dev:web` все маршруты (`/login`, `/dashboard`,
  `/panel/{tasks,notes,calendar,dashboard}`) компилируются и отдают 200
  без ошибок. Вывод на будущее: после того как параллельная сессия трогает
  много файлов воркспейса под уже запущенным `next dev`, дешевле
  перезапустить дев-сервер, чем доверять его инкрементальному кэшу.
- Интерактивная часть (drag-and-drop задач/календаря, ⌘K, Sheet/Modal/
  Popover, попаут, кнопка «открепить» в Tauri) по-прежнему не пройдена
  глазами — для этого нужен реальный клик в браузере/`tauri dev`, не
  автоматизированный в этой сессии.

## v0.7: техдолг v0.6 — приоритет, pin, теги, дата у заметки, поиск (СДЕЛАНО)

### Контекст

Пользователь выбрал сначала закрыть backend-хвосты v0.6 (Docker к этому
моменту снова поднят), прежде чем начинать третий бизнес-модуль
(выбран — финансовый трекер, следующий по счёту). Это не новые модули, а
полный вертикальный срез по чек-листу «добавить модуль» поверх уже
существующих `Task`/`Note` — модульный контракт (CLAUDE.md) не меняется.

### Модель данных (миграции)

Две миграции: `task_priority_note_pin_tags_event` (обычные Prisma-поля) и
отдельно `search_fulltext_indexes` (raw SQL, GIN-индексы) — сознательно не
одной, чтобы функциональные индексы можно было проверить/откатить
изолированно от простых column-миграций.

- `Task.priority` — новый enum `TaskPriority (low|normal|high)`,
  `@default(normal)`.
- `Note.pinnedAt DateTime?` — не булев флаг: сама метка времени — это ещё и
  «закреплено с такого-то момента», стабильный tie-breaker при нескольких
  закреплённых заметках.
- `Note.tags String[] @default([])` — нативный Postgres-массив, не отдельная
  таблица: перекрёстное управление тегами (переименование, объединение)
  пока не нужно, а `String[]` не тянет за собой миграцию-джойн, если
  понадобится позже — это шаг вперёд, не назад.
- `Note.eventAt DateTime?` — дата, по которой заметка попадает в календарь,
  сознательно отдельная от `Task.dueAt`: у заметки нет статуса/просрочки,
  поэтому это просто метка на дне, а не дедлайн.
- **Полнотекстовый поиск** — не денормализованная `tsvector`-колонка
  (лишняя синхронизация при каждой записи), а функциональный GIN-индекс
  прямо на выражении `to_tsvector('russian', title || ' ' || body/description || ' ' || …)`.
  Споткнулись об одну реальную деталь Postgres: `array_to_string()` (нужна,
  чтобы затащить `Note.tags` в тот же tsvector) помечена `STABLE`, а не
  `IMMUTABLE` — Postgres отказывается индексировать выражения с не-immutable
  функциями. Обёрнута в собственную SQL-функцию
  `immutable_array_to_string`, честно помеченную `IMMUTABLE` (безопасно —
  результат зависит только от аргументов, никакого сессионного состояния).
  Индексы новые, RLS-политики — старые: `notes`/`tasks` уже под RLS
  (`20260905121419_enable_rls`), а эта политика действует на **любой** SQL
  против таблицы, не только на запросы через Prisma query builder — то
  есть `$queryRaw`-путь ниже изолирован между воркспейсами ровно так же,
  как обычный `findMany`.

### Бэкенд

- `TasksService.list`/`NotesService.list` получили необязательный `search`:
  без него — прежний путь (`findMany`, обычная сортировка); с ним —
  `tx.$queryRaw` с `websearch_to_tsquery('russian', …)` (не `to_tsquery` —
  тот кидает синтаксическую ошибку на «сыром» вводе пользователя,
  `websearch_to_tsquery` — никогда), сортировка по `ts_rank`. Раскопали три
  «сырых» контроллера-строки (`@Query("search")`), не проходящие через
  zod-пайп — сознательно: это read-only фильтр списка, не мутация,
  строгая схема тут не даёт дополнительной защиты, которую не даёт уже сам
  параметризованный `$queryRaw`.
- И `list`, и raw-путь возвращают одинаковую форму строки (`TaskRow`/
  `NoteRow` types), поэтому один и тот же `toDto` обслуживает оба пути.
- `NotesService.list` без `search` теперь сортирует `pinnedAt desc nulls
  last, updatedAt desc` — закреплённые всегда сверху, даже без явного UI-
  сортировщика.

### Общий core / фронтенд

- `packages/shared-types`: `taskPrioritySchema`, `Note.tags/pinnedAt/eventAt`
  — важная деталь Zod: поля с `.default(...)` в `z.infer` (= output-типу)
  становятся **обязательными**, а не опциональными, так что каждое место,
  создающее `CreateTaskInput`/`CreateNoteInput` (дашборд, ⌘K-быстрый ввод,
  формы), должно было явно проставить `priority`/`tags` — компилятор
  честно на это указал везде, где забыли.
- `ApiClient.listTasks/listNotes` получили необязательный `search` →
  `?search=`; `useTasks`/`useNotes` кладут его в `queryKey`, поэтому у
  каждой строки поиска свой кеш react-query, не мешающий обычному списку.
- `packages/ui/hooks.ts`: `useDebouncedValue` — TasksPanel/NotesPanel
  debounce'ят поле поиска (300мс) перед тем, как отдать его в `useTasks`/
  `useNotes`, вместо запроса на каждое нажатие клавиши.
- `TaskForm` — поле «Приоритет»; `TasksPanel` — точка-индикатор на карточке
  (только high/low — «обычный» не требует визуального шума), новая
  группировка «По приоритету» (тот же паттерн, что «по проекту»,
  drag-and-drop между колонками меняет приоритет).
- `NotesPanel`/`NoteEditor` — чипы тегов (добавление по Enter/запятой,
  Backspace удаляет последний), фильтр по тегу над списком (как чипы
  проектов в Tasks), поле «Показать в календаре» (datetime-local →
  `eventAt`), пункт «Закрепить/Открепить» в меню действий, булавка рядом с
  заголовком закреплённой заметки в списке.
- `CalendarPanel` — теперь показывает и задачи (`dueAt`), и заметки
  (`eventAt`) одним списком; `CalendarItem` получил `kind?: "task" |
  "note"`, чтобы клик/drag на пилюлю мог верно определить, через
  `focusTask` или `focusNote` его открыть и что обновлять при переносе
  (`Task.dueAt` или `Note.eventAt`). У заметок фиксированный цвет пилюли
  (`tone: "__note__"`), отличный от per-project цветов задач.

### Проверка

`pnpm typecheck` (7/7) · `pnpm lint` (чисто) · `pnpm test` (15/15) ·
`pnpm --filter @orion/web build` и `DESKTOP_EXPORT=1 build` (14/14 страниц,
обе сборки) — все прогнаны самостоятельно после написания кода.

Живая проверка бэкенда через реального пользователя KAI (curl, не только
typecheck):

- Создание задачи с `priority: "high"`, заметки с `tags: [...]` — приняты
  и возвращены корректно.
- Полнотекстовый поиск: `GET /tasks?search=рефакторинга` находит задачу с
  «рефакторинг» в описании (стемминг `russian`-конфига реально работает на
  словоформах); то же для поиска заметки по тегу «работа». Первая попытка
  этого теста «не нашла» ничего — оказалось, `curl --data-urlencode` в
  Git Bash на этой машине кодирует кириллицу в CP1251, а не UTF-8 (видно
  по `%f0%e5%f4...` в `curl -v`); проверено напрямую в `psql`, что сам
  SQL-запрос находит нужную строку, затем перепроверено через
  `encodeURIComponent` из Node — баг был исключительно в тестовом
  инструменте, не в коде ORION.
- Pin/unpin: `PATCH .../notes/:id {pinnedAt: <ISO>}` → заметка поднимается
  на первое место в обычном списке без явной сортировки на клиенте.
- Тестовые записи, созданные во время проверки, удалены после — данные
  KAI не замусорены.
- Веб-сборка (`next dev`, чистый перезапуск): `/login`, `/dashboard`,
  `/panel/{tasks,notes,calendar,dashboard}` компилируются и отдают 200 без
  ошибок.

Не пройдено (как и в v0.5/v0.6 — нужен реальный клик, не автоматизировано
в этой сессии): drag-and-drop карточки между колонками приоритета,
тег-чипы и pin-переключатель в UI, дата заметки в календаре, debounce
строки поиска — реализованы, но не прокликаны глазами.

## v0.8: модуль «Финансы» (СДЕЛАНО)

### Контекст

Третий бизнес-модуль поверх ядра (после Заметок и Задач). Пользователь
подтвердил объём первой версии: транзакции + категории, счета/кошельки,
бюджеты по категориям на месяц, повторяющиеся транзакции — одна валюта на
workspace. По объёму это пять связанных сущностей вместо одной, поэтому
сначала прошли через `EnterPlanMode`/`ExitPlanMode` (план сохранён в сессии
агента), а не писали вслепую.

### Ключевые решения

- **Деньги — `Int` в копейках**, не `Float`/`Decimal` — та же причина, по
  которой даты везде ISO-строки: никакой арифметики с плавающей точкой на
  суммах. Конвертация рубли ↔ копейки — только на границе фронтенда
  (`lib/format.ts`: `formatMoney`, `toKopecks`, `parseMoneyInput`,
  `fromKopecks`), бэкенд копеек не форматирует и рублей не видит.
- **Валюта не хранится** — вывод через `Intl.NumberFormat("ru-RU")` с
  фиксированным «₽».
- **Один модуль — одна панель с вкладками**, не пять пунктов сайдбара:
  `FinancePanel` = `SegmentedControl` на Транзакции/Бюджеты/Счета/
  Повторяющиеся (тот же приём, что группировка в `TasksPanel` и виды в
  `Calendar`). Категории — общая инфраструктура для трёх вкладок сразу, а
  не отдельная вкладка: своя модалка (`CategoryManagerModal`), открывается
  кнопкой в шапке панели независимо от активной вкладки.
- **Баланс счёта не хранится** — `startingBalance` + агрегат
  (`groupBy` по `type`) по всем транзакциям счёта, считается заново на
  каждый `GET /accounts`. Одно место, где может быть неправда, — Prisma, а
  не два (денормализованное поле + пересчёт).
- **`assertAccountInWorkspace`/`assertCategoryInWorkspace`/`monthRange`/
  `toMonthKey`** вынесены в `apps/api/src/finance/finance-refs.util.ts` —
  используются тремя сервисами (Transactions, Budgets, Recurring), поэтому
  не тройная копипаста уже на старте, в отличие от единичных
  `assertOwnedTx` в каждом сервисе notes/tasks.
- **Крон повторяющихся транзакций зеркалит `DueTaskCheckerService`**
  (`RecurringCheckerService`, `@Cron(EVERY_HOUR)`, `asSystem` по всем
  пространствам) — создаёт `Transaction` из правила и продвигает
  `nextRunAt` (+7 дней для weekly; для monthly — на следующий месяц с
  клампом `anchorDay` до последнего дня месяца, чтобы «31 число» не
  перепрыгивало февраль). Ручной HTTP-триггера нет осознанно (не
  запрошено) — только `@Cron` и pause/resume через `pausedAt`.

### Реализация

- **Модель** (`schema.prisma`): `Account`, `FinanceCategory`, `Transaction`,
  `Budget` (`@@unique([categoryId, month])`), `RecurringTransaction` — все
  `workspaceId`-scoped, зеркалят `Note`/`Task`. Две миграции: `finance_core`
  (обычные поля, `prisma migrate dev`) и `finance_rls` (raw SQL, тот же
  `USING (EXISTS (... workspace_members ...))`, что у notes/tasks — RLS
  action покрывает и `$queryRaw`, и обычный Prisma-путь одинаково).
- **Бэкенд** (`apps/api/src/finance/`) — один `FinanceModule`, пять пар
  контроллер+сервис (`accounts/`, `categories/`, `transactions/`,
  `budgets/`, `recurring/` + `recurring-checker.service.ts`), каждый сервис
  один в один структура `NotesService`/`TasksService`
  (`assertMemberTx` + `withUser`, `toDto` в конце файла).
  `TransactionsService.list` фильтрует по `?accountId=/?categoryId=/
  ?month=`; `BudgetsService.list` считает `spent` по каждому бюджету
  отдельным `aggregate` (N+1, осознанно — бюджетов у личного пространства
  единицы, не стоило усложнять одним общим `groupBy`).
- **shared-types**: `packages/shared-types/src/finance.ts` — схемы всех
  пяти сущностей; та же ловушка с `.default(...)`, что в v0.7
  (`priority`/`tags`) — `startingBalance`/`tags`-подобные поля с дефолтом
  становятся обязательными в выведенном TS-типе, компилятор сразу подсветил
  все места создания, где дефолт нужно было явно проставить.
- **core / core-react**: ~15 методов в `api-client.ts` (+ хелпер
  `buildQuery` для составных query-фильтров транзакций), пять файлов
  `use-finance-*.ts` — `useX/useCreateX/useUpdateX/useDeleteX`, с
  кросс-инвалидацией кэша там, где одна мутация меняет несколько
  сущностей (создание транзакции инвалидирует и счета́, и бюджеты).
- **Фронтенд**: `panels/FinancePanel.tsx` (тонкая оболочка) +
  `panels/finance/{accounts,budgets,recurring,transactions}-view.tsx` и
  парные `*-form.tsx` — тот же разрез «доска ↔ форма», что
  `TasksPanel`/`task-form.tsx`, здесь сразу на четыре пары, т.к. объём был
  известен по плану заранее. `category-manager.tsx` — общая модалка
  категорий. Бюджеты — прогресс-бар `spent/limitAmount` с подсветкой
  превышения; повторяющиеся — pause/resume через ту же «таймстамп как
  флаг» идиому, что `Note.pinnedAt`.

### Проверка

`pnpm typecheck` (7/7, чисто с первого прохода) · `pnpm lint` (чисто) ·
`pnpm test` (15/15) · `pnpm --filter @orion/web build` и
`DESKTOP_EXPORT=1 build` — 15/15 страниц (было 14, `/panel/[panelId]`
получил ещё один статический путь `finance`).

Живая проверка под KAI (curl, файлы вместо инлайн-кириллицы — см. известный
баг кодировки Git Bash из v0.7):

- Счёт с `startingBalance=1000000` → доход 500000 → расход 150000 →
  `GET /accounts` отдаёт `balance: 1350000` — агрегация верна.
- Бюджет 500000 на категорию расходов → `GET /budgets?month=` отдаёт
  `spent: 150000` — совпадает с суммой расходной транзакции той же
  категории и месяца. Повторное создание бюджета на ту же категорию+месяц
  → `409 Conflict` (уникальный индекс отработал, а не 500).
- `GET /transactions?month=2026-09` отдаёт обе операции — фильтр по месяцу
  верен.
- Повторяющееся правило с `nextRunAt` в прошлом → ручной вызов
  `RecurringCheckerService.runCheck()` (временный скрипт через
  `NestFactory.createApplicationContext`, удалён после использования) →
  создал `Transaction` с `occurredAt` = старому `nextRunAt`, продвинул
  `nextRunAt` ровно на месяц вперёд.
- Удаление счёта каскадно снесло его транзакции (проверено — список после
  удаления пуст). Все тестовые счета/категории/бюджеты/правила удалены
  после проверки, данные KAI не замусорены.
- `/panel/finance` и `/dashboard` компилируются и отдают 200 без ошибок на
  чистом перезапуске `dev:web`.

Не пройдено глазами (как и предыдущие версии): реальный клик по формам,
прогресс-барам бюджета, pause/resume повторяющихся операций,
`CategoryManagerModal` — бэкенд и типы проверены, интерактив — нет.

---

## v0.9: серьёзная проработка модуля «Заметки» (СДЕЛАНО — код; фазы 1–6)

> Статус: код всех шести фаз написан и проходит гейт (typecheck/lint/test)
> в своих файлах. Не сделано на этой машине: `pnpm db:migrate` (в очереди
> миграции многих параллельных веток) и живые прогоны. Вложения к заметкам
> вынесены в модуль «Документы» (v0.12).

### Контекст

До сих пор `Note` был минимальным: `title` + `body` (plain text,
`whitespace-pre-wrap`), теги-массив, `pinnedAt`, `eventAt`, серверный
full-text. Markdown-рендер и управление тегами были осознанно отложены
(v0.6/v0.7). Пользователь запросил довести модуль до уровня «полноценный
PKM + крепкий редактор» — то есть частично отменить эти отложки.

### Зафиксированные решения (развилки, выбранные пользователем)

1. **Назначение** — «полноценный PKM (Obsidian-like)» **и** «крепкий
   редактор». В объёме всё, кроме AI-слоя: `[[wikilinks]]` + бэклинки,
   daily notes, шаблоны, история версий, оглавление, вложения, корзина.
2. **Редактор тела** — **CodeMirror 6, source-markdown** («как в Obsidian»),
   не WYSIWYG. Просмотр — маленьким markdown-рендерером с toggle
   «Источник / Просмотр». Это **осознанно отменяет** пункт CLAUDE.md
   «примитивы руками, единственная добавленная зависимость — `react-dom`»:
   в `packages/ui` придут `@codemirror/*`, `@lezer/highlight`, `markdown-it`.
   Оформлено здесь как явное решение, а не регресс.
3. **AI-слой — пока нет.** Ни pgvector, ни генеративных фич на этом этапе.
   Семантический поиск / «спроси свои заметки» / автотеги — отдельный
   будущий этап, когда появится провайдер.

Иерархия заметок (`parentId`) **не добавляется** — ломает зеркало
`notes ↔ tasks`, а при тегах + `[[связях]]` не нужна (как в Obsidian/Logseq).

### Фазы (каждая — самостоятельно поставляемая)

| # | Что | Новые зависимости |
|---|-----|-------------------|
| **1. Безопасность/гигиена** | `Note.editedAt` + прекратить бампать сортировку при pin; `Note.deletedAt` (мягкое удаление) + миграция; `restore`/`purge` эндпоинты; крон-очистка корзины через `asSystem`; вьюхи «Активные/Корзина» в панели; `deletedAt IS NULL` в full-text | нет |
| **2. Редактор** | `MarkdownEditor` (CM6) в `packages/ui`; source/preview; автосейв с debounce; счётчик слов + время чтения; оглавление из заголовков | `@codemirror/*`, `@lezer/highlight`, `markdown-it` |
| **3. Связи (ядро PKM)** | модель `NoteLink` + миграция + RLS (шаблон `notes_isolation`); парсинг `[[…]]` при create/update; `GET …/notes/:id/backlinks`, `GET …/notes/titles`; CM6-автокомплит на `[[` и навигация по ссылке через `panel-bus`; секция «Упоминания» в редакторе; daily notes (`Note.dailyOn`, `@@unique([workspaceId, dailyOn])`) + кнопка «Сегодня» | нет |
| **4. История версий** | модель `NoteRevision` + миграция + RLS; снапшот в сервисе при значимом изменении (debounce N минут); `Sheet` «История» + `DiffView`-примитив + откат; прунинг ревизий в кроне | нет |
| **5. Вложения + шаблоны** | модель `NoteAttachment` + storage-адаптер (локальный диск в data-каталоге, S3 позже без правок API) + стрим-эндпоинт с гвардом; вставка/дроп изображений в CM6; `Note.isTemplate` + «Новая из шаблона» | multipart-парсер, если ещё нет |
| **6. Полиш поиска/организации** | `ts_headline`-сниппеты; фильтры (теги AND/OR, диапазон дат); сохранённые запросы; архив (`Note.archivedAt`); ручной порядок; управление тегами (переименовать/слить/удалить) | нет |

### Фаза 1 — СДЕЛАНО

**Модель данных** (`schema.prisma`, миграция `20260908120000_note_soft_delete`):

- `Note.editedAt DateTime?` — «контент менялся тогда-то». `NotesService`
  ставит его **только** когда меняется `title`/`body`/`tags`; чистый
  `{ pinnedAt }` / `{ eventAt }` PATCH его не трогает. Сортировка
  «Изменённые» переехала с `updatedAt` на `editedAt` — pin/unpin больше не
  перекидывает заметку наверх списка. Nullable только ради мгновенного
  `ADD COLUMN`; миграция бэкфиллит из `updatedAt`.
- `Note.deletedAt DateTime?` + `@@index([deletedAt])` — мягкое удаление.
  `DELETE …/notes/:id` теперь ставит `deletedAt` (было — физический
  `delete`). Раньше restore-пути не было вовсе — это и был повод.
- **RLS не менялся**: `notes_isolation` (миграция `enable_rls`) действует
  на все строки таблицы, в т.ч. с `deletedAt IS NOT NULL` — заметка в
  корзине изолирована по workspace ровно так же, как живая.

**API** (`notes.controller.ts` / `notes.service.ts`):

- `GET …/notes?view=trash` — только удалённые (свежеудалённые сверху),
  `search` в этом режиме игнорируется. Неизвестный/отсутствующий `view` →
  `active` (не `400` — параметр это UI-удобство, а не контракт).
- `list` (active): и raw-full-text, и ORM-путь фильтруют `deletedAt IS NULL`.
  ORM `orderBy`: `pinnedAt desc nulls last`, затем `editedAt desc nulls last`,
  затем `updatedAt desc`.
- `POST …/notes/:id/restore` → снимает `deletedAt`, отдаёт `Note`.
- `DELETE …/notes/:id/purge` → физический `delete` (необратимо, из корзины).
- `NoteTrashPurgeService` — новый провайдер в `NotesModule`. `@Cron`
  раз в сутки (3:00), `asSystem` + `deleteMany({ deletedAt: { lte: now-30d } })`.
  Зеркало `DueTaskCheckerService` (системный проход по всем пространствам,
  без «текущего пользователя» → `asSystem`, а не `withUser`).

**Контракт** (`shared-types/src/note.ts`): `noteSchema` += `editedAt`,
`deletedAt` (обе `string().nullable()`); новый `noteViewSchema`
(`"active" | "trash"`) + тип `NoteView`.

**core / core-react**: `ApiClient.listNotes(workspaceId, search?, view?)`
(через `buildQuery`), `restoreNote`, `purgeNote`. `use-notes.ts`:
`useNotes(workspaceId, search?, view?)` (queryKey получил `view`),
`useRestoreNote`, `usePurgeNote`. `useDeleteNote` не изменился — сервер
сам сделал удаление мягким.

**Фронтенд** (`panels/NotesPanel.tsx`): `SegmentedControl`
«Активные / Корзина» в шапке. В корзине: список неинтерактивен (заметка
не редактируется), в меню строки — «Восстановить» / «Удалить навсегда»
(вторая — через `ConfirmDialog` «действие необратимо»), показывается
«Удалено N назад» вместо времени изменения, скрыты «Новая» и сортировка.
Тост обычного удаления сменился на «Перемещено в корзину», в
`ConfirmDialog` — «переедет в корзину, можно восстановить». Клик по
пилюле календаря (`focusNote` из `panel-bus`) принудительно возвращает
вид в «Активные». Отображение времени везде — `editedAt ?? updatedAt`
(хелпер `contentTime`).

### Проверка (Фаза 1)

- `pnpm lint` — чисто. `pnpm test` — 15/15.
- `pnpm typecheck` — модуль заметок (api + core + core-react + web) чист.
  Падают только `apps/api/src/finance/**` — это **не связано** с заметками:
  незакоммиченный in-progress рефактор `Transaction` → `TransactionLine`
  (сервисы ещё лезут в `transaction.categoryId`/`amount`/`_sum`), был
  сломан до этой правки.
- **Не применено на этой машине**: `pnpm db:migrate` и `pnpm db:generate` —
  запущенный `dev:api` держит `query_engine-windows.dll.node`, `prisma
  generate` не смог подменить движок (TS-клиент при этом сгенерировался и
  содержит `editedAt`/`deletedAt`, поэтому typecheck зелёный). Нужно:
  остановить `dev:api` → `pnpm db:migrate` → перезапустить. Живой прогон
  корзины/restore/purge и крона — после этого.

### Фаза 2 — СДЕЛАНО (код)

Редактор тела заметки: `whitespace-pre-wrap`/`<Textarea>` → CodeMirror 6.

**Зависимости** (в `packages/ui`, впервые «тяжёлые» помимо
`react-dom`/`dockview`/`framer-motion`): `@codemirror/{state,view,commands,
language,lang-markdown}`, `@lezer/highlight`, `markdown-it` (+
`@types/markdown-it`). Пункт CLAUDE.md «UI-примитивы руками» переписан —
редактор заметки объявлен явным исключением со ссылкой сюда.

**`packages/ui/src/markdown-editor.tsx`** — `MarkdownEditor`: контролируемая
обёртка над `EditorView`. Создаётся один раз на mount; внешние смены
`value` (переключение заметки, откат) применяются `dispatch`-ем без сброса
курсора на собственных нажатиях. Source-mode подсветка (`HighlightStyle` по
тегам `@lezer/highlight`) — маркеры приглушены, структура читаема, без
«радуги». Тема — хардкод токенов ORION (одна тёмная). Без фиксированной
высоты: вьюха растёт с контентом, скроллит внешняя область панели (title +
тело + теги вместе), как в Obsidian. `Mod-S` → `onSave`. Перенос строк,
`history`, `indentWithTab`.

**`packages/ui/src/markdown.tsx`** — `renderMarkdown` (один общий
`markdown-it`, `html:false` → нет XSS-поверхности, `linkify:true`, без
плагинов), `MarkdownView` (прозаические стили через arbitrary-variant
`[&_h1]:…` — `prose`-плагина в проекте нет), `markdownOutline` (дерево
заголовков из токенов: уровень/текст/slug/строка), `slugify` (Unicode-
aware, кириллицу сохраняет). Заголовкам проставляется дедуплицированный
`id` — для перехода из оглавления.

**`panels/NotesPanel.tsx` → `NoteEditor`**:

- `SegmentedControl` «Правка / Просмотр». Правка — `MarkdownEditor`,
  просмотр — `MarkdownView` (пустое тело → подсказка).
- **Автосейв** существующих заметок: debounce 900 мс от снапшота формы,
  `runSave({ silent: true })` (без тоста), `savingRef` от гонок. Форма
  создания (`note === null`) по-прежнему сохраняется явно кнопкой. Статус в
  футере: «Сохраняю…» / «Есть несохранённые изменения» / «Всё сохранено».
  `Mod-S` в редакторе — немедленный флаш.
- Счётчик слов + время чтения (~200 сл/мин) в под-хедере редактора.
- Оглавление — `DropdownMenu` по иконке-списку (только когда есть
  заголовки); клик → `preview` + `scrollIntoView` по `id` заголовка.

**Проверка (Фаза 2)**: `@orion/ui` typecheck и `eslint`
(`markdown.tsx`/`markdown-editor.tsx`/`NotesPanel.tsx`) — чисто на момент
внесения. Полный `pnpm typecheck` в это время **нельзя** прогнать из-за
параллельной сессии: идёт незавершённый рефактор `packages/ui/src/calendar.tsx`
→ `calendar/` (папка пока пустая → `index.ts` не резолвит `./calendar`),
плюс `apps/api/src/{finance,events}` и `shared-types`. Ни одна из этих
поломок не в файлах Фазы 2. Живьём (клик по «Правка/Просмотр», автосейв,
подсветка, оглавление) — не гонялось.

### Фаза 3 — СДЕЛАНО (код)

Связи между заметками: `[[wiki links]]`, бэклинки, daily notes.

**Контракт** (`packages/shared-types`): новый `wiki-links.ts` —
`parseWikiLinks` / `wikiLinkTargets` (единственный источник правды о том,
что считается ссылкой; используется и API, и клиентом; покрыт
`wiki-links.test.ts`). Форма: `[[Target]]` / `[[Target|alias]]`, без
вложенных скобок. `noteSchema` += `dailyOn` (`YYYY-MM-DD` | null). Новые
`noteTitleRefSchema` (`{id,title}`), `noteBacklinkSchema`
(`{id,title,snippet}`).

**Модель данных** (`schema.prisma`, миграции
`20260908140000_note_links_daily` + `20260908140100_note_links_rls`):

- **`NoteLink`** — одна `[[ссылка]]` из тела одной заметки на другую по
  заголовку. Производные данные: `NotesService` пересобирает исходящие
  строки заметки на каждом сохранении, входящие — при смене заголовков.
  `targetNoteId` = NULL, пока `targetTitle` не матчится ни на одну живую
  заметку. `@@unique([sourceNoteId, targetTitle])`, FK: source → CASCADE,
  target → SET NULL, workspace → CASCADE. RLS — та же flat-проверка
  membership, отдельной миграцией (как у notes/tasks/finance/events).
- **`Note.dailyOn DateTime? @db.Date`** + `@@unique([workspaceId, dailyOn])`
  — заметка-дня (одна на пространство на дату). NULL для обычных;
  Postgres считает NULL-ы различными, так что unique не мешает.

**API** (`notes.service.ts` / `notes.controller.ts`):

- `syncOutgoingLinks(tx, note)` — из тела достаётся `wikiLinkTargets`,
  старые строки `sourceNoteId` сносятся, новые резолвятся против
  `Note.title` **регистронезависимо** (`mode: "insensitive"`), пишутся
  `createMany({ skipDuplicates })`.
- `reresolveIncomingLinks(tx, note)` — после смены заголовка/появления
  заметки: отвязать входящие, чей текст больше не совпадает; привязать
  нерезолвленные, чей текст теперь совпадает. Workspace-scoped, дёшево при
  личных объёмах.
- Врезка: `create` → sync+reresolve; `update` → sync при смене `body`,
  reresolve при смене `title`; `remove` (в корзину) → снести исходящие,
  обнулить входящие; `restore` → sync+reresolve; `purge` → чистится
  каскадом FK.
- `GET .../notes/titles` → `{id,title}[]` живых заметок (для автокомплита).
- `GET .../notes/:id/backlinks` → `{id,title,snippet}[]`, дедуп по
  source, сниппет — обрезок тела вокруг первого `[[`.
- `POST .../notes/daily` → открыть-или-создать заметку на сегодня
  (серверный локальный день, `@db.Date`); заметка-дня в корзине
  оживляется, а не дублируется (unique не даст вторую). Заголовок — плейн
  `YYYY-MM-DD`, чтобы `[[2026-09-08]]` линковалось само.

**core / core-react**: `ApiClient.listNoteTitles` / `noteBacklinks` /
`openDailyNote`. Хуки `useNoteTitles` (queryKey `["notes", ws, "titles"]`
— инвалидируется любой мутацией заметки), `useNoteBacklinks`,
`useOpenDailyNote`.

**`@orion/ui`**:

- `markdown.tsx` — inline-правило markdown-it `wikilink` (перед `link`):
  `[[T]]`/`[[T|alias]]` → `<a data-wikilink="T" class="orion-wikilink">`.
  `MarkdownView` получил `onWikiLink?(target)` (+ хелпер
  `wikiLinkFromEvent`) и стиль `.orion-wikilink`.
- `markdown-editor.tsx` — проп `wikiLinkTargets?: string[]`; когда задан,
  подключается `@codemirror/autocomplete` (добавлен в deps `@orion/ui`
  явно) с источником, срабатывающим после `[[`, читающим список из ref
  (обновление списка не пересобирает `EditorView`). `apply` дописывает
  закрывающие `]]`.

**`panels/NotesPanel.tsx`**: кнопка «Сегодня» (`useOpenDailyNote`) в шапке.
`NoteEditor` получил `workspaceId`, тянет `useNoteTitles` (→
`wikiLinkTargets` в редактор, минус собственный заголовок) и
`useNoteBacklinks` (→ секция «Упоминания · N» под датой календаря, клик →
`focusNote`). Клик по `[[ссылке]]` в просмотре → резолв по титулу →
`focusNote` либо тост «Заметки нет».

**Проверка (Фаза 3)**: полный гейт зелёный —
`pnpm typecheck` (6/6 Done), `pnpm lint` чисто, `pnpm test` 34/34
(+5 кейсов `wiki-links`). Параллельная сессия к этому моменту слила
`calendar/`+`events`+`finance`, дерево снова собирается целиком.
**Не применено**: `pnpm db:migrate` — в очереди теперь миграции сразу
нескольких веток (finance transaction-lines, events calendar, notes soft
delete, notes links). Применять одним прогоном, когда ветки сойдутся.
`prisma generate` выполнен (клиент содержит `NoteLink`/`dailyOn`).
Живьём (автокомплит `[[`, бэклинки, daily) — не гонялось.

### Фаза 4 — СДЕЛАНО (код)

История версий тела/заголовка заметки.

**Модель** (`schema.prisma` + миграции `20260908150000_note_revisions` +
`20260908150100_note_revisions_rls`): **`NoteRevision`** — снимок
`title`/`body`/`tags` + `createdAt`. Чистая история: не мутируется,
каскадно удаляется с заметкой, RLS отдельной миграцией. Индекс
`[noteId, createdAt]`.

**API** (`notes.service.ts` / `notes.controller.ts`):

- `maybeSnapshot(tx, note, force?)` — пишет снимок **до** изменения, но не
  чаще одного раза в `REVISION_MIN_GAP_MS` (3 мин) на заметку: серия
  автосейвов схлопывается в один снимок «как было до этой сессии правок».
  Врезан в `update` при смене контента. Ручной откат снимает `force` —
  всегда снапшотит текущее (откат обратим).
- `assertOwnedTx` теперь возвращает найденную заметку (нужно для снапшота
  pre-состояния); прежние вызовы игнорируют результат.
- `GET .../notes/:id/revisions` → `NoteRevisionSummary[]` (без тел,
  newest-first, `take: 200`). `GET .../revisions/:rid` → полный снимок.
  `POST .../revisions/:rid/restore` → снапшот текущего + `note` ← снимок +
  `syncOutgoingLinks`/`reresolveIncomingLinks` → `Note`.
- Крон `NoteTrashPurgeService` расширен: `pruneRevisions()` (raw SQL,
  `row_number() OVER (PARTITION BY noteId ORDER BY createdAt DESC)`,
  оставляет 50 на заметку). Класс не переименован — тот же «ночной
  housekeeping заметок».

**core / core-react**: `listNoteRevisions` / `getNoteRevision` /
`restoreNoteRevision`; хуки `useNoteRevisions`, `useNoteRevision`
(ленивый — фетчит тело выбранного снимка), `useRestoreNoteRevision`.

**`@orion/ui`**: `diff-view.tsx` — `diffLines` (построчный LCS без
зависимостей; при гриде > 1.5M ячеек — дешёвый fallback по общему
префиксу/суффиксу) + `DiffView` (моноширинный gutter, `+`/`-`/` `).

**Фронтенд**: `panels/note-history.tsx` — отдельный модуль (независимый
concern, как `task-form.tsx`): список снимков (макс-высота, скролл) →
выбор → `DiffView(before = снимок, after = текущее тело)` + строка diff
заголовка + «Восстановить эту версию» (`ConfirmDialog`). Открывается из
`NoteEditor` кнопкой-часами (только для существующей заметки) в `Sheet`
`width="40rem"`.

**Проверка (Фаза 4)**: полный гейт зелёный — `pnpm typecheck` (6/6),
`pnpm lint` чисто, `pnpm test` 34/34. `prisma generate` — TS-клиент
содержит `NoteRevision` (движок снова не подменился под запущенным
`dev:api`, на typecheck не влияет). `pnpm db:migrate` и живьём — не
гонялось.

### Фаза 5 — шаблоны СДЕЛАНО (код); вложения ОТЛОЖЕНЫ

**Шаблоны** (`Note.isTemplate Boolean @default(false)`, миграция
`20260908160000_note_templates`):

- Шаблон = обычная заметка с флагом. `NotesService.list` получил параметр
  `templates` (контроллер — `?templates=1`): активный список отдаёт либо
  не-шаблоны, либо шаблоны, никогда вперемешку. `listTitles`
  (автокомплит `[[`) шаблоны не отдаёт. `create` принимает
  `isTemplate` (в `createNoteInputSchema` + `updateNoteInputSchema`),
  `toDto`/`NoteRow` расширены.
- core/core-react: `listNotes(ws, search?, view?, templates?)`,
  `useNotes(..., templates?)` (queryKey получил ветку `templates|notes`).
- `NotesPanel`: чип-тумблер «Шаблоны · N» в ряду тегов; в этом режиме
  «Новая» создаёт шаблон. Рядом с «Новая» — меню `FileStack` «Из шаблона»
  → копирует `body`/`tags` шаблона в свежую заметку. В меню строки заметки
  — «Сделать шаблоном / Убрать из шаблонов». В шапке редактора — метка
  «Шаблон · …».

**Вложения — отложены осознанно.** Параллельная сессия строит модуль
`Документы` (`Document` — дерево файлов воркспейса: папки, soft-delete,
`checksum`, blob-хранилище через `src/storage/*`, WebDAV-адаптер). Это ровно
тот слой хранения, что нужен вложениям заметки. Строить сейчас
параллельный multer/storage-стек — гарантированный конфликт по общим
файлам (`main.ts`, зависимости, storage-сервис). Вложения заметок
подключатся к `Document`-хранилищу, когда оно приземлится (или отзеркалят
его), — отдельным заходом.

**Проверка (Фаза 5)**: `@orion/{shared-types,core,core-react,ui}` и
`@orion/web` — typecheck Done, `eslint` чисто, свои тесты (`wiki-links`,
`schemas`) зелёные. В `apps/api` typecheck и `pnpm test` на момент правки
падают **только** на незавершённом модуле `Документы` параллельной сессии
(`src/storage/webdav.storage.ts` — пакет `webdav` ещё не поставлен;
`document-tree.test.ts` — 1 кейс). В файлах Фазы 5 ошибок нет.
`pnpm db:migrate` — не прогонялся.

### Фаза 6 — СДЕЛАНО (код): архив, фильтр по тегам AND/OR, управление тегами

Взято три пункта из списка полиша; остальное (`ts_headline`-сниппеты,
сохранённые запросы, ручной порядок, диапазон дат) отложено как
низкоприоритетное.

**Архив** (`Note.archivedAt DateTime?`, миграция `20260908170000_note_archive`,
RLS не трогается):

- Среднее состояние между «активно» и «корзиной»: вне общего списка,
  никогда не чистится кроном, **редактируется** как обычная заметка. Та же
  идиома «таймстамп как флаг», что `pinnedAt`/`deletedAt`.
- `noteViewSchema` → `["active", "archive", "trash"]`. `NotesService.list`:
  `active` теперь фильтрует и `archivedAt IS NULL` (raw + ORM), новая ветка
  `archive` (сорт по `archivedAt desc`). `listTitles` (автокомплит `[[`)
  архивные тоже исключает. `archivedAt` в `updateNoteInputSchema` (не
  «контент» — снапшот/`editedAt` не трогает), в `toDto`/`NoteRow`.
- UI: третий сегмент «Архив» в переключателе видов (архив использует
  обычный редактор, спец-режим только у корзины); «В архив / Из архива» в
  меню строки; кнопки создания скрыты вне `active`.

**Фильтр по тегам — мультивыбор + AND/OR** (клиентский, только
`NotesPanel`): `tagFilter: string | null` → `tagFilters: string[]` +
`tagMode: "any" | "all"`. Чипы тегов теперь тумблеры; при ≥2 выбранных
появляется `SegmentedControl` «ИЛИ / И».

**Управление тегами** — новый эндпоинт-срез:

- `POST .../notes/tags/rename` `{ from, to }` (`renameNoteTagInputSchema`) —
  переименование, если `to` новый; слияние (список тегов дедупится), если
  существует. `DELETE .../notes/tags/:tag` — снять тег со всех заметок.
  Сервис: `findMany({ tags: { has } })` + пер-заметочный `update` в одной
  `withUser`-транзакции (личные объёмы — N апдейтов не проблема). Действует
  на весь воркспейс, включая архив и корзину.
- core/core-react: `renameNoteTag`/`deleteNoteTag`, `useRenameNoteTag`/
  `useDeleteNoteTag`.
- UI: `panels/tag-manager.tsx` — отдельный модуль, `Modal` со списком
  тегов, инлайн-переименование + удаление (`ConfirmDialog`). Открывается
  иконкой `Tags` в ряду фильтров. Список тегов берётся из текущего вида
  (`allTags`) — теги, что есть только на архивных/удалённых, в модалке не
  видны, хотя эндпоинты их затронут (мелкое ограничение).

**Проверка (Фаза 6)**: `@orion/{shared-types,ui,core,core-react}` и
`@orion/web` — typecheck Done, `eslint` на файлах Фазы 6 чисто, `pnpm test`
57/57. `apps/api` typecheck и общий `pnpm lint` на момент правки падают
**только** на новом модуле `src/sync/` параллельной сессии (WebDAV-бэкап:
`SyncRemote` в схеме, но клиент не перегенерирован, sync-типы в
`shared-types` не экспортированы). В файлах Фазы 6 ошибок нет.
`pnpm db:migrate` — не прогонялся.

### Дальше

Вложения к заметкам — подключить к blob-хранилищу модуля `Документы`
(`src/storage/*`), а не строить своё. Опционально — отложенный полиш
(`ts_headline`, сохранённые запросы, ручной порядок). Перед этим прогнать
накопленное: `pnpm db:migrate` (миграции уже многих веток), живой прогон
Ф1–Ф6.

---

## v0.10: серьёзная проработка модуля «Календарь» (В РАБОТЕ)

### Контекст

До v0.10 «календарь» — это read-only проекция: задачи с `dueAt` + заметки с
`eventAt`, разложенные по сетке месяца/недели/списка (`packages/ui/src/
calendar.tsx`, ~500 строк, руками). Позиционирование — только по дате;
времени, длительности, повторений и напоминаний на само событие нет.
Пользователь запросил довести модуль до «полноценного», по лучшим практикам.

### Зафиксированные решения (развилки, выбранные пользователем)

1. **Первоклассный модуль `events/`** (не остаёмся проекцией). Событие с
   `startAt`/`endAt`, `allDay`, повторениями и напоминаниями. Календарь
   становится лентой над источниками (events + tasks + notes + finance-
   recurring) через маленький реестр `apps/web/lib/calendar-sources.ts` —
   зеркало идеи `panel-registry.ts`, `<Calendar/>` при добавлении источника
   не меняется.
2. **Внешний мир — «Уровень 1»**: исходящий read-only ICS-фид
   (`webcal://…/calendar/:token.ics`), без входящего sync и без импорта
   `.ics`. Повторения — свой мини-движок, **без `rrule`**.

### Модель данных (миграции)

- **`events`** — `startAt`/`endAt` (инстант UTC; для `allDay` — границы
  суток в UTC, чтобы tz/DST не сдвигали), `allDay`, `tz` (IANA-зона на
  момент создания — задел под будущее zone-aware разворачивание, сейчас
  движок UTC-наивный), `colorTag` (ключ курированной палитры), `recurrence`
  (`Json?` — спека из `shared-types/src/recurrence.ts`), `reminders`
  (`Int[]`, минуты до начала).
- **`event_overrides`** — правка/отмена одной итерации повтора:
  `(eventId, occurrenceStart)` уникум, `canceled` + патч-поля (`null` =
  наследовать от мастера). Даёт «только это событие»; «это и последующие» =
  обрезать `recurrence.until` мастера + создать новый Event.
- **`sent_reminders`** — журнал доставки (`eventId, occurrenceStart,
  offsetMinutes`), а не колонка `notifiedAt` как у задач: у повтора итераций
  много.
- Все три таблицы несут денормализованный `workspaceId` → RLS-политика
  такая же плоская, как у `finance_transaction_lines` (миграция
  `…_events_rls`: `ENABLE` + `FORCE` + `CREATE POLICY` по
  `current_setting('app.current_user_id', true)`).
- **`workspaces.icsToken`** (`String? @unique`) — неугадываемый токен фида.
  `AuthService.register` проставляет новым; миграция бэкфиллит существующие.

### Мини-движок повторений (`packages/shared-types/src/recurrence.ts`)

В `shared-types` (не `core`), т.к. `apps/api` зависит только от него.
Чистая логика, тестируется в `pnpm test` (`recurrence.test.ts`, 14 кейсов
вкл. клэмп 31-го числа, Feb-29, границу DST, защиту от зависания).

- `RecurrenceSpec`: `freq` (daily/weekly/monthly/yearly) + `interval` +
  `byWeekday?` (weekly, Пн=0) + `until|count` (взаимоисключающи).
- `expandRecurrence(spec, dtStart, windowStart, windowEnd)` — итерации в
  окне; `count`/`until` считаются от начала серии (как в iCal). Вся
  арифметика на UTC-компонентах (как `advance()` в finance/recurring).
- `describeRecurrence` (RU-текст для формы), `recurrenceToRRule` (для фида).
- **Осознанное отступление**: `recurrenceSpecSchema` — без `.default(...)`
  (input-тип = output-тип), иначе `z.infer` расходится с ручным
  `RecurrenceSpec` и ловит коллизию имени с DOM-глобалом `Event`.

### Бэкенд (`apps/api/src/events/`)

- Структура — зеркало `notes/` / `tasks/` (`events.module/controller/
  service`), плюс два доп-контроллера: `CalendarController`
  (`workspaces/:id/calendar/feed` + `feed/rotate`, под гардом) и
  `CalendarFeedController` (`calendar/:token.ics`, **без гарда** — токен и
  есть креденшл, внутри `asSystem` со скоупом строго на один workspace).
- `EventsService.list(from, to)` — **единственное место в ORION, где
  фильтрация ушла на сервер**: итерации повтора нельзя материализовать на
  клиенте, не отправив ему все правила. Отдаёт реальные события в окне +
  по одному виртуальному на каждую итерацию (id = `<masterId>:<iso>`,
  overrides применены).
- `update/remove` с `scope` (`one|following|all`) + `occurrenceStart`
  (или из синтетического id).
- `ical.ts` — руками VCALENDAR/VEVENT (RFC 5545): экранирование, фолдинг
  75 октетов, `RRULE` + `EXDATE` для отменённых итераций,
  `RECURRENCE-ID` для изменённых, задачи с `dueAt` как короткие VEVENT.
  Это «примитив», не библиотека — парсинга `.ics` в Уровне 1 нет.
- `EventReminderService` — `@Cron(EVERY_MINUTE)`, зеркало
  `DueTaskCheckerService`: разворачивает повтор в окне `[now-1ч,
  now+maxOffset]`, для каждой пары (итерация, офсет) сверяется с
  `sent_reminders`, шлёт через тот же `TelegramService` (dry-run без
  токена), пишет журнал только при успешной доставке. `NotificationsModule`
  теперь `exports: [TelegramService]`.

### Общий core / фронтенд

- `shared-types/src/event.ts` — `eventSchema`, `create/updateEventInput`,
  `eventScopeSchema`, `calendarFeedInfoSchema`.
- `core/api-client.ts` — `listEvents(from,to)`, `create/update/deleteEvent`
  (id энкодится — в синтетическом есть `:`), `calendarFeedInfo`,
  `rotateCalendarFeed`.
- `core-react/use-events.ts` — `useEvents(range)` (`queryKey: ["events",
  wsId, from, to]`), `useCreateEvent`, **`useUpdateEvent` оптимистичный**
  (патчит все закешированные окна, откат по снапшоту), `useDeleteEvent`,
  `useCalendarFeed`, `useRotateCalendarFeed`.
- **`packages/ui/src/calendar.tsx` → `calendar/`** (правило «размер
  файлов»: появился второй независимый concern — сеточный time-grid):
  `index.tsx` (шелл + навигация + `onRangeChange` + клавиши ←→/T/1–4),
  `shared.tsx` (типы, date-утилиты, **курированная палитра из 10 цветов**
  вместо случайного `hue` → контраст в тёмной теме, `Pill`),
  `month-grid.tsx` (многодневные события — полосой через дни: ленты-lane в
  отдельной 7-колоночной полосе над сеткой суток), `time-grid.tsx` (НОВОЕ:
  часовая шкала день/неделя, линия «сейчас», колоночная раскладка
  пересечений, **pointer-events** drag-move + resize за нижний край +
  drag-create по пустой сетке; не HTML5 DnD и не `@dnd-kit`), `agenda.tsx`.
  `sidebar.tsx`/`workbench.tsx` не тронуты — инвариант.
- `apps/web/panels/CalendarPanel.tsx` — переписан: `useEvents(range)` из
  `onRangeChange`, тумблеры источников (localStorage), `onItemReschedule`
  оптимистично + тост с «Отменить», Modal «новое» / Sheet «детали» с
  выбором `scope` для повторов, блок подписки (копировать/перевыпустить).
- `apps/web/panels/event-form.tsx` — вынесен как `task-form.tsx`
  (переиспользуется Modal + Sheet), секции «Повтор» и «Напоминания».

### Осознанные отступления (заносятся в CLAUDE.md)

1. Серверный оконный запрос `events?from&to` — единственное место с
   серверной фильтрацией (было by design «всё на клиенте»).
2. `packages/ui/src/calendar/` — файл разрезан на 5 (было «не дробить»);
   обоснование — второй concern (time-grid) + порог ~400 строк.
3. `/calendar/:token.ics` + `Workspace.icsToken` — первый исходящий
   публичный (по токену) эндпоинт; по духу как Telegram («наружу конфигом/
   ссылкой, без бизнес-логики»). Входящего sync нет.
4. Свой мини-движок повторений вместо `rrule`.

### Проверка

- `pnpm --filter @orion/{shared-types,core,core-react,ui,web} typecheck` —
  **чисто**. `pnpm test` — **15 → 29** (14 новых в `recurrence.test.ts`).
- **Отложено** (запущен `pnpm dev:api`, держит DLL движка Prisma → EPERM на
  `prisma generate`/`migrate`): `pnpm db:migrate` (2 миграции: таблицы +
  RLS + бэкфилл `icsToken`), `prisma generate`, `pnpm --filter @orion/api
  typecheck`, полный `pnpm typecheck`.
- **Живьём не гонялось**: сетка недели/дня и pointer-drag/resize/create,
  разворот повторов в окне, `scope`-правки, подписка `webcal://` в
  стороннем календаре, доставка напоминаний (dry-run в лог).
- Известное ограничение (в комментарии `recurrence.ts` и тесте): timed-
  повтор не самокорректируется через DST (09:00 → 08:00/10:00 wall-clock в
  DST-зоне); `allDay` иммунен; `Event.tz` сохраняется под будущий фикс.

## v0.11: «Финансы» — переводы, сплиты, отчёты, дашборд, net worth (СДЕЛАНО)

### Контекст

Продолжение v0.8 по запросу «серьёзно проработать финансовый модуль по
лучшим практикам» (YNAB/Firefly III/Monarch) — сравнили с текущим
состоянием, выбрали пять пунктов: переводы между своими счетами (без
этого модель некорректна — перемещение денег приходилось подделывать
парой доход/расход), разбиение операции на несколько категорий (split),
отчёты/аналитика, интеграция баланса/бюджета в дашборд, история чистого
капитала. Прошло через `EnterPlanMode`/`ExitPlanMode` — план на диске в
сессии агента, ключевые решения см. ниже.

Нумерация версий разъехалась: пока шла эта работа, в репозитории
параллельно (несколько сессий одновременно, см. ниже) шли `v0.9`
(«Заметки» — корзина/markdown) и `v0.10` («Календарь» — события). Этот
раздел логически про «финансы после v0.8», но чтобы не пересекаться
номерами — `v0.11`.

### Ключевое решение: `Transaction` → шапка + `TransactionLine[]`

`amount`/`categoryId` были плоскими полями на `Transaction`. Split требует
многих категорий на одну операцию, перевод — денег без категории вообще.
Единое решение: сумма всегда живёт в дочерней `TransactionLine
(transactionId, categoryId?, amount)`, `Transaction` — шапка (`accountId`,
`toAccountId?`, `type` теперь `income|expense|transfer`). Обычная операция
— одна строка; перевод — тоже одна строка, но без категории; это один
механизм, не два болта. Прямое следствие: **перевод между своими счетами
не меняет сумму по всем счетам** (уходит с одного, приходит на другой,
net = 0) — значит net worth считается по одним income/expense lines, без
специального учёта переводов.

Миграция `finance_transaction_lines_and_transfers` + `TransactionLine`
денормализует `workspaceId` (не 2-хоповый join к `finance_transactions`
ради RLS) — та же плоская `USING (EXISTS (... workspace_members ...))`
политика, что у всех таблиц финансов.

### Бэкенд

- **`TransactionsService`** — `create`/`update` пишут `lines` вложенным
  `create`/полной заменой (`deleteMany`+`create`, тот же приём, что
  `Note.tags`). Кросс-полевая валидация (transfer ⇔ ровно одна
  строка+`toAccountId`, иначе ⇔ ни одной из этих черт) — не в zod
  `.superRefine` (у PATCH нет доступа к уже сохранённой записи, чтобы
  провалидировать смёрженную картину), а в `assertTransactionShape`
  (`finance-refs.util.ts`), вызываемой и из `create` (на сырой ввод), и из
  `update` (на ввод, смёрженный с текущей записью).
- **`AccountsService`** — баланс теперь `$queryRaw` join
  `finance_transactions` × `finance_transaction_lines`, группировка по
  `(accountId, toAccountId, type)`: income добавляет своему счёту, expense
  вычитает, transfer вычитает у `accountId` и добавляет `toAccountId`.
- **`BudgetsService.spent`** — агрегат переехал на
  `tx.transactionLine.aggregate({ where: { categoryId, transaction: {...} } })`
  — Prisma фильтрует по полям связанной модели прямо в `where`, отдельный
  join не нужен; бюджет по сплит-категории видит именно свою часть суммы,
  не всю транзакцию.
- **`RecurringCheckerService`** — точка создания `Transaction` адаптирована
  на вложенную `lines: { create: [...] }` (сами повторяющиеся правила
  остаются income/expense с одной категорией — split/transfer для них не
  запрошен).
- **Новый под-ресурс `reports/`** — `GET .../reports/monthly?months=N`
  (доход/расход/net worth по месяцам, net worth — не пересчёт с нуля, а
  бегущая сумма `startingBalance + Σincome − Σexpense`, переводы никогда в
  ней не участвуют) и `GET .../reports/categories?month=` (разбивка
  расходов по категориям, `groupBy` на `TransactionLine`).

### Фронтенд

- `transaction-form.tsx` — 3-позиционный переключатель (Расход/Доход/
  Перевод); для расхода/дохода — список строк категория+сумма
  («Разбить по категориям» добавляет строку, автосумма при >1 строке); для
  перевода — «со счёта»/«на счёт» + одна сумма, без категории.
- `transactions-view.tsx` — перевод рендерится своей иконкой
  (`ArrowLeftRight`, нейтральный цвет, без +/−), сплит — бейджем «N
  категорий» вместо одной цветной категории-чипы.
- `panels/finance/reports-view.tsx` (новая вкладка «Отчёты» в
  `FinancePanel`, между «Транзакции» и «Бюджеты») — два самодельных
  SVG-графика без новых зависимостей (тот же принцип, что `Calendar`/
  `TiltCard`): сгруппированные столбцы доход/расход по месяцам + линия
  net worth; плюс горизонтальные полосы (тот же визуальный язык, что
  `ProgressRow`) — топ категорий расходов месяца.
- `DashboardPanel.tsx` — плитка «Финансы»: суммарный баланс
  (`useAccounts`, уже была) + статус бюджетов месяца (`useBudgets`, уже
  была) — без новых бэкенд-запросов, обе есть с v0.8.

### Проверка

`pnpm typecheck && pnpm lint && pnpm test` (29/29) и обе сборки веба
(`build`/`DESKTOP_EXPORT=1 build`, 15/15 страниц) — чисто.

Живой прогон под KAI (curl + JSON-файлы, кириллица инлайн в Git Bash
по-прежнему бьётся, см. v0.7/v0.8): два счёта (1000000/0 копеек) → перевод
500 ₽ → баланс совпал: A=850000 (после перевода и сплита ниже), B=50000;
сплит-операция 800+200 ₽ на две категории → бюджет по одной из них
корректно увидел только свою долю (`spent: 80000`, не всю операцию);
`GET /reports/categories` не показал перевод вообще (только 80000/20000
по двум категориям расхода); `GET /reports/monthly` — `income: 0,
expense: 100000, netWorth: 900000` за месяц операций — совпадает и с
ручным расчётом (`startingBalance 1000000 − 100000`), и с суммой реальных
балансов счетов (850000+50000), подтверждая, что перевод не нужно
учитывать в net worth отдельно. Все тестовые данные удалены после.

Одна находка по пути, не в моём коде: `apps/api/src/events/events.service.ts`
использовал `Prisma.DbNull` (рантайм-константу) при `import type { Prisma }`
— TS1361. Файл принадлежит параллельной сессии (`v0.10`), правка
тривиальна (убрать `type` из импорта) и не трогает их логику — исправлено
по ходу, иначе общий `pnpm typecheck` для `apps/api` не проходил.

Отдельно: во время этой работы **несколько сессий одновременно
редактировали этот репозиторий** (не отдельные worktree — общая рабочая
копия): найдена и подтверждена живая гонка правок на
`transaction-form.tsx`/`transactions-view.tsx` (у другой сессии была
готова более простая версия без split/transfer, у этой — полная по плану)
— по прямому указанию пользователя доведена до конца версия по этому
плану. Также поймана гонка файловой системы веб-дев-сервера
(`packages/ui/src/calendar.tsx` был как раз в процессе переезда в
директорию `calendar/` другой сессией) — починено чистым перезапуском
`dev:web`, тем же приёмом, что уже задокументирован в `v0.6`.

Не пройдено глазами (как и все предыдущие версии): реальный клик по форме
(переключение расход/доход/перевод, добавление строк сплита), графики
отчётов, плитка на дашборде.

## v0.12: модуль «Документы» (файловое хранилище) (СДЕЛАНО — код)

### Контекст

Первый модуль ORION с бинарными данными: дерево папок и файлов внутри
workspace, просмотр содержимого (текст/Markdown/код, изображения, видео/
аудио, PDF, Word, Excel), перемещение/переименование/удаление, загрузка
кнопкой и перетаскиванием (в т.ч. drop файлов из ОС), массовые операции,
корзина, фильтры и сортировка. Прошло через `EnterPlanMode`/`ExitPlanMode`
(план на диске в сессии агента).

Вводит три вещи, которых в проекте не было: (1) хранение блобов за
`StorageAdapter`, (2) авторизованный стриминговый эндпоинт с `Range`,
(3) приём `multipart/form-data`.

### Зафиксированные решения (развилки, выбранные пользователем)

1. **Хранилище — за `StorageAdapter`, драйвер глобально через `.env`**
   (`STORAGE_DRIVER=local|webdav`, неизвестное значение роняет API на
   старте). v1: `local` (диск) и `webdav` (npm `webdav@4`, CJS-сборка). S3 —
   будущий третий драйвер, интерфейс уже подходит.
2. **Локальный/WebDAV драйвер зеркалит реальное дерево каталогов** под
   `STORAGE_DIR` (по прямой просьбе пользователя: «фолдер должен создавать
   папки в винде, где локальные файлы»): папка в приложении = настоящая
   директория, файл = настоящий файл со своим именем, всё открывается в
   Проводнике и бэкапится напрямую. БД авторитетна; путь блоба
   **выводится** из цепочки `parentId` (`folderSegmentsTx` +
   `storageKey(...)`), в БД отдельной колонкой не хранится.
3. **Объём v1**: базовое + **массовые операции** (`POST …/documents/bulk`,
   `op: move|trash|restore|purge`) + **Корзина** (soft-delete `deletedAt`,
   restore, `DocumentTrashPurgeService` — зеркало `NoteTrashPurgeService`,
   `@Cron(3:00)`, `asSystem`, 30 дней, чистит и блобы). Версий файла и
   публичных ссылок в v1 нет.
4. **Просмотрщики — полный набор**, каждый отдельным lazy-чанком: PDF
   (`pdfjs-dist`), Word (`mammoth`, браузерная сборка), Excel/CSV (`xlsx`/
   SheetJS), изображения/видео/аудио — нативно, текст/Markdown/код —
   `MarkdownView`/`<pre>`.

### Модель данных (`schema.prisma`, миграции)

- **`Document`** — одна таблица-дерево: `parentId` self-relation
  (`onDelete: Cascade`), `kind` (`folder|file`), `name`, `mimeType?`,
  `sizeBytes?`, `checksum?` (sha256), `deletedAt?`. `workspaceId` +
  `@@index`. **`parentId` — осознанное отступление** от правила CLAUDE.md
  «без `parentId`»: там иерархия ломала зеркало `notes ↔ tasks` и была не
  нужна при тегах/`[[связях]]`; здесь папки — суть модуля, дерево
  неизбежно.
- Уникальность имени среди «живых» соседей — **в сервисе**
  (`assertNameFreeTx` при rename/move → `409`; `nextAvailableName` из
  `shared-types` — авто-суффикс ` (2)` при create/upload), не БД-
  констрейнтом (soft-delete даёт много `deletedAt`-строк с тем же именем).
- Две миграции: `20260908160100_documents_core` (таблица) и
  `20260908160200_documents_rls` (raw SQL — **точное зеркало**
  `events_calendar_rls`: `ENABLE` + `FORCE` + `documents_isolation` по
  `current_setting('app.current_user_id', true)`).

### Storage-слой (`apps/api/src/storage/`)

- `storage-adapter.ts` — интерфейс (`putFile`/`mkdir`/`move`/`getStream`
  (+`range`)/`remove`/`exists`), DI-токен `STORAGE_ADAPTER`, хелпер
  `storageKey(...segments)` (POSIX-join).
- `local-disk.storage.ts` — `node:fs/promises`, корень `STORAGE_DIR`
  (default `<apps/api>/.data/documents`), защита от `..`-побега,
  `move` = `fs.rename` (переносит поддерево одним вызовом), Range через
  `createReadStream({start,end})`.
- `webdav.storage.ts` — `webdav` client (`putFileContents`/
  `createDirectory`/`moveFile`/`createReadStream({range})`/`deleteFile`),
  всё под `/orion-documents` на шаре.
- `storage.module.ts` — `@Global`, фабрика `STORAGE_ADAPTER` по
  `STORAGE_DRIVER`.
- **Синхронизация БД ↔ диск**: create/upload — блоб, потом строка;
  rename/move — `move` на диске, потом апдейт `parentId`/`name` (потомки
  переезжают вместе, в БД не трогаются); purge — строка (каскад), потом
  `remove` блоба. Провал fs-операции откатывает изменение БД.
- **Корзина на диске**: soft-delete делает `adapter.move` узла в
  `<ws>/.trash/<id>`; restore — `move` обратно (в `uniqueName`, если слот
  заняли), с фолбэком в корень, если исходный родитель тоже в корзине или
  удалён; purge/крон — `remove` из `.trash`.

### Бэкенд-модуль (`apps/api/src/documents/`)

Зеркало `notes/` (`withUser` + `assertMemberTx`, `toDto` внизу файла).
Эндпоинты: `GET /` (`?view`), `POST /` (папка), `POST /upload`
(`FilesInterceptor("files",20)`, лимит `MAX_UPLOAD_MB`, имя из ОС →
`sanitizeSegment` + `nextAvailableName`), `PATCH /:id` (rename/move,
цикл-гард через `isDescendant`), `POST /:id/restore`, `DELETE /:id` (soft),
`DELETE /:id/purge`, `POST /bulk`, `GET /:id/content` (`@Res()`,
`Content-Disposition` inline/attachment, `Accept-Ranges`, одиночный
`Range` → `206`, `parseRange` в сервисе).

### Общий core / фронтенд

- `shared-types/src/document.ts` — схемы + **чистые хелперы**
  (`nextAvailableName`, `isDescendant`, `sanitizeSegment`,
  `isValidDocumentName`), тип экспортируется как **`DocumentItem`** (имя
  `Document` — DOM-глобал, ловушка `Event` из v0.10). Тест
  `document-tree.test.ts` (21 кейс).
- `core/api-client.ts` — методы-зеркало `*Note` + `getDocumentBlob`
  (`requestBlob` — тот же 401→refresh→retry, но `response.blob()`).
  **Точечная правка `request()`**: `body instanceof FormData` → не ставить
  `Content-Type`, тело как есть. Тесты в `api-client.test.ts` (FormData без
  JSON-заголовка; `requestBlob` через ротацию токена).
- `core-react/use-documents.ts` — `useDocuments`/`useCreateFolder`/
  `useUploadDocuments`/`useRenameOrMoveDocument`/`useRestore|Delete|Purge`/
  `useBulkDocuments` (`queryKey: ["documents", wsId]`), `useDocumentBlob`
  (`staleTime: Infinity`).
- `packages/ui/src/file-preview.tsx` (+ `file-preview/{pdf,docx,sheet}-view.tsx`)
  — `<FilePreview>`, `React.lazy` на три тяжёлых рендерера. `sidebar.tsx`/
  `workbench.tsx` не тронуты. Воркер pdf.js кладётся статикой в
  `apps/web/public/pdf.worker.min.mjs` скриптом `scripts/copy-pdf-worker.mjs`
  (перед dev/build; `new URL(...import.meta.url)` не годится — Terser падает
  на ESM-воркере). Новые зависимости `pdfjs-dist`/`mammoth`/`xlsx` —
  **явное исключение** из «UI-примитивы руками», как редактор v0.9.
- `apps/web/panels/DocumentsPanel.tsx` — мастер-деталь как `NotesPanel`:
  хлебные крошки, список текущей папки (папки сверху), правая панель
  `<FilePreview>` (двухпанельный ≥760px, иначе `Sheet`); загрузка кнопкой и
  **нативный DnD** (drop файлов из ОС на тело/строку-папку → upload; drag
  строк на папку/крошку → move; module-ref, не `dataTransfer`, как в
  `calendar`/`TasksPanel`); чекбоксы + панель массовых действий; чипы
  фильтра по типу (`document-icons.ts`), сортировка Имя/Дата/Размер/Тип,
  поиск по имени; `MoveDialog` — дерево папок с блокировкой поддерева
  переносимого; `SegmentedControl` Активные/Корзина. Регистрация —
  одна строка в `panel-registry.ts`.

### Осознанные отступления (в CLAUDE.md)

1. `Document.parentId` — иерархия, исключение из «без `parentId`».
2. `pdfjs-dist`/`mammoth`/`xlsx` в `packages/ui` — тяжёлые lazy-зависимости,
   как редактор v0.9.
3. Бинарное хранилище за `StorageAdapter`; `local`/`webdav` зеркалят
   реальное дерево каталогов, путь производный от дерева БД.
4. `documents/:id/content` — первый авторизованный бинарный стрим с `Range`.
5. `multipart/form-data` на `/upload` — первое не-JSON тело запроса.

### Проверка

- `pnpm typecheck` (7/7) · `pnpm lint` (чисто) · `pnpm test` — **57/57**
  (+21 `document-tree.test.ts`, +2 `api-client.test.ts`) · `pnpm --filter
  @orion/web build` и `build:desktop` — **16/16 страниц** (`/panel/[panelId]`
  получил путь `documents`). Всё прогнано в этой сессии.
- Prisma-клиент уже перегенерирован параллельной сессией и содержит модель
  `Document` (`apps/api` typecheck зелёный).
- **Отложено** (нужен Postgres; `dev:api` держит DLL движка Prisma — см.
  заметки прошлых версий): `pnpm db:migrate` (2 миграции), живой прогон под
  KAI: создание папки, upload (`curl -F file=@… -F parentId=…`) → на диске
  под `STORAGE_DIR` видно `<ws>/<Папка>/файл`, `GET /:id/content` (байты +
  `Range: bytes=0-99` → `206`), move (диск+БД) + цикл-гард `400` +
  `PATCH {name:"a:b"}` → `400`, bulk trash → каскад на детей → `?view=trash`
  → restore/purge (строки + блобы из `.trash`), крон
  `DocumentTrashPurgeService.runPurge()` через одноразовый
  `createApplicationContext`, RLS (второй юзер → `403`; `psql` под
  `orion_app` без `app.current_user_id` → 0 строк), драйвер `webdav`
  (`rclone serve webdav`).
- **Живьём не гонялось** (как все прошлые версии): реальный клик — DnD
  файлов из ОС и между папками, превью каждого типа (PDF/DOCX/XLSX/PNG/
  MP4/MD), массовые операции, `MoveDialog`, корзина.

## v0.13: «Финансы» — архивация, пагинация, теги+правила, цели, сверка, диапазон дат (СДЕЛАНО)

### Контекст

Продолжение v0.11 по запросу «продумать, что ещё нужно модулю». Из
брейнсторма (`AskUserQuestion`, два раунда) выбрано шесть пунктов: два
реальных технических хвоста, найденных в самом коде (`archivedAt` был в
схеме и в API счетов/категорий с v0.8, но фронтенд им никогда не
пользовался; список транзакций не был пагинирован — при разрастании
истории отдавал бы всё разом), и четыре новые фичи (теги+правила
автокатегоризации, цели накопления, сверка счёта, произвольный диапазон
дат в отчётах/списке). CSV-импорт банковских выписок и автоопределение
повторяющихся платежей — осознанно отложены пользователем как отдельные
большие задачи, не часть этого раунда.

Нумерация снова разъехалась тем же образом, что в v0.11: пока шла эта
работа, параллельная сессия заняла `v0.12` под модуль «Документы» —
раздел про финансы стал `v0.13`.

Два архитектурных решения приняты явно пользователем (`EnterPlanMode` →
два вопроса → `ExitPlanMode`):

- **Цель накопления привязана к одному конкретному счёту**, а не ведёт
  отдельную бухгалтерию взносов — `currentAmount` в ответе `GoalsService`
  это просто уже посчитанный баланс того счёта (`startingBalance` + тот же
  `computeNetByAccount`, что и у `AccountsService`). Пополнение — обычная
  доходная операция на этот счёт, ничего специального.
- **Сверка — простая**: ввёл фактический баланс → если он расходится с
  расчётным, `AccountsService.reconcile` создаёт одну корректирующую
  `Transaction` (`income`/`expense` по знаку разницы, без категории,
  `note: "Сверка баланса"`). Никакого cleared/uncleared на каждой
  транзакции — сознательно упрощённая модель, как в остальных местах v0.

### Бэкенд

- **Архивация** — `AccountsService.list`/`CategoriesService.list` получили
  `includeArchived = false` по умолчанию (фильтр `archivedAt: null`),
  контроллеры — `?includeArchived=`. Поле уже читалось/писалось в
  update-путях с v0.8 — не хватало только фильтрации в `list`.
- **Пагинация** — `TransactionsService.list` получил `limit`/`offset`
  (`take`/`skip` в Prisma, дефолт `limit=50`, `DEFAULT_PAGE_SIZE`). Ответ
  остаётся плоским массивом без обёртки/total — фронт узнаёт «есть ли
  ещё» по `items.length === limit`.
- **Теги** — `Transaction.tags: String[] @default([])`, тот же плоский-
  массив приём, что `Note.tags`; `create`/`update` пробрасывают как есть,
  `list` получил `?tag=` (`where: { tags: { has: tag } }`).
- **Правила автокатегоризации** — новый под-модуль `finance/
  category-rules/` (`CategoryRulesController`/`Service`), простой CRUD
  без `update` (правило дешевле удалить и пересоздать, чем патчить).
  Матчинг подстроки — **только на фронтенде** (`TransactionForm`), сервер
  никогда не переписывает категорию сам.
- **Цели** — новый под-модуль `finance/goals/`
  (`GoalsController`/`Service`): `list`/`create`/`update` считают
  `currentAmount` через вынесенный в `finance-refs.util.ts`
  `computeNetByAccount` (был приватной функцией внутри
  `accounts.service.ts` — переехал, чтобы не дублировать формулу баланса).
  `accountId` проверяется через `assertAccountInWorkspace`, как у
  транзакций/повторяющихся правил.
- **Сверка** — `POST .../accounts/:accountId/reconcile`
  (`AccountsService.reconcile`): `diff === 0` — no-op, счёт возвращается
  без изменений, никакой пустой корректировки не создаётся.
- **Диапазон дат** — `finance-refs.util.ts` получил `explicitRange(from?,
  to?)` рядом с уже существующим `monthRange(month?)`: если задан
  `from`/`to`, он побеждает `month`. Использован в
  `TransactionsService.list` и `ReportsService.categoryBreakdown` (эта
  вторая сменила сигнатуру с `(userId, workspaceId, month: string)` на
  `(userId, workspaceId, { month?, from?, to? })` — контроллер и
  `api-client`/хук обновлены синхронно).

### shared-types

`transactionSchema`/`createTransactionInputSchema`/
`updateTransactionInputSchema` — `tags: string[]`. Новые:
`reconcileAccountInputSchema`, `categoryRuleSchema`+
`createCategoryRuleInputSchema` (без update-схемы — см. выше),
`savingsGoalSchema` (с вычисляемым `currentAmount`)+`create`/
`updateSavingsGoalInputSchema`. Всё — в `finance.ts`, том же файле, что и
остальное семейство.

### Фронтенд

- **Архивация** — `AccountsView`/`CategoryManagerModal` получили
  переключатель «Активные/Все» (`SegmentedControl`) и пункты
  «Архивировать»/«Восстановить» в `DropdownMenu` рядом с «Удалить».
  Формы (`TransactionForm`, `RecurringForm`, `BudgetForm`) получают
  активный список через хуки; если редактируемая запись ссылается на уже
  архивный счёт/категорию, он не пропадает из `<Select>` — общий хелпер
  `lib/finance-options.ts#withArchivedFallback` добавляет его отдельно с
  припиской «(архив)».
- **Пагинация** — `TransactionsView`: локальный `limit` (старт 50),
  кнопка «Показать ещё» добавляет +50 и рефетчит; видна, пока
  `transactions.length === limit`.
- **Теги** — небольшой инлайн тег-инпут в `transaction-form.tsx` (Enter/
  запятая добавляют тег, Backspace на пустом поле удаляет последний) —
  не переиспользован из `NotesPanel`, продублирован осознанно (см. план):
  тот файл в это время активно правила другая сессия. Фильтр по тегу в
  `TransactionsView` — чипы над списком, собранные из тегов уже
  загруженной страницы.
- **Правила автокатегоризации** — раздел «Правила автокатегоризации» в
  `CategoryManagerModal` (список + форма `текст → категория`, под
  списком категорий). `TransactionForm` подставляет категорию в первую
  строку при вводе заметки, **только если** пользователь ещё не выбрал
  категорию сам (флаг `categoryAutoFilled`, сбрасывается при ручном
  выборе в `<Select>`).
- **Цели** — новая вкладка «Цели» в `FinancePanel` (после «Счета»):
  `goals-view.tsx` + `goal-form.tsx`, тот же визуальный язык прогресс-
  бара, что бюджеты, плюс «осталось N дней»/«просрочено» при заданной
  `targetDate`.
- **Сверка** — пункт «Сверить баланс» в `DropdownMenu` счёта →
  `Modal` с полем фактического баланса → тост с суммой корректировки
  (или «Баланс совпал» при `diff === 0`).
- **Диапазон дат** — `TransactionsView`: два `<input type="date">` рядом
  с фильтрами счёта/категории. `ReportsView`: разбивка по категориям
  получила собственный независимый month-picker (←/месяц/→, тот же
  паттерн, что `BudgetsView`) — раньше была жёстко привязана к
  последнему месяцу месячной сводки.

### Проверка

`pnpm typecheck` (7/7) · `pnpm lint` (чисто) · `pnpm test` — **57/57** ·
обе сборки веба (`pnpm --filter @orion/web build` и `DESKTOP_EXPORT=1
build`) — **16/16 страниц**, обе чисто.

Живой прогон под KAI (curl + JSON-файлы в скретчпаде — кириллица инлайн
в Git Bash по-прежнему бьётся, см. v0.7): счёт → архивация → пропал из
`GET /accounts` (активный список), появился с `?includeArchived=true` →
восстановлен. Тегированная транзакция («Кофе», теги `кофе`/`тест`) →
`?tag=кофе` (URL-кодированная кириллица) нашёл её и только её. 55 плоских
транзакций + 1 тегированная на счету → `?limit=50` отдал ровно 50,
`?limit=50&offset=50` — оставшиеся 6. Цель на счёте (`targetAmount`
500000) сразу показала `currentAmount: 94000` (уже существующий баланс
счёта); после доходной операции +20000 — `currentAmount: 114000`, ровно
на сумму пополнения. Сверка: расчётный баланс 114000 → ввод фактического
200000 → корректирующая `income`-операция на 86000, новый расчётный
баланс — ровно 200000. Правило автокатегоризации создано и вернулось из
`GET /category-rules` (фронтенд-матчинг не гонялся curl'ом — по плану
проверяется вручную в браузере). `GET /transactions?from=&to=` за
календарные сутки 8 сентября отдал ровно 3 операции (тегированная +
пополнение цели + сверка), не более. `GET /reports/categories?from=&to=`
за произвольный диапазон 1–8 сентября корректно просуммировал
некатегоризированные расходы (55×100 + 500 = 6000 «Без категории»), не
задев доходные операции. Все тестовые счета/категории/цели/правила
удалены после проверки — `GET`-и по каждому ресурсу с `includeArchived=
true` подтвердили пустой результат.

Не пройдено глазами (как все предыдущие версии): реальный клик — тумблер
архива, drag поведение тегов, авто-подстановка категории по заметке в
браузере, кнопка «Показать ещё», прогресс-бар цели, форма сверки,
переключение месяца в разбивке по категориям.

---

## v0.14: платформенный слой — проекты, инбокс, поиск, настройки (ДОДЕЛАНО)

### Контекст

Волна `platform_foundation` (миграции `20260909235500`/`…_rls`) была написана
наполовину: бэкенд-модули, схема и контракты появились, а клиентский срез —
нет. При этом дерево **не собиралось**: `pnpm typecheck` падал в четырёх
пакетах, `pnpm test` — на одном кейсе, `finance_transaction_lines` (v0.11)
осталась единственной workspace-таблицей без RLS, а `docs/PLAN.md` и
`CLAUDE.md` о новых модулях вообще не знали. Этот раздел — про то, что
доведено до рабочего состояния.

### Что было сломано и как починено

- **Контракт auth разошёлся с клиентом.** `sessionUserSchema` получила
  `.default(0)`/`.default(null)` на `passwordStrength`/`passwordChangedAt` —
  у *response*-схемы это лишнее (сервер всегда отдаёт оба поля), а входной тип
  zod перестал совпадать с выходным, из-за чего `request<AuthResponse>` в
  `ApiClient` перестал компилироваться. Дефолты убраны, поля стали
  обязательными, тест `schemas.test.ts` теперь проверяет в том числе, что
  ответ без них **отклоняется**. Там же нашлись две рукописные копии
  `SessionUser` (`packages/core/src/api/api-client.ts` в `me()` и
  `packages/core-react/src/use-auth.ts`) — обе заменены на тип/схему из
  `shared-types`.
- **DTO не догнали новые колонки**: `projectId` у заметок, `currency` у счетов,
  `projectId`/`reconciledAt`/`importedRef` у транзакций, `projectId`/
  `extractedText` у документов. `toDto` собирается руками (инвариант проекта),
  поэтому каждая новая колонка требует правки — компилятор теперь это
  показывает.
- **`Prisma.DbNull` при `import type { Prisma }`** в `tasks.service.ts` — тот
  же TS1361, что чинили в `events.service.ts` в v0.11 (регресс).
- **`FinanceCategory.projectId`** оказался полем, которого нет ни в
  `schema.prisma`, ни в миграциях — контракт его выдумал. Удалён из
  `financeCategorySchema`. Обратный случай: `Transaction.projectId` есть в БД
  и в create/update-входах, но отсутствовал в *ответе* — добавлен (и сервис
  теперь его действительно пишет, `assertProjectInWorkspace` в
  `finance-refs.util.ts` проверяет, что проект из этого же пространства).
  `Event.calendarConnectionId` — та же история, добавлен в `eventSchema`.
- **Пять статусов задачи вместо трёх.** Контракт получил
  `backlog|todo|in_progress|done|canceled`, а тест, доска и все счётчики
  «открытых» остались на трёх. Появился `isTaskClosed` /
  `TASK_CLOSED_STATUSES` в `shared-types/src/task.ts` — **одно** место, где
  решается «задача ещё открыта». До этого шесть мест по коду сравнивали со
  строкой `"done"` вручную, и отменённая задача считалась просроченной
  (счётчик в сайдбаре, крон `DueTaskCheckerService`, напоминания в Tauri,
  `Calendar.overdue`, `blocked` у зависимостей, дашборд).
- **`Account.currency` не сохранялась при создании** (колонка оставалась
  `'RUB'`, что бы ни прислал клиент) — исправлено; `formatMoney` получил
  необязательный код валюты, суммы счетов/целей/сверки показываются в валюте
  счёта. Конвертации между валютами по-прежнему нет (нет источника курсов) —
  это осознанное ограничение модели «одна валюта на пространство».
- **`Document.extractedText` никто не заполнял** — глобальный поиск читал его
  для документов и всегда получал пустую строку. Теперь текст извлекается при
  загрузке для текстовых форматов (`extractText`, до 200 КБ); PDF/Word/Excel
  остаются доступны по имени, без парсера на бэкенде. Заодно
  `documents.service.update` перестал молча игнорировать `projectId`.

### Что доделано по вертикали

- **Проекты** — первый класс: `Project` был только в API. Добавлены
  `use-projects.ts`, панель «Проекты» (прогресс, счётчики, бюджет/потрачено,
  лента активности, архив) и выбор проекта в форме задачи/заметки/события.
  `Task.projectTag` остался производным от `projectId` (сервер выводит его в
  `resolveProjectTx`), поэтому доска группируется по тегу как раньше, но
  перетаскивание в колонку реального проекта теперь ставит `projectId`.
- **Инбокс** — `use-inbox.ts` + панель: быстрый захват и разбор в
  задачу/заметку/событие с автопереходом в соответствующую панель.
- **Центр уведомлений** — `use-notifications.ts` + колокольчик с бейджем
  непрочитанных в шапке сайдбара (список, «прочитать все», удаление).
- **Глобальный поиск** — `use-search.ts` + встроен в ⌘K-палитру (серверный
  поиск по шести модулям с дебаунсом; локальные команды фильтруются как
  раньше). Заодно в палитру добавлены команды новых панелей.
- **Настройки** — панель с профилем, сменой пароля, списком устройств
  (отзыв сессий, «выйти на всех»), предпочтениями уведомлений/вида и
  сведениями о приложении (`/system/info`, `/system/health`).
- **Сохранённые виды задач** — `use-task-views.ts` + полоса видов в шапке
  доски. Вид хранит то, что доска умеет восстановить (поиск и проект) —
  `statuses`/`priorities`/`due` из контракта не пишутся, чтобы не обещать
  фильтр, которого в UI нет.
- **Зависимости и повтор задач** — в форме задачи появились выбор
  «зависит от» (по нему `blocked` подсвечивается бейджем на карточке) и
  поле повтора (`freq` + интервал).
- **Дисковая оптимизация** (см. v0.15) и **страховочный тест RLS**: тест
  читает `pg_class`/`pg_policies` и требует `ENABLE` + `FORCE` + минимум одну
  политику у **каждой** таблицы с колонкой `workspaceId`. Именно такой тест
  поймал бы пропуск у `finance_transaction_lines` два релиза назад.

### Чего в v0.14 сознательно нет

- **Версии документов и аннотации** (`document_versions`,
  `document_annotations` — таблицы и схемы в контракте есть, сервисов нет) и
  **вложения заметок** (`note_attachments`, контракта нет вовсе). Версии
  файла и публичные ссылки были явно исключены из v1 документов (см. v0.12),
  вложения заметок отложены в v0.9 до появления хранилища — оно появилось, но
  это отдельный вертикальный срез, а не хвост платформенного слоя. Таблицы
  оставлены как задел; при желании их лучше либо дореализовать одним заходом,
  либо удалить вместе с контрактами, чтобы схема не обещала больше кода.
- **Входящая синхронизация внешних календарей в UI**: API
  (`calendar-connections`) и поля события (`source`, `readOnly`,
  `calendarConnectionId`) готовы, панели управления подключениями пока нет.

### Проверка (v0.14)

- `pnpm typecheck` — 7/7 пакетов; `pnpm lint` — чисто; `pnpm test` — 59/59
  (+1 кейс `isTaskClosed`, обновлённые кейсы статусов и auth-ответа).
- `pnpm --filter @orion/web build` и `DESKTOP_EXPORT=1 build` — см. v0.15.
- **Требует Docker и на этой машине не прогонялось**: применение новых
  миграций (`pnpm db:migrate`), `pnpm test:integration` (в нём появились два
  новых кейса: структурная проверка RLS-покрытия и изоляция
  `finance_transaction_lines`), живые прогоны новых панелей.

---

## v0.15: стабилизация — зелёный гейт, RLS-дыра, вес репозитория

### RLS-дыра

`finance_transaction_lines` (v0.11) несёт денормализованный `workspaceId`
именно ради плоской политики — и политики не получила: ни `ENABLE`, ни
`FORCE`, ни `CREATE POLICY` в миграциях нет, хотя комментарий в
`20260908190728_finance_tags_rules_goals_rls` ссылается на неё как на пример
RLS для модуля. Таблица всегда достигается через `finance_transactions`
(под RLS), поэтому это была дыра в предохранителе, а не открытая дверь — но
ровно та, против которой писался v0.2/v0.4. Закрыто новой миграцией
`20260910090000_finance_transaction_lines_rls` (плюс поведенческий и
структурный тесты в `apps/api/test/api-rls.integration.test.ts`).

Старые миграции не редактировались сознательно: Prisma хранит контрольную
сумму применённой миграции, и правка комментария в уже применённом файле
ломает `migrate deploy`. Устаревшая ссылка объяснена в комментарии новой
миграции.

### Вес репозитория

«Проект весит почти 7 ГБ» — это были артефакты сборки, а не код:

| Что | Было | Стало |
|---|---|---|
| `apps/desktop/src-tauri/target` (Rust-кэш `tauri build`) | 5.29 ГБ | 0 (удалён, регенерируется `cargo`/`tauri build`) |
| `apps/web/.next` + `.next-desktop` | 0.35 ГБ | 0 (регенерируется `next dev`/`build`) |
| `node_modules` (pnpm) | 0.94 ГБ | 0.94 ГБ (нужен для работы; в `.gitignore`) |
| **Весь репозиторий** | **6.62 ГБ** | **0.97 ГБ** |
| Исходники без `node_modules`/артефактов | — | ~5.8 МБ |

Всё удалённое уже было в `.gitignore` (`target`, `.next`, `out`,
`*.tsbuildinfo`), т.е. в git ничего из этого и не попадало. Отдельно стоит
глобальный pnpm-store (`%LOCALAPPDATA%\pnpm\store`, ~2.9 ГБ) — он вне
репозитория, общий для всех проектов машины, чистится `pnpm store prune`.

### Проверка (v0.15)

`pnpm typecheck` — 7/7 пакетов; `pnpm lint` — чисто; `pnpm test` — 59/59;
обе сборки веба — **20/20 статических страниц** (`/panel/[panelId]` получил
пути `projects`, `inbox`, `settings` — было 16/16). Размер клиента остался
здоровым, потому что панели грузятся по требованию: общий для всех
First Load JS — 87.9 кБ, а `/panel/[panelId]` (самая тяжёлая точка входа,
внутри — редактор/превью конкретной панели) — 64.7 кБ маршрута / 523 кБ
первой загрузки. Тяжёлые зависимости (`pdfjs-dist`, `mammoth`, `xlsx`,
CodeMirror) остаются внутри своих ленивых чанков и в оболочку не попадают.

`pnpm clean` (новый скрипт, `scripts/clean.mjs`) удаляет регенерируемые
артефакты по белому списку и по построению не трогает `apps/api/.data`
(загруженные пользователем документы) и `.git`; `--dry-run` показывает, что
будет удалено, `--deps` добавляет `node_modules`.

---

## v0.16: внутрянка — настройки, которые наконец работают

### Контекст

Docker снова поднят, поэтому первым делом применены все накопленные миграции
(`prisma migrate deploy` — не `dev`, чтобы исключить случайный сброс живой
базы) и прогнаны интеграционные тесты. Оказалось, что до этого **ни один**
платформенный модуль v0.14 не выполнялся ни разу: 27 миграций были
применены, но код новых модулей жил только в типах. Добавлены интеграционные
тесты на весь этот срез (проекты, инбокс, связи, поиск, настройки, сессии,
health) — он работает.

Дальше — главный долг: `UserPreference` был **write-only**. Тумблеры
`taskReminders`/`eventReminders`/`financeAlerts`, тихие часы и
`desktopNotifications` сохранялись и никем не читались: крон слал в Telegram
и в ленту уведомлений независимо от настроек, а `financeAlerts` вообще не
имел ни одного производителя уведомлений (то есть выключать было нечего).

### Что сделано

- **Чистая логика тихих часов — в контракте** (`shared-types/src/settings.ts`):
  `parseClockMinutes`, `localMinutesOfDay` (через `Intl`, без date-библиотек) и
  `isWithinQuietHours`. Так решено потому, что окно тихих часов должны
  одинаково понимать **оба** конца: API глушит серверные напоминания, а
  десктопная оболочка — нативные тосты. Плюс 10 юнит-тестов, которые
  попутно поймали, что тесты были написаны в предположении UTC на машине
  разработчика (теперь зона передаётся явно, а один кейс проверяет
  host-зону без привязки к конкретному смещению).
  Правила, зафиксированные явно: пустая/битая граница — «не тихо» (нельзя
  молча заглушить всё); равные границы — пустое окно, а не «весь день»;
  `начало > конец` пересекает полночь.
- **`NotificationPolicyService`** (`apps/api/src/notifications/`) — одно место,
  отвечающее на вопрос «доставлять ли напоминание сейчас». Чьи настройки:
  владельца пространства (напоминания workspace-scoped, а `notifications`
  не имеет `userId`; ORION сегодня однопользовательский — per-member политики
  потребовали бы per-user таблицы уведомлений, это отдельный шаг). Нет
  владельца/строки настроек — доставляем (никогда не глушим себя молча).
  Результат кэшируется на минуту (кроны спрашивают по каждой строке), а
  `SettingsService.update` сбрасывает кэш — иначе выключенный тумблер ещё
  минуту продолжал бы слать, что выглядит как тот же баг.
- **Крон задач и крон событий** теперь спрашивают политику и возвращают
  `{ notified, skipped }`; «пропущено» **не** помечается `notifiedAt`/
  `SentReminder` — напоминание не теряется, а срабатывает, когда настройки
  снова разрешат. Ручной триггер `POST /notifications/check-due` политику
  сознательно игнорирует (пользователь явно попросил сейчас).
- **Десктопные тосты** (`useDesktopDueReminders`) уважают
  `desktopNotifications` + `taskReminders` + тихие часы через ту же функцию из
  контракта. Лента уведомлений в приложении не глушится — это список,
  который открывают, а не прерывание.
- **`financeAlerts` получил смысл — алерты о превышении бюджета**
  (`apps/api/src/finance/budget-alerts.service.ts`): после записи расхода
  проверяются бюджеты его категорий за этот месяц, при превышении лимита
  создаётся уведомление `finance_alert` и (best-effort, уже после коммита)
  сообщение в Telegram. Дедуп — по паре «бюджет + месяц» в `entityId`
  (`<budgetId>:<YYYY-MM>`), поэтому правка одной операции не даёт три алерта.
  Правило «сколько потрачено» вынесено в `finance-refs.util.budgetSpentTx` —
  раньше оно было приватным в `BudgetsService`, и вторая копия неизбежно
  разошлась бы с первой.
- **Внешние календари синхронизируются сами**: `@Cron(EVERY_30_MINUTES)` в
  `CalendarConnectionsService`, общий `performSync` для ручного пути
  (`withUser`) и крона (`asSystem`), ошибка одной подписки не мешает
  остальным и остаётся в `lastError` строки.
- **Акцент и плотность из настроек реально применяются.** `accent` в
  `tailwind.config.js` стал CSS-переменной в виде каналов
  (`rgb(var(--orion-accent) / <alpha-value>)`, поэтому модификаторы
  прозрачности продолжают работать), палитры — в `globals.css`,
  `PreferencesEffect` проставляет `data-accent`/`data-density` на `<html>`.
  Плотность сделана масштабом корневого `font-size` (14px в компактном
  режиме) — все утилиты Tailwind в проекте rem-based, поэтому одна строка
  уплотняет интерфейс целиком. Значения по умолчанию совпадают с прежним
  видом до байта, так что для тех, кто не открывает настройки, ничего не
  меняется.
- **Тема честно убрана из панели**: приложение рендерится в тёмной теме
  dockview, светлой палитры нет. Поле остаётся в профиле под будущее, но
  переключателя, который ничего не делает, больше нет — вместо него строка
  текста, объясняющая почему.

### Проверка

- `pnpm typecheck` (7/7, включая `apps/api/test`) · `pnpm lint` чисто ·
  `pnpm test` — **69/69** (+10 кейсов тихих часов).
- `pnpm test:integration` — **8/8** на живой PostgreSQL: изоляция (заметки,
  строки транзакций), структурная проверка RLS по всем таблицам, сквозной
  прогон платформенного среза, гейт напоминаний по настройкам, алерты бюджета
  (с дедупом и с выключенным `financeAlerts`), импорт ICS через
  запланированный проход и удаление событий, которых больше нет в фиде.
- `pnpm --filter @orion/web build` — успешно; в собранном CSS проверено, что
  переменные акцента и правило плотности на месте, а `bg-accent/15`
  компилируется в `rgb(var(--orion-accent)/.15)`.

### Что осталось из «внутрянки» (план следующего шага)

- Связи между сущностями (`entity_links`): API и хуки есть, UI нет.
- Подзадачи (`Task.parentId`) и ручной порядок (`Task.sortOrder`).
- Вложения заметок (`note_attachments`): таблица есть, контракта/сервиса нет.
- Учёт времени и привычки — новые модули.
- Мёртвые контракты: `financeImportResultSchema`, `financeForecastPointSchema`,
  `shareSelectorSchema`, `connectionLinkSchema`, `documentVersionSchema`,
  `documentAnnotationSchema` — решить (реализовать или удалить).

---

## v0.17: внутрянка — то, что бэкенд уже умел, но в UI не существовало

Три среза, каждый — «у API это есть с v0.14, у пользователя этого нет».

### Связи между сущностями (`entity_links`)

Типизированные связи «что с чем связано»: API, проверки принадлежности
пространству и хуки (`useEntityLinks` / `useCreateEntityLink` /
`useDeleteEntityLink`) были с v0.14, но в интерфейсе их не было нигде — то
есть связи между модулями существовали только в базе.

- `apps/web/components/entity-links.tsx` — один универсальный компонент
  (`workspaceId`, `type`, `id` на входе): список связей с иконкой по типу,
  добавление и удаление. Цель ищется **через глобальный поиск** (`q` ≥ 2
  символа), а не выпадающим списком всех задач/заметок/документов
  пространства — это тот же эндпоинт, что и в ⌘K.
- Подключён в карточку задачи (Sheet), редактор заметки и детали проекта.
  Добавить его к новой сущности — одна строка.

### Подзадачи и ручной порядок

- **Подзадачи** (`Task.parentId`): секция «Подзадачи» в деталях задачи
  (`apps/web/panels/tasks/subtasks.tsx`) — чекбокс done/todo, клик по
  заголовку открывает эту задачу в том же Sheet, поле «Новая подзадача»,
  счётчик «Сделано N из M», кнопка «Открыть родителя». В форме задачи
  появился выбор родителя, причём список **исключает саму задачу и всех её
  потомков** — иначе клиент отправлял бы цикл, который API справедливо
  отвергает 400.
- **Ручной порядок** (`Task.sortOrder`): в колонках статусов база — стабильная
  сортировка по `sortOrder`, поверх неё дети вставляются сразу под своим
  родителем (дети, чей родитель в другой колонке или отфильтрован, остаются
  на общем уровне с маркером «└»). Порядок меняется двумя способами: drag
  карточки на карточку (`sortOrder` = середина между соседями, для первого
  элемента −1000) и пункты «Вверх»/«Вниз» в меню карточки — они работают с
  клавиатуры и меняют значения соседей местами. Обмен с собственным
  поддеревом запрещён: на экране он ничего не изменил бы.
- Модель данных и API не менялись: `parentId`/`sortOrder` принимаются
  `updateTaskInputSchema` с v0.14, а гварды (`assertParentTx`) существовали,
  но **никогда не проверялись** — теперь на них есть интеграционный тест
  (self-parent → 400, цикл → 400, чужой родитель → 404, `sortOrder`
  сохраняется, зависимость на чужую задачу → 404).

### Вложения заметок (`note_attachments`)

Таблица была создана миграцией `platform_foundation` и закрыта RLS, но кода
не существовало ни на одном слое.

- **Хранилище не дублируется**: `NoteAttachmentsService` ищет-или-создаёт
  папку «Вложения заметок» в корне пространства и загружает файлы через
  `DocumentsService.upload` — то есть файл лежит в модуле «Документы» со
  своим checksum, дедупом имён и общим `StorageAdapter` (`local|webdav`).
  Своего файлового слоя у заметок нет.
- **`remove` удаляет только связь**, не документ: файл может быть привязан к
  нескольким заметкам и вообще жить отдельно; байты удаляет единственный
  хроник — `DocumentTrashPurgeService`, а строки-связи уходят каскадом.
- Эндпоинты: `GET/POST …/notes/:noteId/attachments`,
  `POST …/attachments/upload` (`multipart/form-data`, до 20 файлов, лимит
  `MAX_UPLOAD_MB` — общий с документами: `MAX_UPLOAD_BYTES` вынесен в
  `apps/api/src/common/multipart.ts`), `DELETE …/attachments/:attachmentId`.
- UI: секция «Вложения» в редакторе заметки (`apps/web/panels/note-attachments.tsx`) —
  загрузка кнопкой и drag&drop, список с размером, просмотр через готовый
  `FilePreview` (blob через `useDocumentBlob`), удаление через `ConfirmDialog`
  с явным «файл останется в модуле Документы».

### Мёртвые контракты: решено не удалять, а помечать

Разбор показал, что это не случайный мусор, а задел, у которого в трёх файлах
из четырёх не было пояснения. `sync.ts` прямо писал «Стадия 3 — тип готовим
заранее», а `financeImportResult`/`financeForecastPoint` и
`documentVersion`/`documentAnnotation` выглядели как описание существующего
API (именно на этом я сам споткнулся при аудите). Решение: оставить схемы
(дизайн уже продуман — например, под импорт выписок есть уникальный индекс
`(workspaceId, importedRef)`), но **явно помечать их «ЗАРЕЗЕРВИРОВАНО, кода
нет»** с указанием, где искать решение об отложенности.

### Проверка (v0.17)

- `pnpm typecheck` (7/7) · `pnpm lint` чисто · `pnpm test` — 69/69.
- `pnpm test:integration` — **10/10** на живой PostgreSQL, включая новый кейс
  на иерархию задач и покрытие вложений (upload с кириллическим именем,
  409 на повтор, 404 на чужой документ, detach не удаляет документ,
  RLS-невидимость строк вложений для второго пользователя).
- `pnpm --filter @orion/web build` — см. итог сессии.

---

## v0.18: «Учёт времени» — первый новый модуль внутренней волны

### Контекст

После срезов «доделать обещанное» (v0.16–v0.17) — первый действительно новый
модуль из согласованного плана. Причина, по которой он первый: время —
единственная метрика, которой не хватало на стыке уже существующих модулей
(задачи × проекты × финансы). Всё остальное про них уже известно: что сделано,
на сколько, за сколько; «сколько это заняло» — нет.

### Модель данных и миграции

Две миграции, как принято в проекте (сначала таблица, потом RLS):

- `20260910200413_time_entries` — модель `TimeEntry`: `workspaceId`, `taskId?`,
  `projectId?`, `note`, `startedAt`, `endedAt?`. **`endedAt = null` означает
  «таймер идёт прямо сейчас»** — поэтому тикающий таймер не пишет в базу
  вообще ничего (клиент считает `now - startedAt`), а «что сейчас запущено» —
  это один индексный поиск, а не отдельная таблица состояния.
- В той же миграции — **партиальный уникальный индекс**
  `("workspaceId") WHERE "endedAt" IS NULL`: «один запущенный таймер на
  пространство» гарантирует база, а не только сервис. Две вкладки, нажавшие
  «Старт» в одну миллисекунду, получают 409 (P2002 → ConflictException), а не
  два параллельных таймера. Prisma не умеет выражать `WHERE`-индексы в схеме —
  тот же приём, что у GIN-индексов полнотекстового поиска (v0.7).
- `20260910200500_time_entries_rls` — `ENABLE` + `FORCE` + политика по
  `current_setting('app.current_user_id', true)`, как у всех workspace-таблиц.
  Структурный интеграционный тест теперь проверяет и её.

### API (`apps/api/src/time/`)

Зеркало `notes/`/`tasks/`: `assertMemberTx` + `withUser`, zod-пайп, `toDto`
внизу файла. Маршруты:

| Метод | Путь | Смысл |
|---|---|---|
| `GET` | `…/time?from&to&taskId&projectId` | список (окно — как у календаря), до 500 строк |
| `GET` | `…/time/running` | запущенная запись или `null` |
| `POST` | `…/time/start` | старт; **409**, если таймер уже идёт |
| `POST` | `…/time/stop` | стоп (`at?` — «остановить на 12:30»); **404**, если нечего останавливать |
| `POST` | `…/time` | ручная запись (вчера с 10 до 12) |
| `PATCH` | `…/time/:entryId` | правка; диапазон проверяется по **смёрженной** записи (как `assertTransactionShape` в финансах) |
| `DELETE` | `…/time/:entryId` | удаление |

`projectId` **денормализуется из задачи**, если не передан явно: панель
суммирует часы по проектам, и делать это через join к каждой задаче незачем.
Ссылки на задачу/проект проверяются на принадлежность пространству (404).

### Контракт и клиент

- Длительность **никуда не сохраняется**: `entryMinutes(startedAt, endedAt, now)`
  и `formatDuration` живут в `shared-types` и используются обеими сторонами —
  сервер отдаёт `minutes` в DTO, клиент тикает тем же расчётом каждую секунду,
  поэтому «идёт 42 мин» и «42 мин» после остановки не могут разойтись.
- Панель «Время»: виджет таймера (тикает локально, без запросов в секунду),
  итоги за сегодня/неделю, топ проектов, список по дням, ручная запись,
  «Продолжить» (создаёт новую запись, а не размораживает старую).
- Индикатор идущего таймера живёт в сайдбаре
  (`apps/web/components/running-timer-chip.tsx`): идущий отсчёт — факт про всё
  приложение, а не про одну панель, поэтому он виден из любой панели и ведёт
  в «Время» по клику. Механизм тиканья общий с виджетом панели
  (`useNowTick` + `entryMinutes`), сервер опрашивается раз в минуту и только
  на вопрос «идёт ли таймер вообще».

### Чего нет осознанно

**Стоимости часа здесь ещё нет** (появилась в v0.19 вместе со ставкой проекта):
в v0.18 было время без денег, потому что `Project.budgetAmount` — это бюджет, а
не ставка, и придумывать ставку наугад хуже, чем показать только время.

### Найденный по пути баг (живой тест)

Интеграционный тест на `GET …/time/running` упал на разборе ответа:
**NestJS отдаёт `null` как ответ с пустым телом**, а `ApiClient.safeJson`
превращал пустое тело в `undefined`, после чего `timeEntrySchema.nullable()`
падал на `parse(undefined)`. Это был не только мой новый эндпоинт: ровно так
же с v0.12 вёл бы себя `GET …/sync/remote`, когда удалёнка не настроена
(`syncRemoteSchema.nullable()`) — то есть панель синхронизации на «пустой»
конфигурации вместо «не настроено» показала бы ошибку. Исправлено в одном
месте: `safeJson` теперь трактует пустое тело как JSON `null` (и тестовый
хелпер `request` — так же). Это ровно тот класс находок, ради которого
интеграционные тесты и нужны: типы были зелёные, а поведение — нет.

### Найденные по пути баги (оба — живьём, не в типах)

1. **`null` в ответе = пустое тело.** Интеграционный тест на
   `GET …/time/running` упал на разборе ответа: NestJS отдаёт `null` как ответ
   с пустым телом, а `ApiClient.safeJson` превращал пустое тело в `undefined`,
   после чего `timeEntrySchema.nullable()` падал на `parse(undefined)`. Это был
   не только новый эндпоинт: ровно так же с v0.12 вёл бы себя
   `GET …/sync/remote`, когда удалёнка не настроена
   (`syncRemoteSchema.nullable()`) — панель синхронизации на «пустой»
   конфигурации показала бы ошибку вместо «не настроено». Исправлено в одном
   месте: `safeJson` теперь трактует пустое тело как JSON `null` (и тестовый
   хелпер `request` — так же).
2. **Тесты мусорили в базе.** Проверка гигиены после прогона показала 6 записей
   времени, оставшихся «ничьими». Причина оказалась системной: `afterAll`
   удалял только пользователей, а `WorkspaceMember.userId` каскадится — то есть
   исчезала строка членства, а **пространство со всеми данными оставалось**.
   К моменту находки в базе накопилось **166 осиротевших пространств** (27
   заметок и 35 задач внутри) от прогонов интеграционных тестов, в том числе
   прошлых сессий. Исправлено: `afterAll` собирает пространства тестовых
   пользователей и удаляет их (каскад уносит данные), а затем **сам проверяет**,
   что ничего не осталось — если у новой модели пропадёт каскад, тест упадёт, а
   не будет тихо растить базу. Накопленные 166 пространств вычищены разово
   (`DELETE FROM workspaces WHERE NOT EXISTS (member)` — у настоящих
   пространств участник есть всегда).

### Проверка (v0.18)

- `pnpm typecheck` (7/7) · `pnpm lint` чисто · `pnpm test` — **76/76**
  (+7 кейсов `entryMinutes`/`formatDuration`/входа старта таймера).
- `pnpm test:integration` — **11/11**, включая новый кейс: запуск/остановка,
  409 на второй таймер, 404 на повторную остановку, ручная запись = 150 мин,
  400 на перевёрнутый диапазон, фильтр по проекту, 404 на чужую задачу и
  RLS-невидимость строк времени для второго пользователя.
- `pnpm --filter @orion/web build` — **21/21 страница** (было 20: добавился
  статический путь `/panel/time`), ленивый чанк панели собирается отдельно.

### Что осталось из согласованного плана

**Привычки/рутины** — последний пункт внутренней волны: повторяющееся действие
с отметкой по дням и streak. Опирается на уже обкатанный движок повторений
(`recurrence.ts`, 14 тестов) и на паттерн «таймстамп как флаг», который в
проекте уже трижды применён (`Note.pinnedAt`, `Note.deletedAt`,
`RecurringTransaction.pausedAt`).

---

## v0.19: «Привычки» — закрытие внутренней волны

### Контекст и ключевое решение

Последний пункт согласованного плана. Первый вопрос был «не переиспользовать ли
`Task.recurrence`» — и ответ «нет»: у привычки нет статуса, дедлайна и
завершения, есть только «сделано в этот день». Переиспользование дало бы кучу
завершённых задач и `dueAt`, означающий не то, что он означает везде; календарь
и так показывает задачи, а отметка привычки — факт про день, а не срок.

### Модель данных

Две таблицы, одна миграция на создание (`20260910201641_habits`) и одна на RLS
(`20260910201700_habits_rls`, обе политики — `ENABLE` + `FORCE` + membership):

- **`Habit`** — `name`, `note`, `weekdays Int[]` (0 = понедельник … 6 =
  воскресенье — **та же** конвенция, что `byWeekday` в движке повторений),
  `color`, `archivedAt`. Пустой массив = «каждый день», а не «никогда»: это и
  то, что присылает клиент, который не трогал расписание.
- **`HabitEntry`** — одна отметка, `day DateTime @db.Date` и **уникальный
  индекс `(habitId, day)`**. День, а не момент времени: отметка — факт про день
  в жизни пользователя, а хранение инстанта сделало бы «сделал ли я это вчера»
  зависимым от таймзоны сервера, и вечерняя отметка уезжала бы на завтра (та же
  ловушка, что описана у `Note.dailyOn`). Уникальный индекс заодно делает
  `toggle` идемпотентным: двойной клик ловится базой (P2002 → «сделано»), а не
  проверкой в коде.

### Вычисляемое, а не хранимое

`streak`, `dueToday` и `doneToday` в DTO **не хранятся**: серия — это факт про
историю отметок и расписание, и кэшированная копия протухла бы в момент
переключения отметки или смены расписания. Правила живут в
`shared-types/src/habit.ts` (`habitStreak`, `isHabitScheduled`) — одна
реализация на API и на панель, 12 юнит-тестов на края:

- пустое расписание = каждый день;
- считаются только **запланированные** дни: Пн/Ср/Пт, сделанные Пн и Ср, дают
  серию 2, а не 1 (вторник пропускается, не разрывая);
- отметка в незапланированный день разрешена (пользователь же сделал), но серию
  не надувает;
- сегодня «прощающее»: если день ещё не отмечен, серия считается по прошлым —
  день не кончился, значит не прервана. Альтернатива («0 до отметки») делала бы
  число бесполезным всё утро;
- обход ограничен 3660 днями, чтобы сломанное расписание не зациклило запрос.

### Локальный день против серверного

`toggle` без `day` берёт **UTC-день сервера** — это дефолт для API-скриптов, но
панель обязана присылать свой день явно: у сервера нет представления о зоне
пользователя, и отметка, сделанная в 00:30 по местному времени, для жителя
восточнее UTC уехала бы во «вчера». Поэтому в контракте рядом живут две
функции: `habitDayKey` («какой день сейчас по UTC» — то, что хранится в
`@db.Date`) и `habitLocalDayKey` («какой день сейчас у меня» — то, что
отправляет клиент). Разные вопросы — разные функции, а не одна «умная».

Сначала клиент обходил это ещё и на чтении: сервер считал `dueToday` и якорь
серии по своему UTC-дню, поэтому панель фильтровала список как
`habit.dueToday || isHabitScheduled(weekdays, локальный день)` — то есть
держала вторую копию расписания на клиенте. Правильнее оказалось устранить
причину: `GET …/habits` принимает **`?today=YYYY-MM-DD`** (валидируется
схемой дня; мусор → 400, а не тихо сдвинутое окно серии), и сервер считает
`dueToday`/`doneToday`/`streak` относительно переданного дня. Теперь у этих
чисел один источник истины, а клиентская подстраховка удалена.

### API (`apps/api/src/habits/`)

Зеркало `time/`/`notes/`: `assertMemberTx` + `withUser`, zod-пайп, `toDto`
внизу файла. Маршруты: `GET …/habits?includeArchived`, `GET …/habits/entries?from&to`,
`POST …/habits`, `PATCH …/habits/:habitId`, `POST …/habits/:habitId/toggle`,
`DELETE …/habits/:habitId`.

`DELETE` — **архивация**, как у проектов: привычка несёт историю отметок, и
«я перестал это делать» не то же самое, что «сотри, что я когда-либо делал».
Восстановление — `PATCH { archivedAt: null }`.

### Стоимость часа (закрывает «стоимость часа через бюджет проекта»)

В v0.18 время считалось без денег, потому что у проекта была только сумма
бюджета, а не ставка. Теперь есть `Project.hourlyRate` — **копейки за час,
nullable** — и правило «сколько это стоило» живёт в контракте:
`timeCostMinor(minutes, hourlyRateMinor)`.

Ключевое решение — **`null`, а не `0` для неизвестной ставки**. «Мы не знаем
ставку» и «работа бесплатна» — разные утверждения, и сумма, которая молча
добавляет нули, занижает итог, выглядя при этом достоверной. Поэтому:

- `timeCostMinor` возвращает `null`, когда ставка не задана (и `0` — когда
  задана явно нулевая);
- панель показывает стоимость только по проектам со ставкой и **честно
  помечает**, какая часть времени не оценена («оценено 8 ч из 12 ч 30 мин»).

Ставка — копейки за час, как и все деньги в проекте (v0.8): конвертация в
рубли только на границе UI (`parseMoneyInput`/`formatMoney`), валюта — из
проекта (`currency`).

### Проверка (v0.19)

- `pnpm typecheck` (7/7) · `pnpm lint` чисто · `pnpm test` — **93/93**
  (+12 кейсов расписания и серий, +1 на локальный/UTC день, +4 на стоимость
  времени).
- `pnpm test:integration` — **12/12**, включая привычки: пустой список,
  расписание «каждый день» и «по дню недели», отметка/снятие, серия 2 за два
  дня, окно `entries`, **`?today=` меняет ответ о «сегодня» и якорь серии**,
  400 на битый день, 404 на чужую привычку, архивация (скрыта из активного
  списка, но история и серия целы) и RLS-невидимость для второго пользователя.
  Плюс проверка, что ставка проекта (`hourlyRate`) переживает round-trip.
- `pnpm --filter @orion/web build` — **22/22 страницы** (добавился
  `/panel/habits`), ленивые чанки панелей собираются отдельно.
- База после прогонов: 0 осиротевших пространств (см. v0.18 про чистку).

### Чем закрылась внутренняя волна (v0.16 → v0.19)

Сделано: политика уведомлений и «оживление» настроек (v0.16), связи между
сущностями + подзадачи и ручной порядок + вложения заметок (v0.17), учёт
времени (v0.18), привычки (v0.19). Попутно найдены и закрыты: RLS-дыра у
`finance_transaction_lines`, `prisma`-регресс `import type`, расхождение
контрактов со схемой, пустое тело как `null` в клиенте и
**166 осиротевших пространств от интеграционных тестов**.

Осознанно не сделано (и почему): стоимость часа из времени (нужна ставка —
отдельное решение), версии документов и аннотации (исключены из объёма v1
документов), шар-ссылки и вторая стадия синхронизации (внешняя сторона,
отложена), светлая тема (приложение сознательно однотёмное).

## v0.20: внутренний реестр модулей

ORION уже был сильным модульным монолитом. Чтобы он стал платформой, модуль
должен уметь **исчезнуть**. Не marketplace, не Plugin Runtime и не редакции —
сначала манифест, флаг на workspace и корректное поведение соседей.

### Что считается модулем

Предметные: Tasks, Notes, Calendar, Documents (базовые); Projects, Time,
Finance, Habits (дополнительные). Дашборд, инбокс, поиск, уведомления,
настройки и резервные копии — **оболочка ядра**, в каталог не входят и не
выключаются.

Страница каждого модуля живёт в `MODULE_CATALOG` (`packages/shared-types/src/modules.ts`):
за что отвечает, без чего живёт, что даёт другим, что происходит при выключении.
Ту же страницу показывает Настройки → Модули.

### Enable / disable без удаления

Состояние — `Workspace.disabledModules` (пустой список = всё включено). Owner
делает `PATCH /workspaces/:id/modules/:moduleId { enabled }`. API выключенного
модуля отвечает 409. Строки в Postgres не трогаются: повторное включение
возвращает панель, команды и данные.

Контроллеры несут `@RequireModule("x")`. Кроны задач, событий, платежей и
внешних ICS-фидов пропускают пространства, где модуль выключен. Поиск не
отдаёт типы выключенных модулей. Инбокс не разбирает входящее в выключенную
цель.

### Соседи обязаны переживать отсутствие

Клиент не зовёт чужой API: `useX(isEnabled("x") ? workspaceId : undefined)`.
Календарь не рисует задачи/заметки/платежи, если их модуль выключен. Карточка
проекта прячет вклад Finance/Time/Tasks и не падает. Быстрый ввод (`⌘⇧N` и
дашборд) создаёт заметку или задачу только из включённых модулей.

Два теста платформы: Habits выключается — GET 409, строка в БД на месте,
включение возвращает её. Projects без Finance и Time — список проектов 200,
их API — 409.

### П0 интерфейса, закрытые заодно

Клик в command palette запускает **эту** строку, а не `activeIndex`. У
свёрнутого сайдбара есть доступное имя, раскрытие по фокусу и кнопка
«закрепить» для тача. Modal/Sheet держат Tab внутри и возвращают фокус.
Дашборд показывает ошибку загрузки с «Повторить».

### Осознанно не сделано

Plugin Runtime, каталог плагинов, подпись пакетов, редакции (Legal / Finance),
отдельный экран «Связи модулей», экран Today и мобильная оболочка. Сначала
модуль должен уметь исчезнуть. Пока это доказано на двух модулях, внешние
плагины только размоют границу.

### Проверка (v0.20)

- `pnpm typecheck` · `pnpm lint` · `pnpm test` по контракту реестра.
- Интеграционно (когда Postgres доступен): выключение Habits без удаления
  данных; Projects при выключенных Finance/Time.

## v0.21: цикл «захватить → разобрать → сделать»

Реестр модулей (v0.20) дал право модулю исчезнуть. Следующий шаг — не новый
модуль, а законченный ежедневный маршрут из того, что уже есть.

### Захват в инбокс

Быстрый ввод (`⌘⇧N`, дашборд, «В инбокс» в палитре) по умолчанию кладёт
мысль в инбокс, а не угадывает тип. `/task` и `/note` остаются явными
ярлыками. Инбокс — поверхность ядра, поэтому захват работает и когда задачи
с заметками выключены.

### Дашборд = «Сегодня»

Вместо ковра статистики — ответы на три вопроса: что требует внимания
(просроченное, очередь инбокса), с чего начать (до трёх открытых задач),
что стоит на сегодня (события, оставшиеся сроки, привычки). Таймер, если
идёт, виден на этой же поверхности. Финансы и недавние заметки остаются, но
не конкурируют с текущей работой. Соседи по-прежнему подключаются только
когда модуль включён.

### Связь «сделать»

Закрытие задачи останавливает её запущенный таймер (если модуль «Время»
включён). Иначе «готово» оставляло бы секундомер тикать в фоне.

### Проверка (v0.21)

- `pnpm typecheck` · `pnpm lint` · `pnpm test` (контракт захвата и нарезка
  задач «на сегодня»).

## v0.22: разобрать и подвести итог

Захват в инбокс (v0.21) бесполезен, если разбор выкидывает из очереди после
первой записи. И «Сегодня» молчит про неделю и про старт работы.

### Разбор не уводит с очереди

«На сегодня» сразу делает задачу со сроком до конца локального дня.
«В задачу / заметку / событие» по-прежнему открывают диалог (срок и проект).
После успеха очередь остаётся на месте; прыжок к созданной сущности — кнопка
«Открыть» на тосте, а не обязательный `openPanel`.

### Today: сделать, не только отметить

Просроченное больше не дублируется в «С чего начать». С фокус-задачи
запускается таймер (модуль «Время»), 409 «уже запущен» показывается как есть.
Внизу — «Неделя»: закрыто за понедельник–воскресенье, остаток со сроком на
эту неделю, перенос с прошлых. Считается на клиенте из того же списка задач,
без нового эндпоинта.

### Проверка (v0.22)

- `pnpm typecheck` · `pnpm lint` · `pnpm test` (конец локального дня, неделя
  с понедельника, нарезка weekly review).

## v0.23: первый запуск и узкий экран

Цикл «захватить → разобрать → сделать» (v0.21–v0.22) не виден новому
пользователю и не помещается на телефоне. Plugin Runtime по-прежнему не
нужен: внешние пакеты размоют границу модуля, которую v0.20 только что
доказал.

### Онбординг на «Сегодня»

Карточка на дашборде, не модальный мастер: поле захвата остаётся главным
действием. Три шага — захват в инбокс, разбор «На сегодня», работа на этой
панели. «Понятно» пишет `UserPreference.onboardingCompletedAt`; Настройки →
Внешний вид умеют показать карточку снова. Существующие пользователи видят
её один раз — цикл появился после их первого входа.

### Оболочка на узком экране

Ниже 768px сайдбар — выезжающая шторка (не hover-рейка), сверху полоса с
меню и колокольчиком. Открытие раздела закрывает остальные панели дока:
на телефоне нет сплита. Вкладки dockview прячутся CSS-ом. Это тот же
веб-клиент, не отдельное мобильное приложение.

### Проверка (v0.23)

- `pnpm typecheck` · `pnpm lint` · `pnpm test` (`isOnboardingPending`).
- После `pnpm db:migrate`: PATCH `/settings/preferences` с
  `onboardingCompletedAt`.

## v0.24: инвайты, роли и первый плагин «Команда»

ORION был инструментом ровно для одного человека в пространстве: `WorkspaceMember`
существовал в схеме с v0, но ни один код-путь не создавал строку членства для
кого-то, кроме самого регистрирующегося. По прямому запросу пользователя —
завести назначение задач и роль тимлида — понадобилось сначала закрыть эту
предпосылку (пригласить второго человека вообще некуда), а затем решить, что
такое «плагин» в системе, которая дважды (v0.20, v0.23) сознательно отложила
настоящий Plugin Runtime. Ответ пользователя был конкретным: плагин дополняет
**модуль**, а не оболочку ядра — то есть ближе к «Этапу 3» из
`docs/MODULES_AND_PLUGINS.md`, чем к маркетплейсу из «Этапа 4». Реализован
минимальный срез этого этапа (см. §16.2 там же), а не весь Plugin API.

### Инвайт-флоу

`WorkspaceInvite` — email, `tokenHash` (sha256, как у `RefreshToken` — токен не
пароль, медленный KDF не нужен), TTL 14 дней, статус
`pending/accepted/revoked/expired`. `POST/GET/DELETE workspaces/:id/invites`
плюс `POST invites/:token/accept` — единственный маршрут в системе, который
сознательно ломает инвариант «роут всегда `workspaces/:id/...`» (как когда-то
ICS-фид календаря): у вызывающего ещё нет членства в целевом пространстве, в
этом весь смысл приглашения. `accept` идёт через `asSystem` по той же причине,
что и `AuthService.register`, — курица и яйцо с RLS-политикой.

Доставки писем нет: `create` возвращает сырую ссылку один раз в ответе
(dry-run, тот же принцип, что у Telegram-интеграции без токена в `.env`) —
владелец копирует и передаёт её сам. `GET workspaces/:id/members` — новый
эндпоинт, без него не на что смотреть при приглашении/назначении.

**Найденный и исправленный баг**: чтобы участник видел содокладчиков, политика
`workspace_members_isolation` расширена с «только своя строка» до
«весь список пространства» — по аналогии с `workspaces_isolation`. Но та
политика ссылается на *другую* таблицу, а `workspace_members` — сама на себя,
и Postgres отказывается это выполнять:
`ERROR: infinite recursion detected in policy for relation "workspace_members"`.
Нашлось это только на живом Postgres — typecheck/lint/build прошли молча.
Исправление — стандартный обход: `SECURITY DEFINER`-функция
`is_workspace_member`, владелец которой (`orion`, BYPASSRLS) выполняет
внутренний запрос уже без применения этой же политики к самой себе.

### Реестр плагинов

`PLUGIN_CATALOG` в `packages/shared-types/src/plugins.ts` зеркалит
`MODULE_CATALOG` один в один — тот же `PluginsService`/`workspaces/:id/plugins`,
что и `ModulesService`/`.../modules`. Отличия ровно два: у плагина есть
`extendsModuleId` (ровно один модуль, который он дополняет), и он автоматически
считается выключенным, если выключен модуль-хозяин, даже если сам тумблер
плагина стоит во «включено». Не рантайм для внешнего кода: каталог
компилируется в приложение точно так же, как модули, — обоснование в
`docs/MODULES_AND_PLUGINS.md` §16.2 (реального Plugin Runtime по-прежнему нет,
см. «Осознанно не сделано» ниже).

**Второй найденный баг**: у модулей `disabledModules` — плоский список
(`defaultEnabled: true` у каждого, поэтому «пусто = всё включено» корректно).
У плагина «Команда» `defaultEnabled: false`, и та же логика молча включала его
для всех пространств. Поле переименовано в `pluginOverrides`: список хранит
id, чьё состояние **отличается** от `defaultEnabled` в манифесте, а не плоский
флаг «выключено». `setEnabled(id, enabled)` сравнивает запрошенное состояние с
дефолтом и решает, добавить id в список или убрать.

Настройки → Плагины — обобщённый рендер по каталогу, без специального кода под
конкретный плагин (как и Настройки → Модули).

### Плагин «Команда» (расширяет Tasks)

- `Task.assigneeId` — FK на `WorkspaceMember` (не на `User`: назначение
  привязано к членству в конкретном пространстве). Запись поля требует
  включённого плагина; уже проставленное значение остаётся видимым и при
  выключенном плагине — «выключить» не значит «стереть», как и у модулей.
  Кросс-пространственная проверка — `assertAssigneeInWorkspace`, тот же
  паттерн, что `assertAccountInWorkspace` в `finance-refs.util.ts`.
- `?assignedToMe=true` в `GET .../tasks` — фильтр «Мои задачи», чип в шапке
  панели, виден только при включённом плагине.
- `WorkspaceRole` получила третье значение — `lead`. Назначить задачу на
  **другого** участника (не на себя) и пригласить/отозвать/убрать участника
  может owner или lead; сменить чью-то роль — только owner (лид не может
  повысить ни себя, ни кого-то ещё до owner/lead).
- `WorkspacesService.assertMemberRoleTx` — **аддитивный** хелпер поверх
  `assertMemberTx`. Остальные ~10 модулей не переписаны: `assertMember`
  по-прежнему проверяет только факт членства, роль проверяют лишь три точки
  выше. Сознательное ограничение объёма, а не недосмотр.

### Осознанно не сделано

Настоящий Plugin Runtime для внешнего/стороннего кода — динамическая загрузка
пакетов, песочница, подпись, версии и совместимость, Settings → Plugins как
каталог с источниками. Ничего из этого не входит в объём: плагин здесь —
скомпилированный в приложение код того же уровня доверия, что и модуль, и
проверен ровно на одном плагине («до двух модулей» из v0.20 здесь читается как
«до второго плагина»). `docs/MODULES_AND_PLUGINS.md` §17 «Этап 3» по-прежнему
не пройден целиком: нет проверки совместимости/разрешений и lifecycle
установки — есть только `PluginManifest` и включение/выключение.

### Проверка (v0.24)

- `pnpm quality` (typecheck + lint + 126 unit-тестов + build) — чисто.
- `pnpm test:integration` — **16/16**: новый сценарий гоняет весь путь —
  инвайт, попытка назначить при выключенном плагине (409), самоназначение при
  включённом, отказ на чужого исполнителя из другого пространства (400),
  принятие приглашения вторым пользователем, отказ участнику в приглашении
  (403), назначение на другого — 403 участнику и 200 после повышения до lead,
  отказ lead в смене чужой роли (403), сохранение `assigneeId` после
  выключения плагина, запрет участнику убрать владельца (403).
- 6 новых миграций: `workspace_invites` (+RLS), RLS-патч `workspace_members`,
  `pluginOverrides`, `Task.assigneeId`, `WorkspaceRole.lead`.

## v0.25: локальный Postgres без Docker

Docker нужен был только чтобы поднять Postgres 16. Для разработки это лишняя
зависимость (на Windows движок часто просто выключен), для установщика —
неприемлемая.

`pnpm db:up` больше не вызывает Compose. Скрипт `scripts/postgres.mjs`
берёт бинарники Postgres 16 из `embedded-postgres`, гоняет их через `pg_ctl
start/stop` (процесс живёт после выхода Node) и поднимает тот же контракт:
`127.0.0.1:5433`, superuser `orion`, база `orion`, роли из
`infra/postgres/init/01-app-roles.sql`. Данные — в `infra/postgres/data/`.
Compose остаётся как `pnpm db:up:docker`. CI по-прежнему использует
service-контейнер GitHub Actions, не этот скрипт.

Это не замена Postgres на SQLite и не «своя база». Это тот же сервер, без
Docker. Установщик для конечного пользователя — следующий шаг тем же
бинарником, уже как sidecar Tauri.

## v0.26: модуль «Склад»

### Контекст и ключевое решение

Первый вопрос при проектировании был «хранить ли остаток полем на позиции».
Ответ — нет, по той же причине, что и у `Account.balance` (v0.8) и у
`streak`/`dueToday` привычек (v0.19): остаток — это факт про историю движений,
а не про позицию саму по себе, и хранимая копия рано или поздно разъедется с
леджером. Склад в ORION — это **append-only леджер движений**, а не
редактируемая карточка «сколько осталось».

Второй вопрос — точный moving average cost (себестоимость на момент списания,
зависящая от порядка операций) или упрощённая средняя. Выбрана упрощённая:
`avgCostMinor = SUM(receipt.qty × receipt.cost) / SUM(receipt.qty)` по всем
приходам за всё время — **чистый агрегат**, не требующий хранимого состояния,
в отличие от настоящего moving average. Менее точно (не учитывает, что часть
партии уже списана по старой цене), но для соло-склада без учёта себестоимости
по партиям — разумный компромисс, а не то, что стоит «дочинивать» без запроса.

### Модель данных

Две таблицы, миграция на создание (`20260916131703_inventory_module`) и на RLS
(`20260916131800_inventory_module_rls`, обе политики — `ENABLE` + `FORCE` +
membership, как у любой workspace-таблицы):

- **`InventoryItem`** — номенклатура: `name`, `sku` (nullable, уникален в
  рамках workspace — Postgres не конфликтует NULL с NULL в уникальном
  индексе), `unit` (просто ярлык для отображения, без конвертации между
  единицами), `minStock` (порог уведомления, null = выключено),
  `lowStockNotifiedAt` (дедуп уведомления, см. ниже), `projectId` (опционально,
  как `Transaction.projectId`), `archivedAt`.
- **`InventoryMovement`** — одно движение, `workspaceId` денормализован (та же
  причина, что у `TransactionLine`: плоская RLS-политика без двух хопов через
  позицию). `type` (`receipt | issue | adjustment`) — метаданные для UI и
  отчётности; **знак хранится прямо в `quantity`**, а не выводится из `type`:
  приход всегда положительный, расход всегда отрицательный, а у корректировки
  знак приходит явно (`direction` во входной схеме) — так остаток всегда
  ровно `SUM(quantity)`, без ветвления по типу на каждом чтении.

### Защита от отрицательного остатка

Остаток не хранится столбцом, поэтому обычный `CHECK` не поставить. Вместо
этого `InventoryService.recordMovement` берёт `SELECT ... FOR UPDATE` на
строку позиции перед тем, как проверить и записать движение — сериализует
конкурентные движения по **одной и той же** позиции ровно там, где гонка
реально возможна (два клиента одновременно списывают последние остатки). Это
тот же класс защиты, что партиальный уникальный индекс у бегущего таймера
(v0.18), только здесь проверка произвольная («хватает ли количества»), а не
«существует ли уже», поэтому инструмент — блокировка строки, а не индекс.

### Уведомления о низком остатке

Зеркалит `BudgetAlertsService` (v0.16): срабатывает сразу после движения,
внутри той же транзакции, а не по крону — момент пересечения порога и есть
момент, который важен. Дедуп, в отличие от бюджетов (там ключ — `(бюджет,
месяц)`, здесь нет календарной границы), — явное поле
`InventoryItem.lowStockNotifiedAt`: выставляется при первом уведомлении по
порогу и сбрасывается в `null`, как только приход поднимает остаток обратно
выше `minStock`. Следующее пересечение вниз — новое событие, снова
уведомляет; оставаться ниже порога после первого уведомления — не повторяет
его. `NotificationPolicyService` получил четвёртый `ReminderKind` —
`"inventory"` — со своим тумблером `UserPreference.inventoryAlerts`, тем же
путём, что `taskReminders`/`eventReminders`/`financeAlerts`.

### API (`apps/api/src/inventory/`)

Зеркало `habits/`: `assertMemberTx` + `withUser`, zod-пайп, `toDto` внизу
файла, `@RequireModule("inventory")`. Плюс `InventoryAlertsService` —
отдельный сервис на низкий остаток (та же причина разделения, что у
`BudgetAlertsService`: логика оповещения не должна раздувать CRUD-сервис).
Маршруты: `GET/POST …/inventory/items`, `PATCH/DELETE …/inventory/items/:id`
(`DELETE` — архивация, как у привычек и проектов: леджер остаётся),
`GET/POST …/inventory/items/:id/movements`.

### Осознанно не сделано (v0.26)

Как и у остальных модулей — отложено, не забыто:

- **Мультисклад/локации.** Один неявный склад на workspace; локации удвоили
  бы модель (позиция+локация в каждом движении) без нужды для соло-разработчика.
- **Партии, серийные номера, сроки годности.** Точный FIFO/LIFO по партиям —
  отдельная сущность и другая модель списания, не патч поверх текущей.
- **Резервирование под заказ.** Полезно для фулфилмента/e-commerce, не нужно
  для внутреннего учёта расходников.
- **Конвертация единиц измерения.** `unit` — ярлык для отображения, не система
  пересчёта.
- **Полнотекстовый поиск по номенклатуре.** Не подключено к `SearchableEntityType`
  — дёшево добавить позже, но не входило в объём v0.26.

### Проверка (v0.26)

- `pnpm quality` (typecheck + lint + 127 unit-тестов + build) — чисто.
- `pnpm test:integration` — **16/16**, включая структурную проверку RLS для
  `inventory_items`/`inventory_movements` (ENABLE + FORCE + политика).
- 2 новых миграции: `inventory_module` (таблицы + `UserPreference.inventoryAlerts`),
  `inventory_module_rls`.

## v0.27: «План проекта» — вехи и Гант

### Контекст

Модуль «Проекты» был контейнером-ярлыком: имя, сроки, бюджет, агрегаты по
соседям. Не хватало собственно **планирования** — из чего состоит проект,
сколько часов на что, что от чего зависит и на чём остановились в прошлый
раз. Это расширение существующего модуля `projects`, а не новый модуль: вся
новая сущность (`Milestone`) существует только как план внутри проекта.

### Модель данных

Миграции `project_plan` (таблицы) и `project_plan_rls`:

- **`Project.contextNote`** — «где я остановился», операционная память
  отдельно от модуля «Заметки» (та несёт историю правок и заголовок; это —
  просто перезаписываемый текст, показывается первым при открытии проекта).
- **`Task.startAt`/`estimatedMinutes`/`milestoneId`** — второй Gantt-уровень
  вниз. `startAt` — левый край бара, независим от `dueAt` (который всегда был
  «финишем»); задача может нести только срок (как раньше), только начало, или
  оба. `estimatedMinutes` — план-часы, `null ≠ 0` (та же дисциплина, что у
  `Project.hourlyRate`, v0.19): факт уже есть (`entryMinutes` по `TimeEntry`,
  v0.18), план — новое поле рядом.
- **`Milestone`** — веха/этап: свой бар (`startAt`/`dueAt`), свой план-часы,
  `status`, `order` для ручной сортировки на диаграмме. Независима от того,
  какие задачи в неё сгруппированы через `Task.milestoneId` — веха без единой
  задачи всё равно валидна (это чекпоинт, который пользователь завёл
  осознанно).
- **`MilestoneDependency`** — зеркало `TaskDependency` (v0.14) уровнем выше:
  тот же цикл-чек (`assertDependenciesTx` + BFS), тот же `blocked`-вывод.

### Каскадный пересчёт дат — единственная новая механика

И у задач, и у вех зависимость теперь **двигает даты**, а не только блокирует
статус. `TasksService`/`MilestonesService.cascadeReschedule` — finish-to-start
автопланирование: когда дата движения (drag-resize на Ганте, обычный PATCH —
не важно) отодвигает `dueAt` позже, чем `startAt` зависимой задачи/вехи, та
подвигается вперёд на столько же, сохраняя свою длительность, и это
каскадирует дальше по цепочке (BFS, `visited`-защита, хотя граф и так
ацикличен по построению). **Только вперёд**: если предшественник подвинулся
раньше, ORION никогда не подтягивает зависимую задачу раньше её собственной
даты — это могло бы тихо нарушить другое ограничение, которое пользователь
поставил осознанно. Правило одно и то же на обоих уровнях (задачи и вехи) —
реализовано дважды параллельно (не общей функцией через два разных
Prisma-делегата), тем же приёмом, что `assertProjectTx` дублируется по
notes/events/inbox.

### Gantt (`apps/web/panels/projects/gantt.tsx`)

Свой рисованный движок, без сторонней Gantt-библиотеки — тем же приёмом, что
многодневные события в `month-grid.tsx` (полосы-lane) и drag/resize
`time-grid.tsx` (pointer events, `window` move/up слушатели, коммит на
release). Горизонтальная шкала вместо вертикальной, дни вместо минут —
уникальный `PX_PER_DAY` делает дельту перетаскивания чистым
`(clientX − anchorX) / PX_PER_DAY` без измерения DOM (в отличие от календаря,
где ширина колонки на неделю переменная).

Две строки на элемент: бар в правой прокручиваемой зоне (сам бар — только
перетаскивание, клик по нему ничего не открывает, чтобы не путать клик и
драг) и подпись в левой зафиксированной колонке (там и только там —
кликабельные действия: карандаш/корзина у вехи, открытие задачи). Зависимости
рисуются SVG-стрелками поверх баров, координаты считаются той же геометрией,
что и сами бары, с учётом текущего состояния перетаскивания (`previewNode`) —
стрелка двигается вместе с баром, а не дёргается после коммита.

Задача без `startAt` и без `dueAt` на диаграмме не появляется — рисовать бар
не из чего, а Gantt — план, не список задач (для этого есть панель
«Задачи»). Веха — исключение: показывается даже без дат, иначе скрылись бы и
задачи, сгруппированные под ней.

### Ссылка на веху нарушает контракт «только свой проект»?

Нет — `TasksService.assertMilestoneTx` требует, чтобы `milestone.projectId`
совпадал с `projectId` самой задачи, тем же приёмом, что `assertProjectTx`
не даёт привязать сущность к проекту чужого пространства. Форма задачи
(`task-form.tsx`) отражает это на клиенте: список вех фильтруется по
выбранному в форме проекту и молча сбрасывается на «без вехи» при смене
проекта, а не отправляет несовместимую пару на сервер.

### Осознанно не сделано (v0.27)

- **Start-to-start/finish-to-finish, lag/lead.** Только finish-to-start без
  зазора — самое частое правило и то, ради которого вообще стоило городить
  каскад; остальные виды связей встречаются реже и требуют своего UI для
  выбора вида связи.
- **Ресурсное выравнивание** (resource leveling — авто-развод перегруженного
  исполнителя по времени). ORION соло-инструмент; актуально только если
  «Команда» вырастет за назначение задач.
- **Полнотекстовый поиск по вехам.** Не подключено к `SearchableEntityType`.

### Проверка (v0.27)

- `pnpm quality` (typecheck + lint + 127 unit-тестов + build) — чисто.
- `pnpm test:integration` — **16/16**, включая структурную RLS-проверку для
  `milestones`/`milestone_dependencies`.
- Ручной smoke-тест через API (`curl`, тестовый владелец `1`/`1`): создание
  двух вех с зависимостью → сдвиг `dueAt` первой вперёд → каскад корректно
  подвинул вторую на ту же дельту, сохранив её длительность; то же на уровне
  задач; цикл зависимости корректно отклонён (400); `Project.plannedMinutes`
  и `lastActivityAt` верно считаются по созданным задаче/вехам.
- 2 новых миграции: `project_plan` (поля + таблицы), `project_plan_rls`.

## v0.28: живые WebGL-фоны и курсор-цель

### Контекст

Настройки → Внешний вид уже несли декоративный фон (`aurora`/`grid`, чистый
CSS через `AppBackground` в `@orion/ui`) и `surfaceStyle: "glass"`, чтобы он
просвечивал сквозь панели. По явному запросу пользователя это расширено
четырьмя WebGL-вариантами уровня reactbits.dev — «Жидкий эфир», «Столб
света», «Тёмная вуаль», «Волны» — с настраиваемыми скоростью, плотностью и
цветом, плюс отдельная опция «Курсор-цель» (рамка, сужающаяся на
интерактивных элементах).

### Осознанное исключение: зависимость `ogl`

CLAUDE.md запрещает добавлять UI-библиотеки без запроса — сюда же относятся
рендер-библиотеки вроде `ogl` (лёгкая обёртка над WebGL, ~30 КБ). Это то же
исключение по духу, что CodeMirror (v0.9) и pdfjs/mammoth/xlsx (v0.12): без
неё пришлось бы вручную писать WebGL-боилерплейт (шейдерные программы,
буферы, ресайз) четыре раза. Добавлена только в `packages/ui`, за
`React.lazy` (см. ниже) — не тянется в бандл, пока пользователь не включит
один из четырёх вариантов.

### Данные и контракт

`UserPreference` (миграция `background_effects_and_target_cursor`):

- `backgroundStyle` — enum расширен с `"none"|"aurora"|"grid"` до +4 значений
  (`liquid-ether`/`light-pillar`/`dark-veil`/`shape-waves`).
- `backgroundSpeed` (0.1–3), `backgroundColor` (hex-строка или `null` —
  «по акценту»), `backgroundDensity` (0.2–2) — один общий набор тюнингов на
  все четыре WebGL-варианта, а не отдельная схема на каждый: они уже
  вписываются в один смысл (скорость анимации / плотность узора /
  переопределение цвета), заводить четыре почти одинаковые формы в контракте
  и в форме настроек того не стоило.
- `targetCursorEnabled: boolean` — независимая опция, не привязана к фону.

### Почему не как aurora/grid

`AppBackground` (aurora/grid) намеренно ничего не знает о preference —
переключение идёт через `data-background` на `<html>`, компонент чисто
CSS-реактивен. WebGL-вариантам это не подходит: `backgroundSpeed`/
`backgroundColor`/`backgroundDensity` — JS-значения, которые нужно каждый
кадр толкать в шейдерные униформы, а не переключать классом. Поэтому они не
живут в `AppBackground`, а монтируются отдельным `<WebglBackground>` прямо в
`PreferencesEffect` (`apps/web/lib/preferences-effect.tsx`), которая и так уже
единственное место, читающее `usePreferences()` для применения оформления —
не заводили второй компонент-подписчик специально под фон.

### Устройство `@orion/ui/webgl-backgrounds`

- `shader-canvas.tsx` — общий OGL-боилерплейт (Renderer/Program/Mesh на
  полноэкранном треугольнике, `ResizeObserver`, rAF-луп с `uTime`,
  опциональный `uMouse` для «Столба света», уважает
  `prefers-reduced-motion`, полный teardown на unmount). Каждый из четырёх
  эффектов — только фрагмент-шейдер + свои uniform'ы поверх этого.
- `noise.glsl.ts` — общие hash/value-noise/fbm функции, вставляются строкой в
  шейдеры трёх из четырёх эффектов (`shape-waves` обходится чистой
  интерференцией синусоид без шума).
- Каждый эффект — свой `React.lazy`-чанк (`webgl-backgrounds/index.tsx`), тот
  же приём, что `FilePreview`'s `PdfView`/`DocxView`/`SheetView` (v0.12):
  открыл не-WebGL фон — соответствующий чанк не грузится вообще.
- `TargetCursor` (`packages/ui/src/target-cursor.tsx`) — отдельно от `ogl`,
  просто rAF + `elementFromPoint`, никакого канваса; выключается сама на
  `pointer: coarse` (нет курсора — нечего декорировать).

### Осознанно не сделано (v0.28)

- **Не портировали шейдеры reactbits дословно** — исходников компонентов нет
  под рукой, каждый эффект написан заново под общий контракт
  `{color, speed, density, opacity}`, визуально близко к названию, не пиксель
  в пиксель к оригиналу.
- **Не стали делать точечные UI-настройки под каждый эффект** (например,
  «ширина столба» отдельно от «плотность узора» волн) — три общих слайдера
  показались достаточными для «настраивать», не разрастив форму в Settings.

### Проверка (v0.28)

- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @orion/web build` — чисто
  (webpack подтверждает, что `ogl`-чанки не текут в статические страницы —
  эффекты за `React.lazy` внутри клиентского дерева).
- Ручной браузерный прогон (headless Chromium через Playwright, залогинен
  тестовым владельцем) прошёл все четыре WebGL-фона и курсор-цель на живом
  Дашборде и нашёл два реальных бага, оба исправлены:
  - **`cullFace` в OGL `Program`** по умолчанию `gl.BACK` — полноэкранный
    `Triangle` из `ogl/extras` не гарантирует нужную закрутку вершин под этот
    дефолт, и попадал под отбраковку без единой GL-ошибки (канвас оставался
    в цвете очистки). Все post-process-подобные примеры OGL отключают cull
    face явно — теперь `cullFace: false` в `shader-canvas.tsx`.
  - **Контейнер `<div>` в `ShaderCanvas`** ничего не растягивал — без явного
    класса он схлопывался вокруг канваса (у которого CSS `height: 100%` от
    родителя без явной высоты, классический circular-auto случай), из-за
    чего `container.clientHeight` при первом `resize()` оказывался меньше
    вьюпорта. Добавлен `absolute inset-0` на контейнер.
  - Заодно нашёлся и **более старый баг, не в этом фиче**: `html, body` в
    `globals.css` задают непрозрачный `background-color` безусловно — это
    красится как canvas-фон документа, самый нижний слой, ниже даже
    отрицательного `z-index`. И `AppBackground` (aurora/grid), и новый
    `WebglBackground` сидят на `-z-10 fixed` и упирались в этот непрозрачный
    body ровно так же — «Аврора» была настолько же не видна на Дашборде, как
    и новые фоны, до этой сессии просто никто не проверял её в доке (на
    `/login` она работает, но там отдельный `AuroraBackground`, не через
    `-z-10`). Правка — `[data-surface="glass"] body { background-color:
    transparent; }`.
  - Диагностика по пути отсеяла одну ложную зацепку: чтение пикселей канваса
    через отдельный поздний `gl.readPixels()` (не в том же кадре, что отрисовка)
    всегда возвращает 0 — OGL не включает `preserveDrawingBuffer`, буфer
    обнуляется браузером после композитинга. `page.screenshot()` (реальный
    композитор) — единственный надёжный способ проверить WebGL-канвас
    снаружи страницы.

### v0.28 → углубление: полный набор пропсов на эффект + стилизуемые панели

По следующему запросу пользователя («настройки фонов слишком урезанные
относительно reactbits.dev, панели вообще не настраиваются») — два расширения
в тот же день:

- **`backgroundSpeed`/`backgroundColor`/`backgroundDensity` (один общий набор
  на все четыре эффекта) заменены на `backgroundEffectSettings: Json`** —
  словарь `{ "liquid-ether": {...}, "light-pillar": {...}, ... }`, у каждого
  эффекта свой набор полей вплотную к тому, что реально даёт reactbits.dev:
  - Жидкий эфир — `colorSecondary` (второй цвет, тон смешивается по потоку),
    `mouseForce` (сила отклика на курсор), `autoDemo` (течёт сама или только
    от курсора).
  - Столб света — `pillarWidth`, `rayIntensity`, `flicker`.
  - Тёмная вуаль — `hueShift` (поворот тона через YIQ), `warpAmount`
    (турбулентность fbm-искажения), `scanlineIntensity` (скан-линии).
  - Волны — `gap` (зазор между ячейками), `waveAmplitude`, `shape`
    (круг/квадрат через смешение euclidean/Chebyshev-дистанции).
  Схема — `backgroundEffectSettingsSchema` в `shared-types/src/settings.ts`,
  миграция `background_effect_settings_and_panel_style` (JSONB-колонка,
  дефолт `{}`). Хранится как JSON, а не по колонке на поле — четыре эффекта
  дали бы избыточное дробление схемы ради значений, которые правит только
  одна форма настроек и ни разу не читает сама БД. `SettingsService.toDto`
  подмешивает `DEFAULT_BACKGROUND_EFFECT_SETTINGS` поверх сохранённого JSON,
  чтобы старые/частичные строки не ломали контракт.
  `ShaderCanvas` (`packages/ui/src/webgl-backgrounds/shader-canvas.tsx`)
  получил `extraValues` — живой проброс произвольных доп.-униформ в шейдер
  на каждое изменение формы, не только при монтировании (раньше `extraUniforms`
  фиксировал начальные значения один раз).
- **Стилизуемые панели**: `panelOpacity` (0.1–1), `panelBlur` (0–40px),
  `panelAccent` (hex | null — «нейтральный» тон панелей независимо от общего
  акцента). Раньше `[data-surface="glass"]`-правила в `globals.css` жёстко
  зашивали 0.6/0.55/0.45/0.4/0.35 и `blur(16px)`/`blur(20px)`; теперь это
  `--orion-panel-opacity`/`--orion-panel-blur`/`--orion-panel-tint`
  (CSS-переменные на `<html>`, ставит `PreferencesEffect`), а фиксированные
  множители (0.92/0.75/0.67/0.58) сохранены как относительные коэффициенты
  между `bg-panel`/`bg-card`/`bg-background`/dockview-слоями, чтобы контраст
  между ними не потерялся при переходе на регулируемую базу.
- `packages/ui` по-прежнему не зависит от `shared-types` (см. правило файла
  выше) — `BackgroundEffectSettings` и `WEBGL_BACKGROUND_STYLES` в
  `webgl-backgrounds/index.tsx` структурно дублируют контракт, а не
  импортируют его.
- Вынесена форма `apps/web/panels/settings/background-effect-form.tsx` — один
  компонент на все четыре эффекта (свитч по `variant`), а не разрастание
  `SettingsPanel.tsx` (тот уже большой; новый файл — самостоятельный concern,
  ровно тот случай, когда резать оправдано, см. «Про размер файлов» выше).
- Проверено вживую (headless Chromium): все четыре формы настроек рендерят
  свой набор полей, `pillarWidth`/`rayIntensity`, выкрученные на максимум,
  видимо расширяют и осветляют столб на Дашборде — доказывает, что
  доп.-униформы действительно доходят до шейдера, а не только до формы.

## v0.29: release-hardening backlog (S00–S22) — ключевые архитектурные решения

### Контекст

Полный проход по чек-листу готовности к релизу (`docs/SONNET_IMPLEMENTATION/`,
карточки S00–S22, журнал сессий — `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`).
Ниже — не хронология (она в 12-PROGRESS.md), а решения, которые будущему
агенту нужно понимать «почему так», потому что они меняют инвариант или
паттерн, а не просто чинят конкретный баг. Полный релиз-отчёт со статусом
готовности — `docs/RELEASE_NOTES.md`.

### Actor-scoped модель вместо workspace-wide

Несколько сущностей были «общими на пространство», хотя по смыслу принадлежат
конкретному участнику — это не единичные баги, а один повторяющийся класс
ошибки: время (S06) и уведомления (S07).

- `TimeEntry` не имел `userId` — «один запущенный таймер» был единственным
  частичным индексом на `workspaceId`, поэтому таймер одного участника блокировал
  старт таймера другому. Решение: `userId` (server-stamped) + композитный
  частичный индекс `(workspaceId, userId) WHERE "endedAt" IS NULL`. Барьер
  целостности — снова индекс в БД, не проверка в сервисе (тот же принцип, что
  уже был закреплён для Habits/Inventory до этого бэклога).
- `Notification` был общим на пространство — `readAt` расшаривался между
  всеми участниками, будто у всех одно и то же уведомление. Решение:
  `recipientId` + RLS-политика, которая физически не отдаёт чужое адресное
  уведомление, `eventKey` — параллельный паттерн идемпотентности (см. ниже).
  Старые безадресные строки (`recipientId=null`) остаются видимы всем —
  обратная совместимость, а не миграция данных.

Правило на будущее: если новая сущность логически принадлежит участнику (не
пространству целиком), заводи `userId`/`recipientId` с самого начала —
переделка задним числом требует одновременно менять уникальные индексы, RLS
и все продюсеры.

### Snapshot registry — явный реестр вместо неявного списка

`SnapshotService` раньше бэкапил модели по вручную поддерживаемому списку
(`SNAPSHOT_MODELS`), который не сверялся со схемой — 6 таблиц (включая
`Milestone`, `DocumentVersion`, `DocumentAnnotation`) годами не попадали в
бэкап никем не замеченными. Решение — `snapshot-registry.ts`:
`SNAPSHOT_MODEL_REGISTRY` явно классифицирует **все** workspace-scoped модели
(`included`/`derived`/`identity-excluded`/`secret-excluded`/
`ephemeral-excluded`), и при загрузке модуля список бэкапируемых моделей
сверяется с `Prisma.dmmf.datamodel.models` — рассинхрон валит процесс
немедленно, а не тихо копит дыру до следующего аудита. Тот же принцип
пригодился внутри бэклога: S17 (TaskComment/TaskActivity) поймал
несоответствие реестра ещё до зелёных тестов, просто потому что реестр
существует и его нельзя забыть обновить молча.

Отдельное решение — версионирование формата снимка (`SNAPSHOT_VERSION`,
сейчас 2): `apply()` не пытается угадать формат старого архива, а явно
отвергает legacy v1 и любую незнакомую будущую версию до единой мутации.
Тот же fail-closed принцип применён к бэкапу байт (S04): архив без блобов
(до этого бэклога) — отдельная, распознаваемая и отвергаемая версия, а не
«пустой список файлов».

### Idempotency key — паттерн для фоновых обработчиков с риском гонки

Recurring-платежи (S21) и разбор инбокса (S21) страдали одним и тем же
классом гонки: два конкурентных тика/запроса проходили одну и ту же
check-then-act проверку до того, как кто-то из них успевал записать
результат — конкурирующий крон дублировал платёж, конкурирующий разбор
инбокса создавал вторую задачу/заметку из одного элемента. Решение — один и
тот же паттерн в обоих местах: барьер на уровне БД, не флаг в процессе.
- Recurring: `SELECT ... FOR UPDATE` на строку правила внутри транзакции,
  которая и создаёт запись, и двигает расписание, плюс уникальный индекс
  `(recurringRuleId, scheduledFor)` как резервный барьер.
- Inbox: атомарный claim через `updateMany({ where: { processedAt: null },
  data: { processedAt } })` — только `count === 1` идёт создавать целевую
  сущность.

Оба фикса написаны только после того, как падающий тест на реальном
`Promise.all` воспроизвёл гонку на немодифицированном коде — не «гипотетический»
баг. Это общий паттерн для любого нового `@Cron`-обработчика или
claim-once-handler: в БД должен существовать барьер (лок строки или атомарный
`updateMany`-claim + уникальный индекс), проверка в коде до записи гонку не
ловит.

### ORION_MODE — явное разделение local/server вместо одного неявного режима

До этого бэклога не было понятия «режима» — сервер всегда вёл себя как
однопользовательский локальный процесс: слушал на всех интерфейсах, имел
dev-фолбэк для `JWT_SECRET`, держал открытым passwordless account picker.
Это нормально для desktop-инсталляции за NAT, но небезопасно, если кто-то
поднимет ORION с публичным доступом. Решение — не «просто добавить проверку
окружения», а явный enum `ORION_MODE=local|server` с осознанным дефолтом
(`local`, обратная совместимость для существующих desktop-инсталляций) и
`server`-режимом, который **выключает** локально-удобные, но небезопасные в
публичном сценарии вещи (picker, PIN, dev JWT-секрет) вместо того, чтобы
пытаться угадать их безопасность по заголовкам запроса. Явный флаг вместо
эвристики — единственный способ не получить «наполовину безопасный» режим.

### Note revision + CAS — почему потребовалась серверная проверка, а не только клиентский debounce

Автосохранение заметок раньше полагалось только на клиентский debounce с
булевым флагом «идёт сохранение» — при накладке двух сохранений (два окна,
два устройства, повторный запрос после сетевого сбоя) запись «последнего
пишущего» побеждала молча, без предупреждения о потере чужих правок. Решение
— `Note.revision` и атомарная проверка-и-запись одним `updateMany` (WHERE
revision = ожидаемая), а не read-then-compare-then-write (последнее само по
себе гонка). Конфликт — это не ошибка, а отдельное состояние с явным выбором
пользователя. Решение осознанно **не** распространено на задачи/проекты в
этом бэклоге — их автосохранение/PATCH проще (нет длинного текста, где
накладка правдоподобна), и добавление CAS туда без спроса — не входило в
задачу; если добавится похожий длинный текстовый редактор в другом модуле,
этот паттерн стоит переиспользовать напрямую, не изобретать заново.

### Известные открытые решения, оставленные явно, не тихо

- Отчёты/бюджеты (Finance) агрегируют суммы без учёта мультивалютности —
  дашборд и `FinanceSummaryRow` это уже избегают (`sumByCurrency`), но
  `ReportsService`/`BudgetsService` — нет. Не исправлено в этом бэклоге:
  честная агрегация требует менять контракт (`MonthlyFinanceSummary`/
  `CategoryBreakdownEntry` без поля `currency`) и переписывать три экрана —
  решение отложено, а не скрыто.
- Модуль Lists: done-критерий карточки S16 требовал «деструктивное
  копирование списка», которого нет ни в коде, ни в спецификации
  (`06-MODULES.md`). Это не техническая P0-проблема — это разрыв между
  бэклогом и продуктовой спецификацией, требующий явного решения владельца
  продукта (сделать фичу с контрактом или поправить карточку), а не
  додумывания агентом.



## v0.30: живая приёмка — решения, меняющие контракт или инвариант

Хронология — запись «2026-09-27» в `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`,
итог — раздел «Обновление 2026-09-27» в `docs/RELEASE_NOTES.md`.

### All-day — исключающий конец на сервере, UTC-дата на клиенте

Контракт `eventSchema` всегда говорил «`endAt` — UTC-полночь после последнего
дня», но `normaliseRange` трактовал `endAt` как последний день включительно и
прибавлял сутки, а клиенты якорили *локальную* полночь. Выбрали не
«подогнать сервер под клиентов», а довести обоих до записанного контракта:
сервер снэпит к UTC-датам и не добавляет лишний день; клиент переводит
выбранный локальный день в UTC-полночь (`allDayDateISO`) и обратно
(`allDayAnchor`). Сервер не может угадать пояс клиента (поле `tz` есть, но
форма его не использует для дат), поэтому якорь — обязанность клиента.
Уже сохранённые события данными не правились: «раздутое» и намеренно
двухдневное неотличимы — решение за владельцем.

### Валюта — измерение агрегата, а не формат вывода

Вместо «прятать сумму, если валют больше одной» (прежний `FinanceSummaryRow`)
агрегаты возвращают строку на валюту, а бюджет получил собственную валюту.
Конвертации курсов нет и не планируется без запроса — суммировать разные
валюты в одну цифру система не должна вообще.

### Команда: создатель — исполнитель по умолчанию

Командное пространство открывает задачи в «Только мои». Задача без
исполнителя, созданная человеком для себя (разбор своего инбокса, «Новая
задача» в этом режиме), назначается на него — иначе вид по умолчанию прячет
её от автора в момент создания. Личное пространство (без плагина «Команда»)
не меняется.

### Desktop CSP расширен ровно на два источника

`connect-src blob:` (pdf.js читает файл через blob-URL) и `script-src
'wasm-unsafe-eval'` (modern-xlsx — WebAssembly; разрешает только компиляцию
wasm, не `eval` JS). Оба найдены прогоном экспорта `.next-desktop` под
заголовком из `tauri.conf.json` — до этого CSP был выведен только чтением кода.
