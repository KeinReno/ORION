import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AppInfo, BackgroundJobStatus, ComponentDataStatus, OrionModeInfo } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { resolveMode } from "../common/orion-mode";
import { resolveLoginPolicy } from "../auth/login-policy";
import { ComponentDataService } from "./component-data.service";

@Controller("system")
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: BackgroundJobsService,
    private readonly componentData: ComponentDataService
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
    return { mode: resolveMode(), loginPolicy: resolveLoginPolicy() };
  }

  @Get("info")
  info(): AppInfo {
    return {
      name: "ORION",
      version: process.env.APP_VERSION ?? "0.2.0",
      apiVersion: "2026-09-09",
      environment: process.env.NODE_ENV ?? "development",
      updateManifestUrl: process.env.DESKTOP_UPDATE_MANIFEST_URL ?? null,
      // ORION-14: from the staged runtime's build.json via the launcher — lets «О программе» answer
      // "is this install actually the commit I think it is" without reaching for git log.
      buildTag: process.env.ORION_BUILD_TAG?.trim() || null,
      commit: process.env.ORION_BUILD_COMMIT?.trim() || null,
      builtAt: process.env.ORION_BUILD_TIME?.trim() || null
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

  /**
   * G11 — применены ли миграции компонентов, подключённых манифестом. Нужен вход, но не членство:
   * в ответе только имена компонентов и миграций.
   */
  @Get("components")
  @UseGuards(JwtAuthGuard)
  listComponentData(): Promise<ComponentDataStatus[]> {
    return this.componentData.list();
  }

  @Get("health")
  async health(): Promise<{ status: "ok"; database: "ok"; timestamp: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", timestamp: new Date().toISOString() };
  }
}
