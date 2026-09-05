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
