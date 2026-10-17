import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { CreatedWorkspaceInvite, InviteLookup, InviteRole, WorkspaceInvite } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "./workspaces.service";

const INVITE_TTL_DAYS = 14;

/**
 * Invite-by-email. There is no outbound email integration yet — `create`
 * returns the raw accept link once (same dry-run posture as TelegramService
 * before a bot token is configured), and the owner copies/shares it
 * manually. `accept`/`lookup` run as the system role for the same
 * chicken-and-egg reason as AuthService.register: the invited user has no
 * WorkspaceMember row yet, so the normal membership-based RLS policy can't
 * be satisfied.
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

  async create(userId: string, workspaceId: string, email: string, role: InviteRole = "member"): Promise<CreatedWorkspaceInvite> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.prisma.withUser(userId, async (tx) => {
      const caller = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      // ТЗ-05: роль «лид» назначает только владелец — иначе лид раздавал бы себе подобных (смена роли и так owner-only).
      if (role === "lead" && caller.role !== "owner") {
        throw new ForbiddenException("Приглашать с ролью «лид» может только владелец");
      }
      const existingMember = await tx.workspaceMember.findFirst({
        where: { workspaceId, user: { email: normalizedEmail } }
      });
      if (existingMember) throw new BadRequestException("Этот пользователь уже участник пространства");

      // Просроченное, но так и не принятое приглашение не должно навсегда блокировать новое для того же email.
      await tx.workspaceInvite.updateMany({
        where: { workspaceId, email: normalizedEmail, status: "pending", expiresAt: { lt: new Date() } },
        data: { status: "expired" }
      });
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
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
        }
      });

      // v0.22: query-param link (`/invite?token=`), not a dynamic segment
      // (`/invite/:token`) — the desktop build is `output: "export"`, which
      // needs every dynamic route enumerable at build time via
      // `generateStaticParams`, and invite tokens are minted at runtime and
      // can't be listed. A single static `/invite` page with a client-side
      // token lookup works under static export; a dynamic segment doesn't.
      const acceptUrl = `${webOrigin()}/invite?token=${raw}`;
      // Never log the full URL (bearer token) outside dry-run: this branch
      // only runs because there is no outbound email integration yet, so the
      // link has to leave via *some* visible channel. Once real email
      // delivery exists, this log line goes with it — see class doc comment.
      this.logger.log(`(dry-run invite) → ${normalizedEmail}: workspace ${workspaceId}, invite ${row.id}`);
      return { ...toDto(row), acceptUrl, code: raw };
    });
  }

  async revoke(userId: string, workspaceId: string, inviteId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const result = await tx.workspaceInvite.updateMany({
        where: { id: inviteId, workspaceId, status: "pending" },
        data: { status: "revoked", revokedAt: new Date() }
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
            : invite.expiresAt.getTime() < Date.now()
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
      if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now()) {
        throw new BadRequestException("Приглашение недействительно или истекло");
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
}

/**
 * Адрес, по которому приглашённый откроет ссылку. На хосте LAN (ТЗ-04/05)
 * `ORION_PUBLIC_URL` — адрес узла, видимый из локальной сети; без него — первый
 * из `WEB_ORIGIN` (локальный режим, как раньше).
 */
function webOrigin(): string {
  const publicUrl = process.env.ORION_PUBLIC_URL?.trim();
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  return (process.env.WEB_ORIGIN ?? "http://localhost:3010").split(",")[0]!.trim();
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
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role as WorkspaceInvite["role"],
    status: row.status as WorkspaceInvite["status"],
    invitedById: row.invitedById,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}
