import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { RequestOptions } from "node:http";
import { request as rawRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";

/**
 * P0-1: входной DNS-rebinding/CSRF guard (apps/api/src/common/host-guard.ts).
 * Мидлварь монтируется в configureApp до любых маршрутов, поэтому прогон
 * идёт против полного приложения: чужой Host должен получить 421 до
 * обработчиков, чужой Origin — 403, штатные loopback-обращения — как раньше.
 * Host-заголовок задаётся через node:http: undici (fetch) перезаписывает его.
 */
describe("Host/Origin guard (integration)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  function probe(options: RequestOptions): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const req = rawRequest({ host: "127.0.0.1", port, path: "/system/health", method: "GET", ...options }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("rejects a DNS-rebinding Host with 421 before any route runs", async () => {
    const result = await probe({ headers: { host: "evil.example.com:14000" } });
    expect(result.status).toBe(421);
  });

  it("rejects a whitelisted Host with a foreign Origin (simple-request CSRF)", async () => {
    const response = await fetch(`${baseUrl}/system/health`, {
      headers: { origin: "https://evil.example.com" }
    });
    expect(response.status).toBe(403);
  });

  it("rejects a sandboxed null Origin", async () => {
    const response = await fetch(`${baseUrl}/system/health`, {
      headers: { origin: "null" }
    });
    expect(response.status).toBe(403);
  });

  it("serves loopback requests without an Origin header as before", async () => {
    const response = await fetch(`${baseUrl}/system/health`);
    expect(response.status).toBe(200);
  });

  it("serves loopback Origin on any port (dev servers, integration clients)", async () => {
    const response = await fetch(`${baseUrl}/system/health`, {
      headers: { origin: "http://127.0.0.1:53124" }
    });
    expect(response.status).toBe(200);
  });
});
