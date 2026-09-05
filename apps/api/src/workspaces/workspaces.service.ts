import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Workspace } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.withUser(userId, (tx) =>
      tx.workspaceMember.findMany({
        where: { userId },
        include: { workspace: true }
      })
    );
    return memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role }));
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
}
