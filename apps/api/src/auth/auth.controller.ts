import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { loginInputSchema, registerInputSchema, type AuthResponse, type LoginInput, type RegisterInput } from "@orion/shared-types";
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

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: RequestUser): Promise<{ id: string; email: string; name: string }> {
    return this.auth.me(user.userId);
  }
}
