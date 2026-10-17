// Must run before anything else: AuthModule reads process.env.JWT_SECRET
// etc. at import time (JwtModule.register() is synchronous), which happens
// before bootstrap() below ever runs. Without this, .env was silently
// never loaded by the app itself (only Prisma's CLI loads it on its own),
// so every process.env.X fallback was always in effect — including the
// insecure default JWT_SECRET.
import "dotenv/config";
import "reflect-metadata";
import https from "node:https";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
import { resolveBindHost, resolveMode } from "./common/orion-mode";
import { PrismaService } from "./common/prisma.service";
import { LanService } from "./lan/lan.service";
import { assertServerConfig, describeDbRoleProblems, type DbRoleRow } from "./common/server-config";

async function bootstrap(): Promise<void> {
  // Resolved before NestFactory.create() so an invalid ORION_MODE fails
  // fast with a clear message, not a stack trace from deep inside module
  // instantiation (see also AuthModule, which fails fast on a missing
  // JWT_SECRET in server mode at import time).
  const mode = resolveMode();
  // Server mode refuses to boot on a configuration whose development fallbacks
  // would be holes on a real network (see server-config.ts).
  if (mode === "server") assertServerConfig(process.env);
  const app = await NestFactory.create(AppModule);
  if (mode === "server") {
    // Ask the database who we really are: a superuser/BYPASSRLS connection
    // silently disables FORCE ROW LEVEL SECURITY.
    const [role] = await app.get(PrismaService).$queryRaw<DbRoleRow[]>`SELECT rolname::text AS rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const problems = describeDbRoleProblems(role);
    if (problems.length > 0) {
      await app.close();
      throw new Error(`Подключение к БД небезопасно, запуск остановлен:\n- ${problems.join("\n- ")}`);
    }
  }
  configureApp(app);
  const port = Number(process.env.PORT ?? 4000);
  const host = resolveBindHost(mode);
  await app.listen(port, host);
  console.log(`[orion-api] mode=${mode} listening on http://${host}:${port}`);
  if (process.env.ORION_LAN_HOST === "1") {
    // «Хост LAN»: тот же Express-приложение ещё и по TLS на LAN-интерфейсе. Loopback-HTTP выше остаётся для окна
    // ORION этого же ПК и проверки готовности лаунчера; PostgreSQL отсюда не затрагивается и слушает только 127.0.0.1.
    if (mode !== "server") throw new Error("ORION_LAN_HOST=1 требует ORION_MODE=server: режим хоста обязан включать серверные защиты.");
    const { key, cert, port: lanPort } = app.get(LanService).tlsCredentials();
    const lanHost = process.env.ORION_LAN_BIND?.trim() || "0.0.0.0";
    await new Promise<void>((resolve, reject) => {
      const server = https.createServer({ key, cert, minVersion: "TLSv1.2" }, app.getHttpAdapter().getInstance());
      server.once("error", reject);
      server.listen(lanPort, lanHost, () => resolve());
    });
    console.log(`[orion-api] LAN host listening on https://${lanHost}:${lanPort}`);
  }
}

void bootstrap();
