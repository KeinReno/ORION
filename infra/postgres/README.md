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
