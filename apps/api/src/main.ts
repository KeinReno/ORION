// Must run before anything else: AuthModule reads process.env.JWT_SECRET
// etc. at import time (JwtModule.register() is synchronous), which happens
// before bootstrap() below ever runs. Without this, .env was silently
// never loaded by the app itself (only Prisma's CLI loads it on its own),
// so every process.env.X fallback was always in effect — including the
// insecure default JWT_SECRET.
import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
import { resolveBindHost, resolveMode } from "./common/orion-mode";

async function bootstrap(): Promise<void> {
  // Resolved before NestFactory.create() so an invalid ORION_MODE fails
  // fast with a clear message, not a stack trace from deep inside module
  // instantiation (see also AuthModule, which fails fast on a missing
  // JWT_SECRET in server mode at import time).
  const mode = resolveMode();
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.PORT ?? 4000);
  const host = resolveBindHost(mode);
  await app.listen(port, host);
  console.log(`[orion-api] mode=${mode} listening on http://${host}:${port}`);
}

void bootstrap();
