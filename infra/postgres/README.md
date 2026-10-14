# infra/postgres

Local Postgres 16 for ORION development. Default path does **not** use Docker.

```bash
pnpm db:up        # portable Postgres on 127.0.0.1:5433
pnpm db:status
pnpm db:down      # stop; data in infra/postgres/data survives
pnpm db:up:docker # optional: same contract via Docker Compose
```

- Binds to `127.0.0.1:5433` only. DB `orion`, superuser `orion` /
  `orion_local_dev` (dev-only, matches `docker-compose.yml` and CI).
- Portable cluster data: `infra/postgres/data/` (gitignored).
- Docker volume `orion_pgdata` is only for `pnpm db:up:docker`.

Do not run portable and Docker clusters at the same time — both claim 5433.

## Roles: `init/01-app-roles.sql`

Migrations run as the superuser `orion` (they need `CREATE POLICY` /
`ALTER TABLE ... FORCE ROW LEVEL SECURITY`). The **running API must not** —
superusers and `BYPASSRLS` roles skip row security unconditionally, so every
RLS policy would be silently inert. `01-app-roles.sql` splits them:

| Role | Attributes | Used by |
|------|-----------|---------|
| `orion` | superuser | Prisma migrations only (`DATABASE_URL`) |
| `orion_app` | `NOSUPERUSER NOBYPASSRLS` | the API day-to-day (`APP_DATABASE_URL`) |
| `orion_system` | `NOLOGIN BYPASSRLS`, granted to `orion_app` | reached only via `SET LOCAL ROLE orion_system` in `PrismaService.asSystem()` — the registration bootstrap and the overdue-task cron |

### Applying it

`pnpm db:up` (portable) applies the file once, when `orion_app` is missing.
Docker Compose runs `init/*.sql` **only against a brand-new (empty) volume**.

An already-existing Docker volume needs it applied once by hand:

```bash
docker exec -i orion-postgres psql -U orion -d orion < infra/postgres/init/01-app-roles.sql
```

Then set `APP_DATABASE_URL` in `apps/api/.env` (see `.env.example`) to connect
as `orion_app`, and re-run `pnpm db:migrate` so the RLS migration's `GRANT`s
reach the new roles.

> The `orion_app` password in the SQL file is a dev placeholder (this Postgres
> only ever binds to localhost). Rotate before any real deployment.

## Локаль и поиск по-русски

Регистронезависимый поиск (`ILIKE`, Prisma `mode: "insensitive"` — глобальный
поиск, фильтры списков) складывает регистр по правилам локали базы. С libc-локалью
`C` Postgres не знает кириллицы: «сидоров» не находит «Сидорова». Поэтому
`pnpm db:up` с 14 октября 2026 создаёт кластер с ICU (`--locale-provider=icu
--icu-locale=ru-RU`), а базу `orion` — явно `TEMPLATE template0 ... LOCALE_PROVIDER
icu ICU_LOCALE 'ru-RU'`. Docker-образ `postgres:16` (и CI) уже работает в
`en_US.utf8`, там проблемы нет.

Кластер и база, созданные **раньше**, остаются на `C`; `pnpm db:up` предупреждает
об этом. Локаль существующей базы не меняется на месте — перенос через копию узла
(`apps/api/src/ops`), без потери данных:

```bash
pnpm --filter @orion/api build
# 1. остановить API, снять и проверить копию (DATABASE_URL — роль миграций из apps/api/.env)
node apps/api/dist/ops/cli.js backup  ./tmp/before-icu
node apps/api/dist/ops/cli.js verify  ./tmp/before-icu
# 2. старую базу не удалять, а переименовать; создать новую с ICU
psql -h 127.0.0.1 -p 5433 -U orion -d postgres \
  -c "ALTER DATABASE orion RENAME TO orion_before_icu" \
  -c "CREATE DATABASE orion TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ru-RU' LOCALE 'C'"
psql -h 127.0.0.1 -p 5433 -U orion -d orion \
  -c "GRANT USAGE ON SCHEMA public TO orion_app, orion_system" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system"
pnpm --filter @orion/api exec prisma migrate deploy
# 3. восстановить в пустую базу и в ПУСТОЙ каталог файлов, затем указать его в STORAGE_DIR
STORAGE_DIR=./apps/api/.data/documents-icu node apps/api/dist/ops/cli.js restore ./tmp/before-icu
```

`restore` сам сверяет число строк, суммы таблиц, внешние ключи и хеши файлов.
Убедившись, что всё работает (вход, поиск по-русски, файлы), старую базу
`orion_before_icu` и прежний каталог файлов можно удалить.
