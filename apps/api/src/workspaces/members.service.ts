import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { WorkspaceRole } from "@prisma/client";
import type { AgentMemberEvent, TeamEntry, TeamQuery, WorkspaceMember } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "./workspaces.service";

/** Значение `kind` для человеческого членства: единственное, что отдаёт старый `GET /members`. */
const HUMAN = "human";
/** Значение `kind` для членства агента — ссылка на профиль Agent Hub (задание 12.1). */
const AGENT = "agent";

type MemberRow = Prisma.WorkspaceMemberGetPayload<{
  include: { user: { select: { name: true; email: true; hasAvatar: true } } };
}>;

/**
 * Команда пространства (задание 12): люди и ИИ в одном списке, но с РАЗНЫМИ principal-моделями.
 *
 * - `list` — старый контракт `GET /members`: только живые люди. Он намеренно не изменился, чтобы не
 *   ломать клиентов; добавленные поля `kind`/`status`/`agentProfileId` всегда описывают человека.
 * - `team` — единый список `GET /team`: человеческие членства (active/disabled), непринятые
 *   приглашения (`status = "invited"`) и агентские членства. Приглашения видят только владелец и
 *   лид — ровно как в `GET /invites`.
 * - `remove`/`setRole` — только про людей. Агентское членство управляется подключением профиля
 *   (ADR-0047) и отзывом credential, а не этой ручкой: удаление строки ростера ничего не отключало
 *   бы, поэтому такой вызов честно отклоняется.
 *
 * Важно про права: агент НИКОГДА не получает права человека по `role`. Его вызовы авторизуются
 * scopes токена (ADR-0007) и матрицей разрешений; строка членства нужна для состава команды и для
 * адресации событий (упоминаний), а не как носитель полномочий.
 */
@Injectable()
export class WorkspaceMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** Any member can list co-members — see the workspace_members_visible_rls migration. Humans only. */
  async list(userId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.workspaceMember.findMany({
        where: { workspaceId, kind: HUMAN, userId: { not: null } },
        include: { user: { select: { name: true, email: true, hasAvatar: true } } },
        orderBy: { createdAt: "asc" }
      });
      return rows.map(toDto);
    });
  }

  /**
   * Единый список команды (12.1). Люди и агенты — с `kind` и `status`; приглашённые — со
   * `status = "invited"` и `inviteId` вместо `memberId`. `kind`/`status` фильтруют результат.
   *
   * Видимость: состав команды видят все участники (как и раньше `GET /members`); приглашения —
   * только владелец и лид, потому что это email посторонних людей.
   */
  async team(userId: string, workspaceId: string, query: TeamQuery = {}): Promise<TeamEntry[]> {
    return this.prisma.withUser(userId, async (tx) => {
      const caller = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead", "member"]);
      const maySeeInvites = caller.role === "owner" || caller.role === "lead";
      const rows = await tx.workspaceMember.findMany({
        where: {
          workspaceId,
          ...(query.kind ? { kind: query.kind } : {}),
          // Приглашения отдельная сущность; «invited» к членству не относится, поэтому фильтр по
          // нему отсекает всех участников, но оставляет приглашённых.
          ...(query.status === "invited" ? { id: { in: [] } } : query.status ? { status: query.status } : {})
        },
        include: { user: { select: { name: true, email: true, hasAvatar: true } } },
        orderBy: { createdAt: "asc" }
      });
      const invites =
        maySeeInvites && query.kind !== AGENT && query.status !== "active" && query.status !== "disabled"
          ? await tx.workspaceInvite.findMany({
              where: { workspaceId, status: "pending" },
              orderBy: { createdAt: "desc" }
            })
          : [];

      const entries: TeamEntry[] = [
        ...rows.map(toTeamEntry),
        ...invites.map((invite) => ({
          id: invite.id,
          kind: "human" as const,
          status: "invited" as const,
          role: invite.role,
          memberId: null,
          inviteId: invite.id,
          userId: null,
          agentProfileId: null,
          // У приглашённого ещё нет профиля: показываем email, по которому его ждут.
          name: invite.email,
          email: invite.email,
          hasAvatar: false,
          createdAt: invite.createdAt.toISOString(),
          expiresAt: invite.expiresAt?.toISOString() ?? null,
          invitedById: invite.invitedById,
          revokedById: invite.revokedById,
          resendCount: invite.resendCount
        }))
      ];

      return entries.sort(compareTeamEntries);
    });
  }

  async remove(userId: string, workspaceId: string, memberId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      const caller = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const target = await tx.workspaceMember.findUnique({ where: { id: memberId } });
      if (!target || target.workspaceId !== workspaceId) throw new NotFoundException("Участник не найден");
      if (target.kind === AGENT) {
        // 12.2/ADR-0047: подключение агента — существующий owner-control flow. Удаление строки
        // ростера не отозвало бы ни один credential и создало бы ложное чувство «отключили».
        throw new BadRequestException(
          "Агент управляется подключением профиля: отзовите его credential в настройках ИИ-агентов (ADR-0047), а не удаляйте строку команды"
        );
      }
      if (target.role === "owner") {
        if (caller.role !== "owner") throw new ForbiddenException("Только владелец может убрать владельца");
        const otherOwners = await tx.workspaceMember.count({ where: { workspaceId, role: "owner", id: { not: memberId } } });
        if (otherOwners === 0) throw new BadRequestException("В пространстве должен остаться хотя бы один владелец");
      }
      await tx.workspaceMember.delete({ where: { id: memberId } });
      // ТЗ-05: токен агента — делегированный доступ человека. Ушёл из пространства —
      // его агенты теряют доступ немедленно, а не «до истечения срока».
      if (target.userId) {
        await tx.agentToken.updateMany({
          where: { workspaceId, createdById: target.userId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
    });
  }

  /** Owner-only — a lead cannot promote itself or anyone else to owner/lead. */
  async setRole(userId: string, workspaceId: string, memberId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const target = await tx.workspaceMember.findUnique({
        where: { id: memberId },
        include: { user: { select: { name: true, email: true, hasAvatar: true } } }
      });
      if (!target || target.workspaceId !== workspaceId) throw new NotFoundException("Участник не найден");
      if (target.kind === AGENT) {
        // Роль агента не даёт прав (его права — scopes токена), поэтому «повышать» его нечем.
        throw new BadRequestException("У агентского членства нет ролей: его права определяются scope-ами токена");
      }
      if (target.role === "owner" && role !== "owner") {
        const otherOwners = await tx.workspaceMember.count({ where: { workspaceId, role: "owner", id: { not: memberId } } });
        if (otherOwners === 0) throw new BadRequestException("В пространстве должен остаться хотя бы один владелец");
      }
      const updated = await tx.workspaceMember.update({
        where: { id: memberId },
        data: { role },
        include: { user: { select: { name: true, email: true, hasAvatar: true } } }
      });
      return toDto(updated);
    });
  }

  /**
   * Очередь событий агентского членства (12.3): что агент «получил», пока его никто не слушал.
   * Читают участники пространства; ответ не раскрывает чужих пространств (RLS + проверка членства,
   * плюс memberId обязан принадлежать этому workspace).
   */
  async listAgentEvents(userId: string, workspaceId: string, memberId: string, limit = 100): Promise<AgentMemberEvent[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const member = await tx.workspaceMember.findUnique({ where: { id: memberId }, select: { workspaceId: true, kind: true } });
      if (!member || member.workspaceId !== workspaceId || member.kind !== AGENT) {
        throw new NotFoundException("Агентское членство не найдено");
      }
      const rows = await tx.agentMemberEvent.findMany({
        where: { workspaceId, memberId },
        orderBy: { createdAt: "desc" },
        take: Math.min(Math.max(1, limit), 200)
      });
      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        memberId: row.memberId,
        kind: row.kind,
        title: row.title,
        body: row.body,
        entityType: row.entityType,
        entityId: row.entityId,
        actorUserId: row.actorUserId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString()
      }));
    });
  }
}

function toDto(row: MemberRow): WorkspaceMember {
  return {
    id: row.id,
    // `list()`/`setRole()` отбирают только человеческие членства — у них `userId` всегда есть.
    userId: row.userId ?? "",
    name: row.user?.name ?? "",
    email: row.user?.email ?? null,
    hasAvatar: row.user?.hasAvatar ?? false,
    role: row.role as WorkspaceMember["role"],
    kind: HUMAN,
    status: row.status === "disabled" ? "disabled" : "active",
    agentProfileId: null,
    createdAt: row.createdAt.toISOString()
  };
}

function toTeamEntry(row: MemberRow): TeamEntry {
  const isAgent = row.kind === AGENT;
  return {
    id: row.id,
    kind: isAgent ? AGENT : HUMAN,
    status: row.status === "disabled" ? "disabled" : "active",
    role: row.role,
    memberId: row.id,
    inviteId: null,
    userId: row.userId,
    agentProfileId: row.agentProfileId,
    // У агента нет `User`; снимок имени держит триггер синхронизации с профилем.
    name: isAgent ? row.displayName ?? "Агент" : row.user?.name ?? "",
    email: row.user?.email ?? null,
    hasAvatar: row.user?.hasAvatar ?? false,
    createdAt: row.createdAt.toISOString(),
    expiresAt: null,
    invitedById: null,
    revokedById: null,
    resendCount: 0
  };
}

const STATUS_RANK: Record<TeamEntry["status"], number> = { active: 0, invited: 1, disabled: 2 };
const KIND_RANK: Record<TeamEntry["kind"], number> = { human: 0, agent: 1 };

/** Активные люди → активные агенты → приглашённые → отключённые; внутри — по дате добавления. */
function compareTeamEntries(a: TeamEntry, b: TeamEntry): number {
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.status === "invited") return b.createdAt.localeCompare(a.createdAt);
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind !== 0) return byKind;
  return a.createdAt.localeCompare(b.createdAt);
}
