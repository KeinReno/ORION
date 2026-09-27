import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";
import type { WorkspaceMember } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "./workspaces.service";

@Injectable()
export class WorkspaceMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** Any member can list co-members — see the workspace_members_visible_rls migration. */
  async list(userId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: { select: { name: true, email: true, hasAvatar: true } } },
        orderBy: { createdAt: "asc" }
      });
      return rows.map(toDto);
    });
  }

  async remove(userId: string, workspaceId: string, memberId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      const caller = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const target = await tx.workspaceMember.findUnique({ where: { id: memberId } });
      if (!target || target.workspaceId !== workspaceId) throw new NotFoundException("Участник не найден");
      if (target.role === "owner") {
        if (caller.role !== "owner") throw new ForbiddenException("Только владелец может убрать владельца");
        const otherOwners = await tx.workspaceMember.count({ where: { workspaceId, role: "owner", id: { not: memberId } } });
        if (otherOwners === 0) throw new BadRequestException("В пространстве должен остаться хотя бы один владелец");
      }
      await tx.workspaceMember.delete({ where: { id: memberId } });
    });
  }

  /** Owner-only — a lead cannot promote itself or anyone else to owner/lead. */
  async setRole(userId: string, workspaceId: string, memberId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const target = await tx.workspaceMember.findUnique({ where: { id: memberId } });
      if (!target || target.workspaceId !== workspaceId) throw new NotFoundException("Участник не найден");
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
}

function toDto(row: {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: { name: string; email: string | null; hasAvatar: boolean };
}): WorkspaceMember {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    hasAvatar: row.user.hasAvatar,
    role: row.role as WorkspaceMember["role"],
    createdAt: row.createdAt.toISOString()
  };
}
