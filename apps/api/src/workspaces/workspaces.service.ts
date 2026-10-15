import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma, WorkspaceMember, WorkspaceRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { Workspace, WorkspaceMemberSearchResult, WorkspaceTemplate } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { seedSoloDeveloperWorkspace } from "./workspace-seed";

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
  ) {}

  /** `createdAt asc` so a newly created workspace (e.g. a "Демо" space) lands after the user's original one, not before it. */
  async listForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.withUser(userId, (tx) =>
      tx.workspaceMember.findMany({
        where: { userId },
        include: { workspace: true },
        orderBy: { workspace: { createdAt: "asc" } }
      })
    );
    return memberships.map((m) => toWorkspaceDto(m.workspace, m.role));
  }

  /**
   * A second (or third...) workspace for an already-registered user — same
   * chicken-and-egg problem as `AuthService.register` (the workspaces RLS
   * policy checks for an existing membership row, which can't exist yet at
   * creation time), same fix: `asSystem`. Added in v0.13 to give a "Демо"
   * space kept apart from real data — not a general sharing/invite feature.
   */
  async createForUser(userId: string, name: string, template?: WorkspaceTemplate): Promise<Workspace> {
    const workspace = await this.prisma.asSystem(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name,
          icsToken: randomBytes(24).toString("base64url"),
          // Solo-dev kernel: money/stock stay in the catalog but out of the way.
          disabledModules: disabledModulesFor(template)
        }
      });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role: "owner" } });
      if (template === "solo-dev") {
        await seedSoloDeveloperWorkspace(tx, workspace.id);
      }
      return workspace;
    });
    return toWorkspaceDto(workspace, "owner");
  }

  /** Rename — owner-only, same role gate as the modules/plugins/members toggles. */
  async updateName(userId: string, workspaceId: string, name: string): Promise<Workspace> {
    return this.prisma.withUser(userId, async (tx) => {
      const membership = await this.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const workspace = await tx.workspace.update({ where: { id: workspaceId }, data: { name } });
      return toWorkspaceDto(workspace, membership.role);
    });
  }

  /**
   * Deleting a workspace cascades through every workspace-scoped table at
   * the database level (`onDelete: Cascade` in schema.prisma) — rows that
   * belong to *other* members, not just the owner issuing the request. That
   * is exactly the kind of cross-workspace-boundary write `orion_app`'s RLS
   * policies are designed to refuse, so — like `AuthService.register`'s
   * chicken-and-egg bootstrap — the actual delete runs under `asSystem`, a
   * deliberate, audited bypass. The owner-role check and the "not your only
   * workspace" guard run first, under the caller's own `withUser` session,
   * so reaching the asSystem branch already proves both.
   */
  async deleteForUser(userId: string, workspaceId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const ownWorkspaceCount = await tx.workspaceMember.count({ where: { userId } });
      if (ownWorkspaceCount <= 1) {
        throw new ForbiddenException("Нельзя удалить единственное рабочее пространство");
      }
    });
    await this.prisma.asSystem((tx) => tx.workspace.delete({ where: { id: workspaceId } }));
    try {
      await this.storage.remove(workspaceId);
    } catch (error) {
      // Rows are already gone — a leftover directory on disk is a cleanup
      // nuisance, not a reason to report the deletion as failed.
      this.logger.warn(`Не удалось удалить файлы пространства ${workspaceId} из хранилища: ${String(error)}`);
    }
  }

  /**
   * U09 (27-U09-THREAT-MODEL.md, раздел 6 "указал получателя") — the source
   * for the grant-issue picker. Deliberately NOT a global "search all ORION
   * users by email" endpoint: a grant is issued by an owner to someone they
   * already know, and the realistic source for "someone I know" is "already
   * a member of a workspace I own" — global user search is a separate,
   * unaddressed security question this slice doesn't take on. Owner-only
   * (same gate `create()` on `SharedGrantsService` requires) — a `member`
   * has no reason to browse this workspace's roster to grant access they
   * can't issue anyway.
   */
  async searchMembers(userId: string, workspaceId: string, query: string): Promise<WorkspaceMemberSearchResult[]> {
    const trimmed = query.trim();
    const rows = await this.prisma.withUser(userId, async (tx) => {
      // Роль проверяется до любых ранних выходов: посторонний не должен получать 200 даже на пустой запрос (ТЗ-05).
      await this.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      if (trimmed.length < 2) return [];
      return tx.workspaceMember.findMany({
        where: {
          workspaceId,
          userId: { not: userId },
          user: {
            OR: [
              { email: { contains: trimmed, mode: "insensitive" } },
              { name: { contains: trimmed, mode: "insensitive" } }
            ]
          }
        },
        include: { user: { select: { id: true, email: true, name: true } } },
        take: 20
      });
    });
    return rows.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name }));
  }

  /**
   * Application-level check with a clear 403 — kept alongside Postgres RLS
   * (see ORION v0.2 plan), not replaced by it. RLS on its own would just
   * make a mismatched workspaceId look like an empty result, which is a
   * worse error experience than an explicit "no access". Opens its own
   * transaction — use assertMemberTx instead when you already have one
   * (e.g. to check membership and do the actual read/write in one round trip).
   */
  async assertMember(userId: string, workspaceId: string): Promise<void> {
    await this.prisma.withUser(userId, (tx) => this.assertMemberTx(tx, userId, workspaceId));
  }

  /** Same check as assertMember, but runs inside a transaction the caller already holds. */
  async assertMemberTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    const membership = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    if (!membership) {
      throw new ForbiddenException("Нет доступа к этому рабочему пространству");
    }
  }

  /**
   * Membership check *and* role gate in one round trip — additive to
   * assertMemberTx, not a replacement: every other module keeps using the
   * existence-only check unchanged. Only the workspace-invites/members
   * endpoints and task assignment (the "Команда" plugin's surface) call this.
   */
  async assertMemberRoleTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    allowed: readonly WorkspaceRole[]
  ): Promise<WorkspaceMember> {
    const membership = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    if (!membership) {
      throw new ForbiddenException("Нет доступа к этому рабочему пространству");
    }
    if (!allowed.includes(membership.role)) {
      throw new ForbiddenException("Недостаточно прав для этого действия");
    }
    return membership;
  }
}

/**
 * Стартовый набор выключенных модулей по шаблону. «Дом» (ТЗ-05) — общее
 * пространство семьи: списки, задачи, календарь, дом/коммуналка, склад, контакты,
 * документы; финансы выключены (включаются в Настройки → Модули), здоровье — личное
 * дело человека (ADR-0012) и тоже выключено. Выключение не удаляет данных.
 */
function disabledModulesFor(template?: WorkspaceTemplate): string[] {
  if (template === "solo-dev") return ["finance", "inventory", "markets", "health"];
  if (template === "home") return ["finance", "markets", "health", "projects", "time", "habits", "opportunities", "notes"];
  return ["markets", "health"];
}

function toWorkspaceDto(
  workspace: {
    id: string;
    name: string;
    disabledModules: string[];
    pluginOverrides: string[];
    restrictedModules: string[];
    isPersonal: boolean;
  },
  role: Workspace["role"]
): Workspace {
  return {
    id: workspace.id,
    name: workspace.name,
    role,
    disabledModules: workspace.disabledModules,
    pluginOverrides: workspace.pluginOverrides,
    restrictedModules: workspace.restrictedModules,
    isPersonal: workspace.isPersonal
  };
}
