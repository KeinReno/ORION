import { Injectable, Logger } from "@nestjs/common";
import { isComponentEnabled } from "../domain-events/delivery-policy";
import { BackgroundJobRegistry } from "./background-job-registry";
import { BackgroundJobsService } from "./background-jobs.service";
import { PrismaService } from "./prisma.service";

/**
 * Foundation Core (task 01.3): the lifecycle gate for background work, workspace by workspace.
 *
 * Module enablement is per workspace, while a @Cron runs once for the whole process. A job that
 * has a workspace scope therefore asks this supervisor before doing that workspace's work; a
 * disabled component is a pause (not a delete), and re-enabling resumes on the next tick. `core`
 * infrastructure jobs are always enabled.
 */
@Injectable()
export class BackgroundJobSupervisor {
  private readonly logger = new Logger(BackgroundJobSupervisor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BackgroundJobRegistry,
    private readonly jobs: BackgroundJobsService
  ) {}

  definitions() {
    return this.registry.list();
  }

  /** Same component gate the outbox dispatcher uses: module not in disabledModules, plugin = enabled + host enabled. */
  async isEnabledForWorkspace(componentId: string, workspaceId: string): Promise<boolean> {
    if (componentId === "core") return true;
    const workspace = await this.prisma.asSystem((tx) =>
      tx.workspace.findUnique({ where: { id: workspaceId }, select: { disabledModules: true, pluginOverrides: true } })
    );
    return !!workspace && isComponentEnabled(componentId, workspace);
  }

  /**
   * Run one workspace unit of a background job. Returns false when the component is disabled in
   * that workspace; the attempt is counted as `paused` so `GET system/jobs` shows the gate working.
   */
  async runWorkspaceJob(componentId: string, jobName: string, workspaceId: string, fn: () => Promise<unknown>): Promise<boolean> {
    if (!(await this.isEnabledForWorkspace(componentId, workspaceId))) {
      this.jobs.markPaused(componentId, jobName);
      this.logger.debug(`${componentId}/${jobName}: компонент выключен в пространстве ${workspaceId}, запуск пропущен`);
      return false;
    }
    return this.jobs.runJob(componentId, jobName, fn);
  }
}
