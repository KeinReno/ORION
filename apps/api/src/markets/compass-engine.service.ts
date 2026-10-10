import { Injectable, Logger, OnModuleDestroy, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { CompassEngineStatus } from "@orion/shared-types";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { isServerMode } from "../common/orion-mode";

const HOST = "127.0.0.1";

/** Что из API движка доступно панелям ORION: всё, кроме симуляции, потока котировок и управления окном приложения. */
export function isProxiedPath(apiPath: string): boolean {
  const pathOnly = apiPath.split("?")[0] ?? "";
  if (!pathOnly.startsWith("/api/") || pathOnly.includes("..")) return false;
  return !/^\/api\/(sim|app|live)(\/|$)/.test(pathOnly);
}

/**
 * Движок Compass (Python, `apps/compass-engine`) как служба ORION. ORION запускает его сам, по требованию, и гасит вместе с API.
 *
 * Границы:
 * - только режим `local`: у Compass один пользователь и один набор данных (журнал, счета, настройки), а не изоляция по
 *   пространствам — в `server`-режиме его запуск отклоняется;
 * - слушает только 127.0.0.1, API закрыт случайным токеном сессии (куки HttpOnly) — это защита от чужих веб-страниц;
 * - данные движка лежат в `<COMPASS_DATA_DIR>/<workspaceId>` (по умолчанию `apps/api/.data/compass`) — свой каталог у каждого пространства, Postgres не затрагивается; движок один на машину, смена пространства его перезапускает.
 */
@Injectable()
export class CompassEngineService implements OnModuleDestroy {
  private readonly log = new Logger("CompassEngine");
  private child: ChildProcess | null = null;
  private token = "";
  private failure: string | null = null;
  /** Пространство, чьи данные сейчас открыты в движке: у каждого пространства свой каталог данных Compass. */
  private forWorkspace: string | null = null;
  private starting: Promise<void> | null = null;

  private get port(): number {
    return Number(process.env.COMPASS_ENGINE_PORT ?? 8766);
  }

  private dataDir(workspaceId: string): string {
    return path.join(process.env.COMPASS_DATA_DIR ?? path.resolve(process.cwd(), ".data", "compass"), workspaceId);
  }

  private engineDir(): string {
    return process.env.COMPASS_ENGINE_DIR ?? path.resolve(process.cwd(), "..", "compass-engine");
  }

  status(workspaceId: string): CompassEngineStatus {
    if (isServerMode()) {
      return { state: "unavailable", message: "В режиме server движок Compass не запускается: он рассчитан на одного пользователя на этом компьютере.", url: null };
    }
    // Движок, открытый на данных другого пространства, для этого пространства «не запущен»: чужой журнал и счета не показываем.
    if (this.forWorkspace !== null && this.forWorkspace !== workspaceId && (this.starting || (this.child && this.child.exitCode === null))) {
      return { state: "stopped", message: null, url: null };
    }
    if (this.starting) return { state: "starting", message: null, url: null };
    if (this.child && this.child.exitCode === null) {
      return { state: "running", message: null, url: `http://localhost:${this.port}/?token=${this.token}` };
    }
    if (this.failure) return { state: "failed", message: this.failure, url: null };
    return { state: "stopped", message: null, url: null };
  }

  /** Запускает движок (если не запущен) и ждёт, пока он ответит. Повторный вызов при работающем движке ничего не делает. */
  async start(workspaceId: string): Promise<CompassEngineStatus> {
    if (isServerMode()) return this.status(workspaceId);
    if (this.child && this.child.exitCode === null && this.forWorkspace === workspaceId) return this.status(workspaceId);
    // Один движок на машину: переключение пространства перезапускает его на каталоге данных нового.
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.child && this.child.exitCode === null && this.forWorkspace === workspaceId) return this.status(workspaceId);
    this.kill();
    this.forWorkspace = workspaceId;
    this.starting = this.spawnAndWait(workspaceId).finally(() => {
      this.starting = null;
    });
    await this.starting.catch(() => undefined);
    return this.status(workspaceId);
  }

  /**
   * Запрос к API движка от имени пользователя ORION: ORION проверил членство в пространстве и модуль, движок видит только свой
   * токен сессии. Симуляция фьючерсов и управление самим окном/автозапуском Compass наружу не пробрасываются.
   */
  async proxy(workspaceId: string, method: string, apiPath: string, body: unknown): Promise<{ status: number; contentType: string; body: Buffer }> {
    if (this.status(workspaceId).state !== "running") throw new ServiceUnavailableException("Compass не запущен: запустите его во вкладке «Compass».");
    if (!isProxiedPath(apiPath)) throw new NotFoundException("Этот раздел Compass в ORION недоступен.");
    const hasBody = !["GET", "HEAD", "DELETE"].includes(method);
    const response = await fetch(`http://${HOST}:${this.port}${apiPath}`, {
      method,
      headers: { Cookie: `compass_session=${this.token}`, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
      body: hasBody ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(120_000)
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: Buffer.from(await response.arrayBuffer())
    };
  }

  /** Журнал Compass целиком в формате резервной копии (то, что ORION разбирает при импорте). Движок должен работать для этого пространства. */
  async journalBackup(workspaceId: string): Promise<unknown> {
    if (this.status(workspaceId).state !== "running") throw new ServiceUnavailableException("Compass не запущен: запустите его во вкладке «Compass».");
    const response = await fetch(`http://${HOST}:${this.port}/api/journal/backup.json`, {
      headers: { Cookie: `compass_session=${this.token}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new ServiceUnavailableException(`Compass не отдал журнал (код ${response.status}).`);
    return response.json();
  }

  stop(workspaceId: string): CompassEngineStatus {
    if (this.forWorkspace === workspaceId || this.forWorkspace === null) this.kill();
    this.failure = null;
    return this.status(workspaceId);
  }

  onModuleDestroy(): void {
    this.kill();
  }

  private kill(): void {
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.child = null;
  }

  private async spawnAndWait(workspaceId: string): Promise<void> {
    this.failure = null;
    this.token = randomBytes(24).toString("base64url");
    mkdirSync(this.dataDir(workspaceId), { recursive: true });
    if (await this.portInUse()) {
      this.failure = `Порт ${this.port} занят другой программой. Задайте COMPASS_ENGINE_PORT.`;
      return;
    }
    const python = process.env.COMPASS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const child = spawn(python, ["run_engine.py"], {
      cwd: this.engineDir(),
      env: {
        ...process.env,
        COMPASS_DATA_DIR: this.dataDir(workspaceId),
        COMPASS_PORT: String(this.port),
        COMPASS_SESSION_TOKEN: this.token,
        PYTHONIOENCODING: "utf-8"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error) => {
      this.failure = `Не удалось запустить Python (${python}): ${error.message}. Нужен Python 3.11+ с пакетами движка (fastapi, uvicorn, pandas, ccxt, numpy, httpx).`;
    });
    child.on("exit", (code) => {
      if (this.child === child) this.child = null;
      if (code !== 0 && code !== null && !this.failure) {
        this.failure = `Движок Compass остановился (код ${code}). ${stderr.trim().split("\n").slice(-3).join(" ")}`;
      }
    });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.failure || child.exitCode !== null) break;
      if (await this.healthy()) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!this.failure) this.failure = "Движок Compass не ответил за 30 секунд.";
    this.log.warn(this.failure);
    this.kill();
  }

  private portInUse(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: HOST, port: this.port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  }

  private async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`http://${HOST}:${this.port}/api/health`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  }
}
