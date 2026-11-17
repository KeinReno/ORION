import type { NextFunction, Request, Response } from "express";
import os from "node:os";

/**
 * P0-1: входящий DNS-rebinding guard. Внешний близнец (исходящий SSRF-guard)
 * живёт в remote-url-guard.ts; этот защищает слушающую сторону: сайт
 * злоумышленника, чей DNS отвечает 127.0.0.1, не должен иметь возможности
 * управлять локальным API через собственный домен. CORS этого не закрывает:
 * он запрещает *читать* ответ, но не *выполнять* запрос — простые запросы
 * (GET, POST text/plain) доходят до обработчиков и меняют состояние.
 *
 * Две проверки, обе fail-closed, выполняются до любого маршрута:
 *  - Host: имя хоста (без порта, с учётом IPv6-скобок) обязано быть одним из
 *    loopback-имён, имени машины, хоста LAN-режима (PUBLIC_API_URL) или
 *    явного ORION_ALLOWED_EXTRA_HOSTS. Домен ребиндера здесь отсекается.
 *  - Origin: проверяется только когда заголовок присутствует. Допустимы
 *    origin'ы из того же списка, что и CORS-политика (configure-app.ts
 *    передаёт его сюда), плюс любой origin, чьё имя хоста само проходит
 *    hostAllowed (loopback/имя машины/LAN): локальный софт и dev-серверы
 *    (localhost:3011 и т.п.) работают как раньше, а вот запросы с сайтов
 *    извне (внешний домен в Origin, `null` у песочницы) до обработчиков не
 *    доходят — CORS раньше лишь «прячет» такой ответ, не останавливая
 *    выполнение. Угроза «локальный процесс-вредитель» вне модели: он может
 *    вызвать API напрямую без браузера.
 */

export interface HostGuardOptions {
  /** Те же origin, что разрешены CORS-политикой (полные значения заголовка). */
  allowedOrigins: readonly string[];
  /** Дополнительные имена хостов (env ORION_ALLOWED_EXTRA_HOSTS, списком). */
  extraHosts?: readonly string[];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Имя хоста из Host-заголовка: без порта, без IPv6-скобок, без IPv4-mapped префикса. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const value = hostHeader.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return null;
    return stripV4Mapped(value.slice(1, end));
  }
  const colons = (value.match(/:/g) ?? []).length;
  if (colons === 0) return stripV4Mapped(value);
  if (colons === 1) return stripV4Mapped(value.slice(0, value.indexOf(":")));
  // Несколько двоеточий без скобок — голый IPv6 без порта.
  return stripV4Mapped(value);
}

function stripV4Mapped(host: string): string {
  return host.startsWith("::ffff:") ? host.slice("::ffff:".length) : host;
}

/** Хосты LAN-режима: имя из PUBLIC_API_URL (настройка «Хост LAN»). */
function lanHostnames(): Set<string> {
  const hosts = new Set<string>();
  const raw = (process.env.PUBLIC_API_URL ?? "").trim();
  if (raw) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host) hosts.add(host);
    } catch {
      // Невалидный PUBLIC_API_URL отсекается server-config аудитом раньше.
    }
  }
  return hosts;
}

export function createHostGuard(options: HostGuardOptions) {
  const machineName = (process.env.COMPUTERNAME || os.hostname() || "").trim().toLowerCase();
  const lanHosts = lanHostnames();
  const extra = new Set(
    (options.extraHosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean)
  );
  const allowedOrigins = new Set(
    options.allowedOrigins.map((origin) => origin.trim().toLowerCase()).filter(Boolean)
  );

  const hostAllowed = (host: string): boolean =>
    LOOPBACK_HOSTS.has(host) ||
    (machineName !== "" && host === machineName) ||
    lanHosts.has(host) ||
    extra.has(host);

  const originAllowed = (origin: string): boolean => {
    const normalized = origin.trim().toLowerCase();
    if (allowedOrigins.has(normalized)) return true;
    // Origin с loopback/своим именем хоста (dev-серверы, локальный софт):
    // внешний домен сюда не попадёт, а интеграционные тесты и dev-режим
    // ходят именно с 127.0.0.1:<случайный порт>.
    try {
      return hostAllowed(new URL(normalized).hostname.toLowerCase());
    } catch {
      return false;
    }
  };

  return function hostGuard(request: Request, response: Response, next: NextFunction): void {
    const host = hostnameOf(request.headers.host);
    if (host === null || !hostAllowed(host)) {
      response.status(421).json({
        statusCode: 421,
        message: "Host не обслуживается этим сервером",
        error: "Misdirected Request"
      });
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin.trim() !== "" && !originAllowed(origin)) {
      response.status(403).json({
        statusCode: 403,
        message: "Origin не разрешён для этого сервера",
        error: "Forbidden"
      });
      return;
    }
    next();
  };
}
