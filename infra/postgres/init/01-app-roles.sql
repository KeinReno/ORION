-- Splits the single superuser "orion" role (needed for migrations, which
-- run CREATE POLICY / ALTER TABLE ... FORCE ROW LEVEL SECURITY) from the
-- roles the running API actually connects as.
--
-- Why this exists: superusers and BYPASSRLS roles skip row security
-- unconditionally, regardless of FORCE ROW LEVEL SECURITY. "orion" is the
-- POSTGRES_USER for this container, which initdb makes a superuser — so
-- every RLS policy from the enable_rls migration was silently inert until
-- this split existed. See ORION bug-hunt findings (2026-09-05).
--
-- orion_app:    what PrismaService connects as for normal requests.
--               NOSUPERUSER, NOBYPASSRLS — FORCE RLS actually applies to it.
-- orion_system: never logs in directly. Reached only via `SET LOCAL ROLE
--               orion_system` inside PrismaService.asSystem(), for the two
--               operations that legitimately span every workspace: the
--               registration bootstrap and the overdue-task cron.
--
-- This file only runs automatically on a brand-new data volume
-- (docker-entrypoint-initdb.d semantics). The already-existing dev volume
-- needs it applied once by hand — see infra/postgres/README.md.

-- Dev-only password, same spirit as POSTGRES_PASSWORD in docker-compose.yml
-- (this Postgres only ever binds to 127.0.0.1). Rotate before any real deploy.
CREATE ROLE orion_app LOGIN PASSWORD 'OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE orion_system NOLOGIN NOSUPERUSER BYPASSRLS;
GRANT orion_system TO orion_app;

GRANT USAGE ON SCHEMA public TO orion_app, orion_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orion_app, orion_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orion_app, orion_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system;
