import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { resolveJwtSecret } from "../common/jwt-secret";
import { LoginRateLimitGuard } from "./login-rate-limit.guard";
import { RegisterRateLimitGuard } from "./register-rate-limit.guard";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginRateLimitGuard, RegisterRateLimitGuard],
  exports: [JwtModule]
})
export class AuthModule {}
