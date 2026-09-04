import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Workspace } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true }
    });
    return memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role }));
  }

  /**
   * Membership check done in application code (no Postgres RLS yet — see
   * ORION v0 plan). Every module that scopes data by workspaceId must call
   * this before reading or writing.
   */
  async assertMember(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    if (!membership) {
      throw new ForbiddenException("Нет доступа к этому рабочему пространству");
    }
  }
}
