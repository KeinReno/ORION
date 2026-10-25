import { Injectable, type OnModuleInit } from "@nestjs/common";
import { isModuleEnabled } from "@orion/shared-types";
import { TaskClosureRegistry } from "../tasks/public/task-closure-registry";

/** Time owns the timer consequence of a task closure, in the task's transaction.
 * Kept in a .service.ts file so the architecture checker covers its model access. */
@Injectable()
export class TimeTaskClosureBridge implements OnModuleInit {
  constructor(private readonly closures: TaskClosureRegistry) {}

  onModuleInit(): void {
    this.closures.register("time", async (tx, { workspaceId, taskId }) => {
      const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { disabledModules: true } });
      if (!workspace || !isModuleEnabled(workspace.disabledModules, "time")) return;
      // Preserve the existing first-running-entry behavior; this extraction does
      // not change the policy for multiple team members timing the same task.
      const running = await tx.timeEntry.findFirst({ where: { workspaceId, taskId, endedAt: null } });
      if (!running) return;
      const endedAt = new Date();
      const safeEnd = endedAt.getTime() <= running.startedAt.getTime()
        ? new Date(running.startedAt.getTime() + 1000)
        : endedAt;
      await tx.timeEntry.update({ where: { id: running.id, workspaceId }, data: { endedAt: safeEnd } });
    });
  }
}
