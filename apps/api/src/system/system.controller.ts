import { Controller, Get } from "@nestjs/common";
import type { AppInfo, OrionModeInfo } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { resolveMode } from "../common/orion-mode";

@Controller("system")
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Get("health")
  async health(): Promise<{ status: "ok"; database: "ok"; timestamp: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", timestamp: new Date().toISOString() };
  }
}
