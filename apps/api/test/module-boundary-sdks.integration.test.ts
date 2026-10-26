import { Module, type INestApplicationContext, type ModuleMetadata } from "@nestjs/common";
import { ModulesContainer, NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTaskInputSchema, createNoteInputSchema } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { ProjectTaskLinks } from "../src/projects/public/project-task-links";
import { ProjectCatalogModule } from "../src/projects/public/project-catalog.module";
import { CaptureOperationsModule } from "../src/captures/public/capture-operations.module";
import { SearchOperationsModule } from "../src/search/public/search-operations.module";
import { DocumentAttachmentStoreModule } from "../src/documents/public/document-attachment-store.module";
import { InventoryShoppingCommandsModule } from "../src/inventory/public/inventory-shopping-commands.module";
import { ListShoppingCommandsModule } from "../src/lists/public/list-shopping-commands.module";
import { ListExpenseCommandsModule } from "../src/lists/public/list-expense-commands.module";
import { AgentDraftOperationsModule } from "../src/finance/public/agent-draft-operations.module";
import { EventOperationsModule } from "../src/events/public/event-operations.module";
import { InboxAgentOperationsModule } from "../src/inbox/public/inbox-agent-operations.module";
import { TaskOperations } from "../src/tasks/public/task-operations";
import { NoteOperations } from "../src/notes/public/note-operations";
import { NoteAgentReferences } from "../src/notes/public/note-agent-references";
import { NoteAgentReferencesModule } from "../src/notes/public/note-agent-references.module";
import { GoalTaskReader } from "../src/tasks/public/goal-task-reader";
import { GoalTaskReaderModule } from "../src/tasks/public/goal-task-reader.module";
import { TaskHomeLinks } from "../src/tasks/public/task-home-links";
import { TaskHomeLinksModule } from "../src/tasks/public/task-home-links.module";

const infrastructure = new Set(["ScheduleModule", "PrismaModule", "BackgroundJobsModule", "ProjectAggregateModule",
  "DomainEventsModule", "AuthModule", "WorkspacesModule", "ModulesModule", "PluginsModule", "NotificationsModule", "StorageModule"]);
const appImports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
class SdkHost {}
Module({ imports: [...appImports.filter(entry => {
  const candidate = typeof entry === "function" ? entry : "module" in entry ? entry.module : undefined;
  return candidate && infrastructure.has(candidate.name);
}), ProjectCatalogModule, CaptureOperationsModule, SearchOperationsModule, DocumentAttachmentStoreModule,
InventoryShoppingCommandsModule, ListShoppingCommandsModule, ListExpenseCommandsModule, AgentDraftOperationsModule,
EventOperationsModule, InboxAgentOperationsModule, NoteAgentReferencesModule, GoalTaskReaderModule, TaskHomeLinksModule] })(SdkHost);

describe("module boundary SDK composition (ADR-0034)", () => {
  let app: INestApplicationContext, prisma: PrismaService;
  const fixtures: Array<{ userId: string; workspaceId: string }> = [];
  const prefix = `boundary-sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(SdkHost, { logger: false, abortOnError: false });
    prisma = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    for (let i = 0; i < 2; i++) fixtures.push(await prisma.asSystem(async tx => {
      const user = await tx.user.create({ data: { email: `${prefix}-${i}@example.test`, passwordHash: "fixture-only", name: prefix } });
      const workspace = await tx.workspace.create({ data: { name: `${prefix}-${i}`, disabledModules: [] } });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } });
      return { userId: user.id, workspaceId: workspace.id };
    }));
  });
  afterAll(async () => {
    if (prisma) await prisma.asSystem(async tx => {
      await tx.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await tx.workspace.deleteMany({ where: { name: { startsWith: prefix } } });
    });
    await app?.close();
  });

  it("boots SDKs without domain modules, controllers, registrations or scheduled jobs", () => {
    const modules = [...app.get(ModulesContainer).values()];
    const names = modules.map(module => module.metatype.name);
    for (const name of ["TasksModule", "NotesModule", "ProjectsModule", "EventsModule", "FinanceModule", "ListsModule",
      "InventoryModule", "DocumentsModule", "CapturesModule", "InboxModule", "SearchModule", "HomeModule", "GoalsModule", "TimeModule"])
      expect(names).not.toContain(name);
    const providers = modules.flatMap(module => [...module.providers.values()].map(provider => provider.name));
    for (const name of ["NoteTrashPurgeService", "DocumentTrashPurgeService", "EventReminderService", "ReminderCheckerService",
      "RecurringCheckerService", "CaptureReferenceMoves", "TasksProjectAggregates", "InventoryProjectAggregates"])
      expect(providers).not.toContain(name);
  });

  it("shares uncommitted owner commands and projections, then rolls everything back", async () => {
    const own = fixtures[0];
    await expect(prisma.withUser(own.userId, async tx => {
      const project = await app.get(ProjectTaskLinks).findOrCreateByNameTx(tx, own.workspaceId, "SDK project");
      const task = await app.get(TaskOperations).createTx(tx, own.userId, own.workspaceId,
        createTaskInputSchema.parse({ title: "SDK task", projectId: project.id }));
      expect((await app.get(GoalTaskReader).plansTx(tx, own.workspaceId, [project.id])).map(row => row.id)).toEqual([task.id]);
      const home = await tx.home.create({ data: { workspaceId: own.workspaceId, name: "SDK home" } });
      expect(await app.get(TaskHomeLinks).setHomeTx(tx, own.workspaceId, task.id, home.id)).toBe(1);
      expect((await app.get(TaskHomeLinks).atHomeTx(tx, own.workspaceId, home.id)).map(row => row.id)).toEqual([task.id]);
      const note = await app.get(NoteOperations).createTx(tx, own.userId, own.workspaceId,
        createNoteInputSchema.parse({ title: "Private SDK note", isPrivate: true }));
      expect((await app.get(NoteAgentReferences).snapshotTx(tx, own.workspaceId, note.id))?.title).toBe("Private SDK note");
      throw new Error("rollback SDK commands");
    })).rejects.toThrow("rollback SDK commands");
    expect(await prisma.withUser(own.userId, tx => tx.task.count({ where: { workspaceId: own.workspaceId } }))).toBe(0);
    expect(await prisma.withUser(own.userId, tx => tx.note.count({ where: { workspaceId: own.workspaceId } }))).toBe(0);
  });

  it("keeps RLS and workspace scoping even with membership in both spaces", async () => {
    const [alice, bob] = fixtures;
    const foreign = await prisma.withUser(bob.userId, async tx => {
      const project = await tx.project.create({ data: { workspaceId: bob.workspaceId, name: "Foreign" } });
      const task = await tx.task.create({ data: { workspaceId: bob.workspaceId, projectId: project.id, title: "Foreign" } });
      const note = await app.get(NoteOperations).createTx(tx, bob.userId, bob.workspaceId,
        createNoteInputSchema.parse({ title: "Private foreign", isPrivate: true }));
      return { project, task, note };
    });
    expect(await prisma.withUser(alice.userId, tx => app.get(GoalTaskReader).plansTx(tx, bob.workspaceId, [foreign.project.id]))).toEqual([]);
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: bob.workspaceId, userId: alice.userId, role: "member" } }));
    expect(await prisma.withUser(alice.userId, tx => app.get(GoalTaskReader).plansTx(tx, alice.workspaceId, [foreign.project.id]))).toEqual([]);
    expect(await prisma.withUser(alice.userId, tx => app.get(NoteAgentReferences).snapshotTx(tx, bob.workspaceId, foreign.note.id))).toBeNull();
    expect(await prisma.withUser(alice.userId, tx => app.get(TaskHomeLinks).setHomeTx(tx, alice.workspaceId, foreign.task.id, null))).toBe(0);
  });
});
