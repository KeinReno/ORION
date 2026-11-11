import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type { CreatedWorkspaceInvite, InviteLookup, InviteRole, WorkspaceInvite } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "./workspaces.service";

/**
 * Сколько дней живёт приглашение, если срок не выбран явно (12.2). 14 дней были историческим
 * значением; теперь это ЯВНЫЙ дефолт запроса, а `null` — осознанное «бессрочно», как у agent-аренды.
 */
const DEFAULT_INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Invite-by-email. There is no outbound email integration yet — `create`/`resend` return the raw
 * accept link once (same dry-run posture as TelegramService before a bot token is configured), and
 * the owner copies/shares it manually. `accept`/`lookup` run as the system role for the same
 * chicken-and-egg reason as AuthService.register: the invited user has no WorkspaceMember row yet,
 * so the normal membership-based RLS policy can't be satisfied.
 *
 * 12.2 (задание «Команда и права»): срок выбирает владелец (`expiresInDays`; null = бессрочно),
 * отзыв до принятия пишет `revokedById`, повторная отправка переиздаёт ссылку и перезапускает срок,
 * оставляя ту же строку приглашения (email и роль не меняются, история — в `resendCount`/`resentAt`).
 */
@Injectable()
export class WorkspaceInvitesService {
  private readonly logger = new Logger(WorkspaceInvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<WorkspaceInvite[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const rows = await tx.workspaceInvite.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
      return rows.map(toDto);
    });
  }

  async create(
    userId: string,
    workspaceId: string,
    email: string,
    role: InviteRole = "member",
    expiresInDays: number | null | undefined = DEFAULT_INVITE_TTL_DAYS
  ): Promise<CreatedWorkspaceInvite> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.prisma.withUser(userId, async (tx) => {
      const caller = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      // ТЗ-05: роль «лид» назначает только владелец — иначе лид раздавал бы себе подобных (смена роли и так owner-only).
      if (role === "lead" && caller.role !== "owner") {
        throw new ForbiddenException("Приглашать с ролью «лид» может только владелец");
      }
      const existingMember = await tx.workspaceMember.findFirst({
        where: { workspaceId, kind: "human", user: { email: normalizedEmail } }
      });
      if (existingMember) throw new BadRequestException("Этот пользователь уже участник пространства");

      // Просроченное, но так и не принятое приглашение не должно навсегда блокировать новое для того же email.
      await this.expireStaleTx(tx, workspaceId, normalizedEmail);
      const pending = await tx.workspaceInvite.findFirst({
        where: { workspaceId, email: normalizedEmail, status: "pending" }
      });
      if (pending) throw new BadRequestException("Приглашение для этого email уже отправлено");

      const raw = randomBytes(24).toString("base64url");
      const row = await tx.workspaceInvite.create({
        data: {
          workspaceId,
          email: normalizedEmail,
          tokenHash: hashToken(raw),
          role,
          invitedById: userId,
          expiresAt: expiry(expiresInDays)
        }
      });

      this.logger.log(`(dry-run invite) → ${normalizedEmail}: workspace ${workspaceId}, invite ${row.id}`);
      return { ...toDto(row), acceptUrl: acceptUrl(raw), code: raw };
    });
  }

  /**
   * Повторная отправка (12.2): та же строка приглашения, но новый токен — прежняя ссылка перестаёт
   * работать. Срок перезапускается от текущего момента (или становится бессрочным). Повторять можно и
   * просроченное приглашение: оно снова становится `pending`.
   */
  async resend(
    userId: string,
    workspaceId: string,
    inviteId: string,
    expiresInDays: number | null | undefined = DEFAULT_INVITE_TTL_DAYS
  ): Promise<CreatedWorkspaceInvite> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const invite = await tx.workspaceInvite.findUnique({ where: { id: inviteId } });
      if (!invite || invite.workspaceId !== workspaceId) throw new NotFoundException("Приглашение не найдено");
      if (invite.status === "accepted") throw new ConflictException("Приглашение уже принято — повторять нечего");
      if (invite.status === "revoked") throw new ConflictException("Приглашение отозвано — выпишите новое");

      const raw = randomBytes(24).toString("base64url");
      const row = await tx.workspaceInvite.update({
        where: { id: inviteId },
        data: {
          tokenHash: hashToken(raw),
          status: "pending",
          expiresAt: expiry(expiresInDays),
          resentAt: new Date(),
          resentById: userId,
          resendCount: { increment: 1 }
        }
      });
      this.logger.log(`(dry-run invite resend) → ${row.email}: workspace ${workspaceId}, invite ${row.id} #${row.resendCount}`);
      return { ...toDto(row), acceptUrl: acceptUrl(raw), code: raw };
    });
  }

  async revoke(userId: string, workspaceId: string, inviteId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const result = await tx.workspaceInvite.updateMany({
        where: { id: inviteId, workspaceId, status: "pending" },
        // revokedById — аудит (12.2): кто именно отозвал, а не только когда.
        data: { status: "revoked", revokedAt: new Date(), revokedById: userId }
      });
      if (!result.count) throw new NotFoundException("Приглашение не найдено");
    });
  }

  async lookup(rawToken: string): Promise<InviteLookup> {
    const tokenHash = hashToken(rawToken);
    return this.prisma.asSystem(async (tx) => {
      const invite = await tx.workspaceInvite.findUnique({
        where: { tokenHash },
        include: { workspace: { select: { name: true } }, invitedBy: { select: { name: true } } }
      });
      if (!invite) throw new NotFoundException("Приглашение не найдено");
      const status: InviteLookup["status"] =
        invite.status === "accepted"
          ? "used"
          : invite.status === "revoked"
            ? "revoked"
            : invite.expiresAt !== null && invite.expiresAt.getTime() < Date.now()
              ? "expired"
              : "pending";
      return {
        workspaceName: invite.workspace.name,
        inviterName: invite.invitedBy.name,
        email: invite.email,
        status
      };
    });
  }

  async accept(userId: string, userEmail: string, rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.asSystem(async (tx) => {
      const invite = await tx.workspaceInvite.findUnique({ where: { tokenHash } });
      if (!invite) throw new NotFoundException("Приглашение не найдено");
      // 12.2: причина отказа должна быть видна. 410 — срок вышел (ссылка была действительной),
      // 409 — отозвано/уже принято, 403 — чужой email.
      if (invite.status === "revoked") throw new ConflictException("Приглашение отозвано");
      if (invite.status === "accepted") throw new ConflictException("Приглашение уже принято");
      if (invite.expiresAt !== null && invite.expiresAt.getTime() < Date.now()) {
        await tx.workspaceInvite.update({ where: { id: invite.id }, data: { status: "expired" } });
        throw new GoneException("Срок приглашения истёк — попросите владельца выписать новое");
      }
      if (!userEmail) {
        throw new ForbiddenException("Добавьте email в учётную запись, чтобы принять приглашение");
      }
      if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new ForbiddenException("Это приглашение выписано на другой email");
      }
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
        create: { workspaceId: invite.workspaceId, userId, role: invite.role },
        update: {}
      });
      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: "accepted", acceptedAt: new Date() }
      });
    });
  }

  /** Помечает просроченные pending-строки `expired`, чтобы они не блокировали новое приглашение. */
  private async expireStaleTx(tx: Prisma.TransactionClient, workspaceId: string, email: string): Promise<void> {
    await tx.workspaceInvite.updateMany({
      where: { workspaceId, email, status: "pending", expiresAt: { lt: new Date() } },
      data: { status: "expired" }
    });
  }
}

/** `null` — бессрочно; число дней — срок от текущего момента. */
function expiry(days: number | null | undefined): Date | null {
  if (days === null) return null;
  const value = days ?? DEFAULT_INVITE_TTL_DAYS;
  return new Date(Date.now() + value * DAY_MS);
}

/**
 * Адрес, по которому приглашённый откроет ссылку. На хосте LAN (ТЗ-04/05)
 * `ORION_PUBLIC_URL` — адрес узла, видимый из локальной сети; без него — первый
 * из `WEB_ORIGIN` (локальный режим, как раньше).
 */
function acceptUrl(raw: string): string {
  const publicUrl = process.env.ORION_PUBLIC_URL?.trim();
  if (publicUrl) return `${publicUrl.replace(/\/+$/, "")}/invite?token=${raw}`;
  return `${(process.env.WEB_ORIGIN ?? "http://localhost:3010").split(",")[0]!.trim()}/invite?token=${raw}`;
}

/** sha256 is enough — the raw token is 24 random bytes of full entropy, not a password (same reasoning as AuthService's refresh-token hash). */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function toDto(row: {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  status: string;
  invitedById: string;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  revokedById?: string | null;
  resentAt?: Date | null;
  resentById?: string | null;
  resendCount?: number;
  createdAt: Date;
}): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role as WorkspaceInvite["role"],
    status: row.status as WorkspaceInvite["status"],
    invitedById: row.invitedById,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedById: row.revokedById ?? null,
    resentAt: row.resentAt?.toISOString() ?? null,
    resentById: row.resentById ?? null,
    resendCount: row.resendCount ?? 0,
    createdAt: row.createdAt.toISOString()
  };
}
