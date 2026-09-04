import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import type { AuthResponse, LoginInput, RegisterInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException("Пользователь с таким email уже зарегистрирован");
    }

    const passwordHash = await argon2.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, passwordHash, name: input.name }
      });
      const workspace = await tx.workspace.create({
        data: { name: `${input.name} — личное пространство` }
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: created.id, role: "owner" }
      });
      return created;
    });

    return this.buildAuthResponse(user.id, user.email, user.name);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw new UnauthorizedException("Неверный email или пароль");
    }
    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException("Неверный email или пароль");
    }
    return this.buildAuthResponse(user.id, user.email, user.name);
  }

  async me(userId: string): Promise<{ id: string; email: string; name: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, email: user.email, name: user.name };
  }

  private buildAuthResponse(id: string, email: string, name: string): AuthResponse {
    const accessToken = this.jwt.sign({ sub: id, email });
    return { accessToken, user: { id, email, name } };
  }
}
