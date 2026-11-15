/**
 * Повторное применение ролей orion_app / orion_system после `prisma migrate reset`.
 *
 * Почему: grants живут на схеме public и теряются при DROP SCHEMA, который
 * делает migrate reset (см. STATUS.md, приёмка 12.11.2026). После любого
 * reset запускайте: pnpm db:grants
 *
 * Идемпотентно: можно запускать сколько угодно раз. Пароль orion_app берётся
 * из infra/postgres/init/01-app-roles.sql — единственный источник значения.
 *
 * Использование:
 *   pnpm db:grants                       # dev-кластер 127.0.0.1:5433
 *   ORION_PG_PORT=55442 pnpm db:grants   # другой кластер
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES_SQL = join(ROOT, "infra", "postgres", "init", "01-app-roles.sql");
const PORT = Number(process.env.ORION_PG_PORT || 5433);
const USER = "orion";
const PASSWORD = "orion_local_dev";
const DATABASE = "orion";

const sql = readFileSync(ROLES_SQL, "utf8");
const passwordMatch = sql.match(/CREATE ROLE orion_app LOGIN PASSWORD '([^']+)'/);
if (!passwordMatch) {
  console.error(`[db-grants] не нашёл пароль orion_app в ${ROLES_SQL}`);
  process.exit(1);
}
const APP_PASSWORD = passwordMatch[1];

function log(message) {
  console.log(`[db-grants] ${message}`);
}

const client = new pg.Client({ host: "127.0.0.1", port: PORT, user: USER, password: PASSWORD, database: DATABASE });
await client.connect();
try {
  const app = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'orion_app'");
  if (app.rowCount === 0) {
    await client.query(`CREATE ROLE orion_app LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    log("создана роль orion_app");
  } else {
    await client.query(`ALTER ROLE orion_app WITH LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    log("роль orion_app приведена к контракту (LOGIN, NOSUPERUSER, NOBYPASSRLS)");
  }

  const system = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'orion_system'");
  if (system.rowCount === 0) {
    await client.query("CREATE ROLE orion_system NOLOGIN NOSUPERUSER BYPASSRLS");
    log("создана роль orion_system");
  } else {
    await client.query("ALTER ROLE orion_system WITH NOLOGIN NOSUPERUSER BYPASSRLS");
    log("роль orion_system приведена к контракту (NOLOGIN, BYPASSRLS)");
  }

  await client.query("GRANT orion_system TO orion_app");
  await client.query("GRANT USAGE ON SCHEMA public TO orion_app, orion_system");
  await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orion_app, orion_system");
  await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orion_app, orion_system");
  await client.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system"
  );
  await client.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system"
  );
  log(`grants и default privileges применены на 127.0.0.1:${PORT}/${DATABASE}`);
} finally {
  await client.end();
}
