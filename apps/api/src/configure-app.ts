import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { RequestLoggingInterceptor } from "./common/request-logging.interceptor";

const DEFAULT_WEB_ORIGIN = "http://localhost:3010";
const DEFAULT_DESKTOP_ORIGINS = ["http://tauri.localhost", "tauri://localhost"];

export function configureApp(app: INestApplication): void {
  const configuredOrigins = (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = [...new Set([...configuredOrigins, ...DEFAULT_DESKTOP_ORIGINS])];

  // The default JSON limit (100 kB) is smaller than a 2000-row import batch; everything else stays tiny.
  (app as NestExpressApplication).useBodyParser("json", { limit: "2mb" });
  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());
  app.enableShutdownHooks();
}
