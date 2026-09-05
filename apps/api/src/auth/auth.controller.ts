import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
  loginInputSchema,
  logoutInputSchema,
  refreshInputSchema,
  registerInputSchema,
  type AuthResponse,
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type RegisterInput
} from "@orion/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "./jwt.strategy";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body(new ZodValidationPipe(registerInputSchema)) body: RegisterInput): Promise<AuthResponse> {
    return this.auth.register(body);
  }

  @Post("login")
  login(@Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput): Promise<AuthResponse> {
    return this.auth.login(body);
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
  me(@CurrentUser() user: RequestUser): Promise<{ id: string; email: string; name: string }> {
    return this.auth.me(user.userId);
  }
}
