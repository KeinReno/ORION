import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import type { AuthResponse, LoginInput, RegisterInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");

interface UserLike {
  id: string;
  email: string;
  name: string;
}

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

    // Bootstrapping a brand-new user's first workspace is inherently a
    // system-level operation: the workspaces RLS policy checks for an
    // existing membership row, which by definition can't exist yet at the
    // moment the workspace itself is created. See ORION v0.2 plan.
    const user = await this.prisma.asSystem(async (tx) => {
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

    return this.issueTokenPair(user);
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
    return this.issueTokenPair(user);
  }

  async me(userId: string): Promise<{ id: string; email: string; name: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, email: user.email, name: user.name };
  }

  /**
   * Rotates a refresh token: the presented token is revoked (one-time use)
   * and a fresh access+refresh pair is issued. An unknown, expired, or
   * already-revoked token is rejected outright — reusing a rotated-out
   * token is exactly the signal that would indicate a stolen token.
   *
   * The revoke is a single conditional `updateMany` (WHERE revokedAt IS
   * NULL) rather than a separate read-then-write, so two concurrent calls
   * with the same token can't both slip through the revoked-check race and
   * both mint a valid pair — only the update that actually flips the row
   * wins; the loser's freshly-minted pair is revoked again immediately.
   */
  async refresh(rawToken: string): Promise<AuthResponse> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Сессия недействительна, войдите заново");
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new UnauthorizedException("Сессия недействительна, войдите заново");
    }

    const { id: newId, raw: newRaw } = await this.createRefreshToken(user.id);

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: newId }
    });
    if (revoked.count === 0) {
      // Lost the race to another concurrent refresh of the same token —
      // the pair we just minted must not be handed out.
      await this.prisma.refreshToken.update({ where: { id: newId }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Сессия недействительна, войдите заново");
    }

    return this.issueTokenPairFrom(user, newRaw);
  }

  /** Idempotent — revoking an already-revoked or unknown token is not an error. */
  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  private async issueTokenPair(user: UserLike): Promise<AuthResponse> {
    const { raw } = await this.createRefreshToken(user.id);
    return this.issueTokenPairFrom(user, raw);
  }

  private issueTokenPairFrom(user: UserLike, rawRefreshToken: string): AuthResponse {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: { id: user.id, email: user.email, name: user.name }
    };
  }

  private async createRefreshToken(userId: string): Promise<{ id: string; raw: string }> {
    const raw = randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt }
    });
    return { id: row.id, raw };
  }
}

/** sha256 is enough here: refresh tokens are already 48 random bytes of full entropy, not a password — no need for a slow KDF. */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
