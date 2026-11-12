import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "./prisma.service";
import type { BackgroundJobsService } from "./background-jobs.service";
import { BackgroundJobRegistry } from "./background-job-registry";
import { BackgroundJobSupervisor } from "./background-job-supervisor";

/** Foundation Core (task 01.3): disabling a module pauses its tick, enabling resumes it. */
function supervisorWith(disabled: () => string[]) {
  const prisma = {
    asSystem: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        workspace: {
          findUnique: async () => ({ disabledModules: disabled(), pluginOverrides: [] })
        }
      })
  } as unknown as PrismaService;
  const jobs = {
    markPaused: vi.fn(),
    runJob: vi.fn(async (_componentId: string, _jobName: string, fn: () => Promise<unknown>) => {
      await fn();
      return true;
    })
  } as unknown as BackgroundJobsService;
  return { supervisor: new BackgroundJobSupervisor(prisma, new BackgroundJobRegistry(), jobs), jobs };
}

describe("BackgroundJobSupervisor", () => {
  it("does not run a workspace job while its module is disabled, and counts the pause", async () => {
    const disabled = ["tasks"];
    const { supervisor, jobs } = supervisorWith(() => disabled);
    const tick = vi.fn(async () => undefined);

    await expect(supervisor.runWorkspaceJob("tasks", "due-tasks", "ws1", tick)).resolves.toBe(false);
    expect(tick).not.toHaveBeenCalled();
    expect(jobs.markPaused).toHaveBeenCalledWith("tasks", "due-tasks");
  });

  it("resumes on the next tick after re-enabling without losing state", async () => {
    let disabled = ["tasks"];
    const { supervisor, jobs } = supervisorWith(() => disabled);
    const tick = vi.fn(async () => undefined);
    await supervisor.runWorkspaceJob("tasks", "due-tasks", "ws1", tick);
    disabled = [];
    await expect(supervisor.runWorkspaceJob("tasks", "due-tasks", "ws1", tick)).resolves.toBe(true);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(jobs.runJob).toHaveBeenCalledTimes(1);
  });

  it("always runs core infrastructure jobs (no module gate)", async () => {
    const disabled = ["tasks"];
    const { supervisor, jobs } = supervisorWith(() => disabled);
    await expect(supervisor.runWorkspaceJob("core", "domain-events-dispatch", "ws1", async () => undefined)).resolves.toBe(true);
    expect(jobs.runJob).toHaveBeenCalledTimes(1);
  });

  it("keeps the declarative catalog free of duplicate keys", () => {
    const registry = new BackgroundJobRegistry();
    const keys = registry.list().map((definition) => `${definition.componentId}/${definition.jobName}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("core/domain-events-dispatch");
  });
});
