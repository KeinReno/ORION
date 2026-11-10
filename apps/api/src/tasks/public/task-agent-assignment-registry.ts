import { ConflictException, Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export type TaskAgentAssignmentRef = { workspaceId: string; taskId: string };

/** Optional module bridge. The Tasks host asks registered owners before assigning a human member. */
@Injectable()
export class TaskAgentAssignmentRegistry {
  private readonly owners = new Map<string, (tx: Prisma.TransactionClient, ref: TaskAgentAssignmentRef) => Promise<boolean>>();
  register(owner: string, hasAgentAssignment: (tx: Prisma.TransactionClient, ref: TaskAgentAssignmentRef) => Promise<boolean>): void {
    if (this.owners.has(owner)) throw new Error(`Duplicate task-agent-assignment owner: ${owner}`);
    this.owners.set(owner, hasAgentAssignment);
  }
  unregister(owner: string): void { this.owners.delete(owner); }
  async lockTaskTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<{ id: string; assigneeId: string | null } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; assigneeId: string | null }>>`
      SELECT id, "assigneeId" FROM "tasks"
      WHERE id = ${taskId} AND "workspaceId" = ${workspaceId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }
  async assertHumanAssignmentAllowedTx(tx: Prisma.TransactionClient, ref: TaskAgentAssignmentRef): Promise<void> {
    for (const hasAssignment of this.owners.values()) {
      if (await hasAssignment(tx, ref)) throw new ConflictException("Сначала снимите назначение ИИ-агента");
    }
  }
}

@Module({ providers: [TaskAgentAssignmentRegistry], exports: [TaskAgentAssignmentRegistry] })
export class TaskAgentAssignmentRegistryModule {}
