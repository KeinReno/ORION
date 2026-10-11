import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  changePasswordInputSchema,
  loginInputSchema,
  logoutInputSchema,
  refreshInputSchema,
  registerInputSchema,
  updateProfileInputSchema,
  type AccountPublic,
  type AuthResponse,
  type ChangePasswordInput,
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type RegisterInput,
  type SessionInfo,
  type SessionUser,
  type UpdateProfileInput
} from "@orion/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { MAX_UPLOAD_BYTES } from "../common/multipart";
import type { RequestUser } from "./jwt.strategy";
import { AuthService } from "./auth.service";
import { isServerMode } from "../common/orion-mode";
import { LoginRateLimitGuard } from "./login-rate-limit.guard";
import { RegisterRateLimitGuard } from "./register-rate-limit.guard";
import { clientIp } from "../common/client-ip";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Local user directory — pick an account before unlocking. S05: this is a
   * *passwordless* directory of every local account (names, avatars,
   * workspaces) — fine for a single desktop with one keyboard in front of
   * it, a real information disclosure (and PIN-guessing surface — see
   * `AuthService.login`) once the process is reachable from a network with
   * more than one person on it. Server mode refuses it outright; the web/
   * desktop client falls back to its named-login form (S05 done-criterion:
   * "server mode не выдаёт directory").
   */
  @Get("accounts")
  listAccounts(): Promise<AccountPublic[]> {
    if (isServerMode()) {
      throw new ForbiddenException("Список локальных аккаунтов недоступен в серверном режиме");
    }
    return this.auth.listAccounts();
  }

  @Get("accounts/:userId/avatar")
  async avatar(@Param("userId") userId: string, @Res() res: Response): Promise<void> {
    if (isServerMode()) {
      throw new ForbiddenException("Недоступно в серверном режиме");
    }
    const { stream, mime } = await this.auth.openAvatar(userId);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.destroy();
    });
    stream.pipe(res);
  }

  // S05 follow-up (2026-09-22): a flat per-IP limiter like login's was
  // deliberately skipped here first (see git history / 12-PROGRESS.md) — it
  // broke legitimate bulk flows (seed scripts, this repo's own integration
  // tests registering dozens of accounts from one loopback IP). Rather than
  // leaving the route unlimited, `RegisterRateLimitGuard` uses two windows
  // sized for that: a generous per-IP flood cap, and a tight per-(IP,email)
  // cap that targets the actual abuse pattern (repeated registration
  // attempts against one email — enumeration/spam), which bulk flows never
  // hit because they use a distinct email per account. See the guard's own
  // doc comment for the reasoning and thresholds.
  @UseGuards(RegisterRateLimitGuard)
  @Post("register")
  register(@Req() req: Request, @Body(new ZodValidationPipe(registerInputSchema)) body: RegisterInput): Promise<AuthResponse> {
    return this.auth.register(body, requestMetadata(req));
  }

  @UseGuards(LoginRateLimitGuard)
  @Post("login")
  login(@Req() req: Request, @Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput): Promise<AuthResponse> {
    return this.auth.login(body, requestMetadata(req));
  }

  @Post("refresh")
  refresh(@Body(new ZodValidationPipe(refreshInputSchema)) body: RefreshInput): Promise<AuthResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @HttpCode(204)
  @Post("logout")
  async logout(@Body(new ZodValidationPipe(logoutInputSchema)) body: LogoutInput): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post("logout-all")
  async logoutAll(@CurrentUser() user: RequestUser): Promise<void> {
    await this.auth.logoutAll(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: RequestUser): Promise<SessionUser> {
    return this.auth.me(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch("profile")
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateProfileInputSchema)) body: UpdateProfileInput
  ): Promise<SessionUser> {
    return this.auth.updateProfile(user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(changePasswordInputSchema)) body: ChangePasswordInput
  ): Promise<SessionUser> {
    return this.auth.changePassword(user.userId, user.sessionId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post("avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: Math.min(MAX_UPLOAD_BYTES, 2 * 1024 * 1024) } }))
  setAvatar(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined
  ): Promise<SessionUser> {
    return this.auth.setAvatar(user.userId, {
      buffer: file?.buffer ?? Buffer.alloc(0),
      mimetype: file?.mimetype ?? "",
      size: file?.size ?? 0
    });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Delete("avatar")
  async removeAvatar(@CurrentUser() user: RequestUser): Promise<void> {
    await this.auth.removeAvatar(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get("sessions")
  sessions(@CurrentUser() user: RequestUser): Promise<SessionInfo[]> {
    return this.auth.listSessions(user.userId, user.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Delete("sessions/:sessionId")
  async revokeSession(@CurrentUser() user: RequestUser, @Param("sessionId") sessionId: string): Promise<void> {
    await this.auth.revokeSession(user.userId, sessionId);
  }
}

function requestMetadata(req: Request): { userAgent?: string; ipAddress?: string; deviceName?: string } {
  const userAgent = req.get("user-agent") ?? undefined;
  return {
    userAgent,
    ipAddress: clientIp(req),
    deviceName: userAgent ? describeDevice(userAgent) : "Неизвестное устройство"
  };
}

function describeDevice(userAgent: string): string {
  if (/Tauri/i.test(userAgent)) return "ORION Desktop";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Браузер";
  const os = /Windows/i.test(userAgent) ? "Windows" : /Mac OS/i.test(userAgent) ? "macOS" : /Linux/i.test(userAgent) ? "Linux" : "устройство";
  return `${browser} · ${os}`;
}
