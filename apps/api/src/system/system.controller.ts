import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AppInfo, BackgroundJobStatus, OrionModeInfo } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { resolveMode } from "../common/orion-mode";

@Controller("system")
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: BackgroundJobsService
  ) {}

  /**
   * S05 — public, unauthenticated: the login/register pages need this
   * *before* there is any session to decide whether to render the account
   * picker/PIN UI at all. Mode is not a secret (an operator's `.env` is not
   * exposed by revealing which of two known postures it runs in), and the
   * server-side gate (`AuthController` rejecting picker/PIN in server mode)
   * is the actual access control — this just lets the client match it.
   */
  @Get("mode")
  mode(): OrionModeInfo {
    return { mode: resolveMode() };
  }

  @Get("info")
  info(): AppInfo {
    return {
      name: "ORION",
      version: process.env.APP_VERSION ?? "0.2.0",
      apiVersion: "2026-09-09",
      environment: process.env.NODE_ENV ?? "development",
      updateManifestUrl: process.env.DESKTOP_UPDATE_MANIFEST_URL ?? null
    };
  }

  /**
   * G9 — состояние фоновых задач по компонентам. Нужен вход, но не членство в
   * пространстве: ответ содержит только имена задач, счётчики и текст последней
   * ошибки процесса, данных пространств в нём нет.
   */
  @Get("jobs")
  @UseGuards(JwtAuthGuard)
  listJobs(): BackgroundJobStatus[] {
    return this.jobs.list();
  }

  @Get("health")
  async health(): Promise<{ status: "ok"; database: "ok"; timestamp: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", timestamp: new Date().toISOString() };
  }
}
