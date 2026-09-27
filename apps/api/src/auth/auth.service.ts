import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import type {
  AccountPublic,
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  SessionInfo,
  SessionUser,
  UnlockKind,
  UpdateProfileInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { STORAGE_ADAPTER, storageKey, type StorageAdapter } from "../storage/storage-adapter";
import { isServerMode } from "../common/orion-mode";

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface UserLike {
  id: string;
  email: string | null;
  name: string;
  unlockKind: string;
  hasAvatar: boolean;
  passwordStrength: number;
  passwordChangedAt: Date | null;
}

export interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
  deviceName?: string;
}

export interface UploadedAvatar {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
  ) {}

  async listAccounts(): Promise<AccountPublic[]> {
    const users = await this.prisma.asSystem(async (tx) =>
      tx.user.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          memberships: {
            include: { workspace: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" }
          }
        }
      })
    );
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      unlockKind: user.unlockKind === "pin" ? "pin" : "password",
      hasAvatar: user.hasAvatar,
      workspaces: user.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name }))
    }));
  }

  async register(input: RegisterInput, metadata: SessionMetadata = {}): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    if (email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictException("Пользователь с таким email уже зарегистрирован");
      }
    }

    const secret = input.pin ?? input.password;
    if (!secret) {
      throw new BadRequestException("Укажите пароль или PIN из 4 цифр");
    }
    // S05: PIN-разблокировка — сценарий "один человек за одной клавиатурой".
    // В серверном режиме (много пользователей, произвольная сеть) 4-значный
    // PIN — это 10000 комбинаций без rate-limit'а самого unlockKind'а между
    // разными аккаунтами directory; запрещаем его целиком, а не только прячем
    // picker. Пароль в серверном режиме дополнительно обязан быть не совсем
    // тривиальным — passwordScore ниже 2 означает "короткий и однообразный"
    // (см. passwordScore: только длина, без разных регистров/цифр+символов).
    if (isServerMode()) {
      if (input.pin) {
        throw new BadRequestException("PIN-вход отключён в серверном режиме — используйте пароль");
      }
      if (passwordScore(secret) < 2) {
        throw new BadRequestException(
          "В серверном режиме пароль должен быть длиннее и сложнее: используйте не менее 12 символов или сочетайте регистр/цифры/символы"
        );
      }
    }
    const unlockKind: UnlockKind = input.pin ? "pin" : "password";
    const passwordHash = await argon2.hash(secret);

    const user = await this.prisma.asSystem(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.name,
          unlockKind,
          passwordStrength: passwordScore(secret),
          passwordChangedAt: new Date()
        }
      });
      const workspace = await tx.workspace.create({
        data: { name: `${input.name} — личное пространство`, icsToken: randomBytes(24).toString("base64url") }
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: created.id, role: "owner" }
      });
      return created;
    });

    return this.issueTokenPair(user, metadata);
  }

  async login(input: LoginInput, metadata: SessionMetadata = {}): Promise<AuthResponse> {
    if (isServerMode() && input.pin) {
      throw new BadRequestException("PIN-вход отключён в серверном режиме — используйте пароль");
    }
    const user = await this.findLoginUser(input);
    const secret = input.pin ?? input.password;
    if (!user || !secret) {
      throw new UnauthorizedException("Неверное имя, пароль или PIN");
    }
    const valid = await argon2.verify(user.passwordHash, secret);
    if (!valid) {
      throw new UnauthorizedException("Неверное имя, пароль или PIN");
    }
    const strength = passwordScore(secret);
    const current =
      strength === user.passwordStrength
        ? user
        : await this.prisma.user.update({ where: { id: user.id }, data: { passwordStrength: strength } });
    return this.issueTokenPair(current, metadata);
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return toSessionUser(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<SessionUser> {
    const email = input.email === undefined ? undefined : normalizeEmail(input.email);
    if (email) {
      const emailOwner = await this.prisma.user.findUnique({ where: { email } });
      if (emailOwner && emailOwner.id !== userId) {
        throw new ConflictException("Пользователь с таким email уже зарегистрирован");
      }
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        ...(input.email !== undefined ? { email } : {})
      }
    });
    return toSessionUser(user);
  }

  async changePassword(userId: string, sessionId: string | undefined, input: ChangePasswordInput): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException("Текущий пароль или PIN указан неверно");
    }
    const nextSecret = input.newPin ?? input.newPassword;
    if (!nextSecret) {
      throw new BadRequestException("Укажите новый пароль или PIN");
    }
    const unlockKind: UnlockKind = input.newPin ? "pin" : "password";
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await argon2.hash(nextSecret),
          unlockKind,
          passwordStrength: passwordScore(nextSecret),
          passwordChangedAt: new Date()
        }
      });
      if (input.revokeOtherSessions) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null, ...(sessionId ? { id: { not: sessionId } } : {}) },
          data: { revokedAt: new Date() }
        });
      }
      return result;
    });
    return toSessionUser(updated);
  }

  async setAvatar(userId: string, file: UploadedAvatar): Promise<SessionUser> {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Выберите изображение");
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException("Аватар не больше 2 МБ");
    }
    if (!AVATAR_MIME.has(file.mimetype)) {
      throw new BadRequestException("Нужен JPEG, PNG, WebP или GIF");
    }
    await this.storage.putFile(avatarKey(userId), file.buffer, { contentType: file.mimetype });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { hasAvatar: true, avatarMime: file.mimetype }
    });
    return toSessionUser(user);
  }

  async removeAvatar(userId: string): Promise<SessionUser> {
    await this.storage.remove(avatarKey(userId));
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { hasAvatar: false, avatarMime: null }
    });
    return toSessionUser(user);
  }

  async openAvatar(userId: string): Promise<{ stream: Awaited<ReturnType<StorageAdapter["getStream"]>>; mime: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.hasAvatar) throw new NotFoundException("Аватар не задан");
    const stream = await this.storage.getStream(avatarKey(userId));
    return { stream, mime: user.avatarMime ?? "image/jpeg" };
  }

  async listSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" }
    });
    return sessions.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const updated = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (updated.count === 0) throw new NotFoundException("Сессия не найдена");
  }

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

    const { id: newId, raw: newRaw } = await this.createRefreshToken(user.id, {
      userAgent: stored.userAgent ?? undefined,
      ipAddress: stored.ipAddress ?? undefined,
      deviceName: stored.deviceName ?? undefined
    });

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: newId }
    });
    if (revoked.count === 0) {
      await this.prisma.refreshToken.update({ where: { id: newId }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Сессия недействительна, войдите заново");
    }

    return this.issueTokenPairFrom(user, newId, newRaw);
  }

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

  private async findLoginUser(input: LoginInput) {
    if (input.userId) {
      return this.prisma.user.findUnique({ where: { id: input.userId } });
    }
    const identifier = input.email?.trim();
    if (!identifier) return null;
    const byEmail = await this.prisma.user.findUnique({ where: { email: identifier } });
    if (byEmail) return byEmail;
    const byName = await this.prisma.user.findMany({ where: { name: identifier }, take: 2 });
    return byName.length === 1 ? byName[0] : null;
  }

  private async issueTokenPair(user: UserLike, metadata: SessionMetadata): Promise<AuthResponse> {
    const { id, raw } = await this.createRefreshToken(user.id, metadata);
    return this.issueTokenPairFrom(user, id, raw);
  }

  private issueTokenPairFrom(user: UserLike, sessionId: string, rawRefreshToken: string): AuthResponse {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email ?? "", sid: sessionId });
    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: toSessionUser(user)
    };
  }

  private async createRefreshToken(userId: string, metadata: SessionMetadata = {}): Promise<{ id: string; raw: string }> {
    const raw = randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt, ...metadata }
    });
    return { id: row.id, raw };
  }
}

function avatarKey(userId: string): string {
  return storageKey("_avatars", userId);
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function toSessionUser(user: UserLike): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    unlockKind: user.unlockKind === "pin" ? "pin" : "password",
    hasAvatar: user.hasAvatar,
    passwordStrength: user.passwordStrength,
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null
  };
}

function passwordScore(password: string): number {
  if (/^\d{4}$/.test(password)) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-zа-я]/.test(password) && /[A-ZА-Я]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^\p{L}\p{N}]/u.test(password)) score += 1;
  return Math.min(4, score);
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
