import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { isIP } from "node:net";
import { AgentDeleteReasonInterceptor } from "./ai/agent-delete-reason.interceptor";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { createHostGuard } from "./common/host-guard";
import { RequestLoggingInterceptor } from "./common/request-logging.interceptor";
import { configureLan } from "./lan/configure-lan";

const DEFAULT_WEB_ORIGIN = "http://localhost:3010";
const DEFAULT_DESKTOP_ORIGINS = ["http://tauri.localhost", "tauri://localhost"];

export function configureApp(app: INestApplication): void {
  const trustedProxies = parseTrustedProxies(process.env.ORION_TRUSTED_PROXIES);
  // Express ignores X-Forwarded-For by default. Trust only the explicitly
  // listed reverse proxy addresses; never trust an arbitrary client header.
  if (trustedProxies.length > 0) {
    (app as NestExpressApplication).set("trust proxy", trustedProxies);
  }

  const configuredOrigins = (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = [...new Set([...configuredOrigins, ...DEFAULT_DESKTOP_ORIGINS])];

  // P0-1: DNS-rebinding guard — раньше любого маршрута. CORS ниже запрещает
  // читать ответ, но не выполнять запрос; этот слой отсекает чужие Host/Origin
  // до обработчиков. Extra-хосты — через ORION_ALLOWED_EXTRA_HOSTS.
  (app as NestExpressApplication).use(
    createHostGuard({
      allowedOrigins: origins,
      extraHosts: (process.env.ORION_ALLOWED_EXTRA_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean)
    })
  );

  // The default JSON limit (100 kB) is smaller than a 2000-row import batch; everything else stays tiny.
  (app as NestExpressApplication).useBodyParser("json", { limit: "2mb" });
  app.enableCors({ origin: origins, credentials: true });
  configureLan(app);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor(), new AgentDeleteReasonInterceptor());
  app.enableShutdownHooks();
}

export function parseTrustedProxies(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((part) => {
    const value = part.trim();
    const [address, prefix, extra] = value.split("/");
    const version = isIP(address ?? "");
    const maxPrefix = version === 4 ? 32 : 128;
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) === 0 || Number(prefix) > maxPrefix))) {
      throw new Error(`Invalid ORION_TRUSTED_PROXIES entry: ${value}`);
    }
    return value;
  });
}
