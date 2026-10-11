import { isIP } from "node:net";
import { parseTrustedProxies } from "../configure-app";

/**
 * Fail-fast configuration audit for `ORION_MODE=server`.
 *
 * Local mode forgives a missing variable with a development fallback; on a real
 * network each of those fallbacks is a silent hole (a superuser database
 * connection that bypasses RLS, CORS pinned to `localhost`, calendar feed links
 * that point at the visitor's own machine). Every rule below is one such hole.
 * Errors stop the process before it listens; warnings are logged and left to the
 * operator because they depend on topology the process cannot see.
 */
export interface ServerConfigReport {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const MIN_JWT_SECRET_LENGTH = 32;
const KNOWN_WEAK_SECRETS = new Set(["dev-only-insecure-secret", "replace-me", "changeme", "secret"]);
// Passwords committed to the repository (infra/postgres/init/01-app-roles.sql, docker-compose, CI, demo
// launchers). Anyone can read them on GitHub, so a server using them is open to the world.
const PUBLISHED_DB_PASSWORDS = ["OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI", "orion_local_dev"];

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_NAMES.has(hostname) || hostname.endsWith(".localhost");
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function checkServerConfig(env: Env): ServerConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const jwt = env.JWT_SECRET?.trim() ?? "";
  if (jwt.length < MIN_JWT_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(jwt.toLowerCase())) {
    errors.push(
      `JWT_SECRET должен быть случайным и не короче ${MIN_JWT_SECRET_LENGTH} символов (например: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").`
    );
  }

  const appDb = env.APP_DATABASE_URL?.trim();
  const migrationDb = env.DATABASE_URL?.trim();
  if (!appDb) {
    errors.push(
      "APP_DATABASE_URL не задан: без него API подключился бы ролью из DATABASE_URL (суперпользователь, BYPASSRLS) и RLS перестала бы действовать."
    );
  } else if (migrationDb && appDb === migrationDb) {
    errors.push("APP_DATABASE_URL совпадает с DATABASE_URL: для API нужна отдельная роль orion_app (NOSUPERUSER, NOBYPASSRLS).");
  }

  for (const [name, value] of [["APP_DATABASE_URL", appDb], ["DATABASE_URL", migrationDb]] as const) {
    if (value && PUBLISHED_DB_PASSWORDS.some((password) => value.includes(password))) {
      errors.push(`${name} содержит пароль из репозитория (он публично известен). Задайте свой: ALTER ROLE ... PASSWORD (см. docs/DEPLOYMENT_READINESS.md).`);
    }
  }

  const origins = (env.WEB_ORIGINS ?? env.WEB_ORIGIN ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    errors.push("WEB_ORIGIN (или WEB_ORIGINS) не задан: по умолчанию CORS разрешил бы только http://localhost:3010.");
  }
  for (const origin of origins) {
    const url = parseUrl(origin);
    if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
      errors.push(`WEB_ORIGIN "${origin}" должен быть origin вида https://host[:port] без пути.`);
    } else if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      errors.push(`WEB_ORIGIN "${origin}" использует http: на сервере нужен HTTPS (иначе токены уходят открытым текстом).`);
    } else if (isLoopbackHost(url.hostname)) {
      warnings.push(`WEB_ORIGIN "${origin}" указывает на loopback: удалённый браузер к такому узлу не подключится.`);
    }
  }

  const publicApi = env.PUBLIC_API_URL?.trim();
  if (!publicApi) {
    errors.push("PUBLIC_API_URL не задан: ссылки на календарную подписку получили бы адрес http://localhost:4000.");
  } else {
    const url = parseUrl(publicApi);
    if (!url || !/^https?:$/.test(url.protocol)) {
      errors.push(`PUBLIC_API_URL "${publicApi}" не является http(s)-адресом.`);
    } else if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      errors.push(`PUBLIC_API_URL "${publicApi}" использует http: нужен HTTPS.`);
    } else if (isLoopbackHost(url.hostname)) {
      errors.push(`PUBLIC_API_URL "${publicApi}" указывает на loopback: внешние клиенты получат нерабочие ссылки.`);
    }
  }

  try {
    const proxies = parseTrustedProxies(env.ORION_TRUSTED_PROXIES);
    if (proxies.length === 0) {
      warnings.push(
        "ORION_TRUSTED_PROXIES пуст: за reverse proxy все клиенты выглядят как адрес прокси и делят один лимит попыток входа. Без прокси это нормально."
      );
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const syncSecret = env.SYNC_SECRET?.trim();
  if (!syncSecret) {
    warnings.push("SYNC_SECRET не задан: резервные копии в WebDAV и пароли календарей сохранить нельзя.");
  } else if (Buffer.from(syncSecret, "base64").length !== 32) {
    errors.push("SYNC_SECRET должен быть 32 байтами в base64.");
  }

  const driver = env.STORAGE_DRIVER?.trim() || "local";
  if (driver === "local" && !env.STORAGE_DIR?.trim()) {
    warnings.push(
      "STORAGE_DIR не задан: файлы пойдут в ./.data/documents относительно рабочего каталога процесса; смонтируйте постоянный том и задайте путь явно."
    );
  }

  const host = env.HOST?.trim();
  if (host && isIP(host) === 0 && !isLoopbackHost(host)) {
    warnings.push(`HOST "${host}" не похож на IP-адрес прослушивания.`);
  }

  return { errors, warnings };
}

/** Throws one error listing every blocking problem, so an operator fixes them in one pass. */
export function assertServerConfig(env: Env, log: (message: string) => void = console.warn): void {
  const { errors, warnings } = checkServerConfig(env);
  for (const warning of warnings) log(`[orion-api] ПРЕДУПРЕЖДЕНИЕ конфигурации: ${warning}`);
  if (errors.length > 0) {
    throw new Error(`Конфигурация ORION_MODE=server небезопасна, запуск остановлен:\n- ${errors.join("\n- ")}`);
  }
}

export interface DbRoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * The URL check above only compares strings; this asks the database who the
 * connection actually is. A role that is a superuser or has BYPASSRLS makes
 * `FORCE ROW LEVEL SECURITY` a no-op, so the second safety net is gone.
 */
export function describeDbRoleProblems(row: DbRoleRow | undefined): string[] {
  if (!row) return ["Не удалось определить роль подключения к БД."];
  const problems: string[] = [];
  if (row.rolsuper) problems.push(`Роль БД "${row.rolname}" — суперпользователь: RLS не действует.`);
  if (row.rolbypassrls) problems.push(`Роль БД "${row.rolname}" имеет BYPASSRLS: RLS не действует.`);
  return problems;
}
