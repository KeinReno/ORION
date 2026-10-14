// Fresh database for the browser smoke suite (`pnpm test:e2e:local`).
//
// The dev cluster on 127.0.0.1:5433 is shared with whatever ORION instance is
// running for real work, so e2e never writes there: it drops and recreates a
// separate `orion_e2e` database in the same cluster, grants the two app roles
// exactly as infra/postgres/init/01-app-roles.sql does (the roles themselves
// are cluster-wide and already exist), then applies every Prisma migration.
// CI does not use this script: its Postgres service is already a fresh DB.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const E2E_DB = process.env.E2E_DATABASE ?? "orion_e2e";

function envFromFile(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

export function e2eUrls() {
  const env = { ...envFromFile(join(root, "apps", "api", ".env")), ...process.env };
  if (!env.DATABASE_URL || !env.APP_DATABASE_URL) throw new Error("DATABASE_URL/APP_DATABASE_URL не заданы (apps/api/.env)");
  const swap = (url) => {
    const parsed = new URL(url);
    parsed.pathname = `/${E2E_DB}`;
    return parsed.toString();
  };
  return { admin: env.DATABASE_URL, migrate: swap(env.DATABASE_URL), app: swap(env.APP_DATABASE_URL) };
}

async function main() {
  if (!/^[a-z_][a-z0-9_]*$/.test(E2E_DB) || E2E_DB === "orion") throw new Error(`Недопустимое имя e2e-БД: ${E2E_DB}`);
  const urls = e2eUrls();
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  // Same ICU collation as the dev cluster and CI's postgres image: Cyrillic case folding works.
  await admin.query(`CREATE DATABASE ${E2E_DB} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ru-RU' LOCALE 'C'`);
  await admin.end();

  const db = new pg.Client({ connectionString: urls.migrate });
  await db.connect();
  await db.query(`
    GRANT USAGE ON SCHEMA public TO orion_app, orion_system;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system;
  `);
  await db.end();

  execFileSync("corepack", ["pnpm", "--filter", "@orion/api", "exec", "prisma", "migrate", "deploy"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: urls.migrate }
  });
  console.log(`[e2e-db] ${E2E_DB}: создана заново, миграции применены`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
