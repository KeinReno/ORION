/**
 * QA-01: fail-closed database preflight for the destructive local test fixture.
 * This does not connect to PostgreSQL; connectivity and migration errors are
 * reported separately by the runner, never as a successful test result.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parsePgUrl(value, field) {
  if (!value) throw new Error(field + " must be set explicitly; refusing implicit apps/api/.env defaults");
  let url;
  try { url = new URL(value); } catch { throw new Error(field + " is not a valid PostgreSQL URL"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error(field + " must be a PostgreSQL URL");
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(field + " points outside localhost; QA must not access remote databases");
  if (!url.pathname || url.pathname === "/") throw new Error(field + " has no database name");
  return url;
}

export function validateQaDatabaseConfig({ databaseUrl, appDatabaseUrl, dbName, confirmReset }) {
  if (!/^orion_qa_[a-z0-9_]{1,32}$/.test(dbName ?? "")) {
    throw new Error("QA database name must match orion_qa_[a-z0-9_]{1,32}");
  }
  if (confirmReset !== dbName) {
    throw new Error("Explicit --confirm-reset=" + dbName + " is required before DROP DATABASE");
  }
  const admin = parsePgUrl(databaseUrl, "DATABASE_URL");
  const app = parsePgUrl(appDatabaseUrl, "APP_DATABASE_URL");
  if (admin.hostname !== app.hostname || (admin.port || "5432") !== (app.port || "5432")) {
    throw new Error("Database URLs must point to the same local PostgreSQL host and port");
  }
  if (admin.pathname !== app.pathname) {
    throw new Error("DATABASE_URL and APP_DATABASE_URL must point to the same base database");
  }
  if (decodeURIComponent(admin.pathname.slice(1)) === dbName) {
    throw new Error("Admin connection must use a different existing database from the one being reset");
  }
  const withQaName = (url) => {
    const next = new URL(url);
    next.pathname = "/" + dbName;
    return next.toString();
  };
  return {
    databaseUrl: withQaName(admin),
    appDatabaseUrl: withQaName(app),
    dbName
  };
}
