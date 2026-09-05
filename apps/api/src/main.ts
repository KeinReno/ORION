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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true
  });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`[orion-api] listening on http://localhost:${port}`);
}

void bootstrap();
