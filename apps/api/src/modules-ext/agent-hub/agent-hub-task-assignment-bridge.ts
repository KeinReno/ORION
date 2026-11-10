import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskAgentAssignmentRegistry } from "../../tasks/public/task-agent-assignment-registry";

/** Agent Hub contribution to Tasks' public exclusive-assignment bridge. */
@Injectable()
export class AgentHubTaskAssignmentBridge implements OnModuleInit, OnModuleDestroy {
  private readonly owner = "agent-hub";
  constructor(private readonly registry: TaskAgentAssignmentRegistry) {}
  onModuleInit(): void {
    this.registry.register(this.owner, async (tx, ref) => Boolean(await tx.agentHubTaskAssignment.findFirst({
      where: { workspaceId: ref.workspaceId, taskId: ref.taskId }, select: { id: true }
    })));
  }
  onModuleDestroy(): void { this.registry.unregister(this.owner); }

  async assertUnassignedTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<void> {
    const human = await this.registry.lockTaskTx(tx, workspaceId, taskId);
    if (!human) throw new ConflictException("Задача не найдена");
    if (human.assigneeId) throw new ConflictException("Сначала снимите назначение участника команды");
  }
}
