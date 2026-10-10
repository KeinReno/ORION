import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { CompassEngineStatus } from "@orion/shared-types";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { isServerMode } from "../common/orion-mode";

const HOST = "127.0.0.1";

/**
 * Движок Compass (Python, `apps/compass-engine`) как служба ORION. ORION запускает его сам, по требованию, и гасит вместе с API.
 *
 * Границы:
 * - только режим `local`: у Compass один пользователь и один набор данных (журнал, счета, настройки), а не изоляция по
 *   пространствам — в `server`-режиме его запуск отклоняется;
 * - слушает только 127.0.0.1, API закрыт случайным токеном сессии (куки HttpOnly) — это защита от чужих веб-страниц;
 * - данные движка лежат в `COMPASS_DATA_DIR` (по умолчанию `apps/api/.data/compass`) и не затрагивают Postgres.
 */
@Injectable()
export class CompassEngineService implements OnModuleDestroy {
  private readonly log = new Logger("CompassEngine");
  private child: ChildProcess | null = null;
  private token = "";
  private failure: string | null = null;
  private starting: Promise<void> | null = null;

  private get port(): number {
    return Number(process.env.COMPASS_ENGINE_PORT ?? 8766);
  }

  private get dataDir(): string {
    return process.env.COMPASS_DATA_DIR ?? path.resolve(process.cwd(), ".data", "compass");
  }

  private engineDir(): string {
    return process.env.COMPASS_ENGINE_DIR ?? path.resolve(process.cwd(), "..", "compass-engine");
  }

  status(): CompassEngineStatus {
    if (isServerMode()) {
      return { state: "unavailable", message: "В режиме server движок Compass не запускается: он рассчитан на одного пользователя на этом компьютере.", url: null };
    }
    if (this.starting) return { state: "starting", message: null, url: null };
    if (this.child && this.child.exitCode === null) {
      return { state: "running", message: null, url: `http://localhost:${this.port}/?token=${this.token}` };
    }
    if (this.failure) return { state: "failed", message: this.failure, url: null };
    return { state: "stopped", message: null, url: null };
  }

  /** Запускает движок (если не запущен) и ждёт, пока он ответит. Повторный вызов при работающем движке ничего не делает. */
  async start(): Promise<CompassEngineStatus> {
    if (isServerMode()) return this.status();
    if (this.child && this.child.exitCode === null) return this.status();
    this.starting ??= this.spawnAndWait().finally(() => {
      this.starting = null;
    });
    await this.starting.catch(() => undefined);
    return this.status();
  }

  stop(): CompassEngineStatus {
    this.kill();
    this.failure = null;
    return this.status();
  }

  onModuleDestroy(): void {
    this.kill();
  }

  private kill(): void {
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.child = null;
  }

  private async spawnAndWait(): Promise<void> {
    this.failure = null;
    this.token = randomBytes(24).toString("base64url");
    mkdirSync(this.dataDir, { recursive: true });
    if (await this.portInUse()) {
      this.failure = `Порт ${this.port} занят другой программой. Задайте COMPASS_ENGINE_PORT.`;
      return;
    }
    const python = process.env.COMPASS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const child = spawn(python, ["run_engine.py"], {
      cwd: this.engineDir(),
      env: {
        ...process.env,
        COMPASS_DATA_DIR: this.dataDir,
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
