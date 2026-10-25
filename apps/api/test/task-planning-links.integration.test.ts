import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectTaskLinks } from "../src/projects/public/project-task-links";
import { MilestoneReferences } from "../src/milestones/public/milestone-references";
import { MilestonesService } from "../src/milestones/milestones.service";

const hostModules = new Set(["ScheduleModule", "PrismaModule", "BackgroundJobsModule", "ProjectAggregateModule",
  "AuthModule", "WorkspacesModule", "ModulesModule", "PluginsModule", "StorageModule", "TasksModule", "DomainEventsModule"]);
const appImports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
class TaskHost {}
Module({ imports: appImports.filter(entry => {
  const candidate = typeof entry === "function" ? entry : "module" in entry ? entry.module : undefined;
  return candidate && hostModules.has(candidate.name);
}) })(TaskHost);
type Session = { accessToken: string; user: { id: string }; workspaceId: string };
type Row = { id: string; projectId: string | null; note: string };
describe("Task planning links (ADR-0032)", () => {
  let app: INestApplication, prisma: PrismaService, origin: string;
  const prefix = `task-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let serial = 0;
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false }); configureApp(app);
    await app.listen(0, "127.0.0.1"); origin = address(app); prisma = app.get(PrismaService);
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
  });
  afterAll(async () => {
    if (prisma) await prisma.asSystem(async tx => {
      const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
      const ids = users.map(user => user.id);
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: memberships.map(m => m.workspaceId) } } });
    });
    await app?.close();
  });
  const base = (s: Session) => `/workspaces/${s.workspaceId}`;
  async function request<T = Row>(s: Session | undefined, path: string, method = "GET", body?: unknown, host = origin) {
    const response = await fetch(`${host}${path}`, { method, headers: { "Content-Type": "application/json",
      ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
  async function register(): Promise<Session> {
    const result = await request<Omit<Session, "workspaceId">>(undefined, "/auth/register", "POST",
      { email: `${prefix}-${++serial}@example.test`, name: "Task planning", password: "integration-password-123" });
    expect(result.status).toBe(201);
    const spaces = await request<Array<{ id: string }>>(result.data as Session, "/workspaces/me");
    const s = { ...result.data, workspaceId: spaces.data[0].id };
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: s.workspaceId }, data: { disabledModules: [] } }));
    return s;
  }
  async function project(s: Session, currency = "RUB") {
    const result = await request(s, `${base(s)}/projects`, "POST", { name: `Project ${++serial}`, currency });
    expect(result.status).toBe(201); return result.data.id;
  }
  async function milestone(s: Session, projectId: string) {
    const result = await request(s, base(s) + "/milestones", "POST", { projectId, title: "Phase" });
    expect(result.status).toBe(201); return result.data.id;
  }
  it("creates/reuses names without case sensitivity, preserves id priority, updates and null", async () => {
    const alice = await register(), path = base(alice) + "/tasks";
    const first = await request<{id:string; projectId:string; projectTag:string}>(alice, path, "POST", {title:"One", projectTag:"  Plan Alpha  "});
    expect(first.status).toBe(201); expect(first.data.projectTag).toBe("Plan Alpha");
    const second = await request(alice, path, "POST", {title:"Two", projectTag:"plan alpha"});
    expect(second.data.projectId).toBe(first.data.projectId);
    const explicit = await request(alice, path, "POST", {title:"Explicit", projectId:first.data.projectId, projectTag:"Must not create"});
    expect(explicit.data.projectId).toBe(first.data.projectId);
    const projects = await prisma.withUser(alice.user.id, tx=>tx.project.findMany({where:{workspaceId:alice.workspaceId}}));
    expect(projects).toHaveLength(1);
    const updated = await request<{projectTag:string}>(alice, path + "/" + first.data.id, "PATCH", {projectTag:"Beta"});
    expect(updated.status).toBe(200); expect(updated.data.projectTag).toBe("Beta");
    const cleared = await request(alice, path + "/" + first.data.id, "PATCH", {projectId:null, projectTag:null});
    expect(cleared.data.projectId).toBeNull();
  });
  it("rolls back project creation when the task command fails", async () => {
    const alice=await register(), own=await project(alice), phase=await milestone(alice,own);
    const before=await prisma.withUser(alice.user.id,tx=>tx.project.count({where:{workspaceId:alice.workspaceId}}));
    expect((await request(alice,base(alice)+"/tasks","POST",{title:"Denied",projectTag:"Rolled back",milestoneId:phase})).status).toBe(400);
    expect(await prisma.withUser(alice.user.id,tx=>tx.project.count({where:{workspaceId:alice.workspaceId}}))).toBe(before);
    expect(await prisma.withUser(alice.user.id,tx=>tx.task.count({where:{workspaceId:alice.workspaceId}}))).toBe(0);
  });
  it("rejects foreign/missing projects and phases even when both workspaces are readable", async()=>{
    const alice=await register(), bob=await register(), own=await project(alice), other=await project(alice), foreign=await project(bob);
    const phase=await milestone(alice,own), wrong=await milestone(alice,other), outside=await milestone(bob,foreign);
    await prisma.asSystem(tx=>tx.workspaceMember.create({data:{workspaceId:bob.workspaceId,userId:alice.user.id,role:"member"}}));
    const path=base(alice)+"/tasks";
    for(const projectId of [foreign,"missing"]) expect((await request(alice,path,"POST",{title:"Denied",projectId})).status).toBe(404);
    for(const milestoneId of [outside,"missing"]) expect((await request(alice,path,"POST",{title:"Denied",projectId:own,milestoneId})).status).toBe(404);
    expect((await request(alice,path,"POST",{title:"Denied",projectId:own,milestoneId:wrong})).status).toBe(400);
    const valid=await request(alice,path,"POST",{title:"Keep",projectId:own,milestoneId:phase});expect(valid.status).toBe(201);
    expect((await request(alice,path+"/"+valid.data.id,"PATCH",{title:"Lose",milestoneId:wrong})).status).toBe(400);
    const row=await prisma.withUser(alice.user.id,tx=>tx.task.findUniqueOrThrow({where:{id:valid.data.id}}));
    expect(row).toMatchObject({title:"Keep",projectId:own,milestoneId:phase});
  });
  it("preserves RLS and uncommitted project/phase visibility with rollback", async()=>{
    const alice=await register(), outsider=await register(), links=app.get(ProjectTaskLinks), phases=app.get(MilestoneReferences);
    let id="", phaseId="";
    await expect(prisma.withUser(alice.user.id,async tx=>{
      const row=await links.findOrCreateByNameTx(tx,alice.workspaceId,"Transient"); id=row.id;
      expect(await links.byIdTx(tx,alice.workspaceId,id)).toEqual(row);expect(await links.byIdTx(tx,outsider.workspaceId,id)).toBeNull();
      const phase=await tx.milestone.create({data:{workspaceId:alice.workspaceId,projectId:id,title:"Transient"}});phaseId=phase.id;
      expect(await phases.findTx(tx,alice.workspaceId,phaseId)).toEqual({projectId:id});
      expect(await phases.findTx(tx,outsider.workspaceId,phaseId)).toBeNull();throw new Error("planning rollback");
    })).rejects.toThrow("planning rollback");
    expect(await prisma.withUser(alice.user.id,tx=>links.byIdTx(tx,alice.workspaceId,id))).toBeNull();
    const own=await project(alice), phase=await milestone(alice,own);
    expect(await prisma.withUser(outsider.user.id,tx=>links.byIdTx(tx,alice.workspaceId,own))).toBeNull();
    expect(await prisma.withUser(outsider.user.id,tx=>phases.findTx(tx,alice.workspaceId,phase))).toBeNull();
  });
  it("keeps archived/disabled-neighbor reference policy and authorizes before SDKs", async()=>{
    const alice=await register(), outsider=await register(), own=await project(alice), phase=await milestone(alice,own);
    const spy=vi.spyOn(app.get(ProjectTaskLinks),"byIdTx"), phaseSpy=vi.spyOn(app.get(MilestoneReferences),"findTx");
    try {
      expect((await request(outsider,base(alice)+"/tasks","POST",{title:"Denied",projectId:own,milestoneId:phase})).status).toBe(403);
      expect(spy).not.toHaveBeenCalled();expect(phaseSpy).not.toHaveBeenCalled();
    }finally{spy.mockRestore();phaseSpy.mockRestore();}
    expect((await request(alice,base(alice)+"/projects/"+own,"DELETE")).status).toBe(200);
    expect((await request(alice,base(alice)+"/modules/projects","PATCH",{enabled:false,confirm:true})).status).toBe(200);
    expect((await request(alice,base(alice)+"/tasks","POST",{title:"Kept",projectId:own,milestoneId:phase})).status).toBe(201);
    expect((await request(alice,base(alice)+"/tasks","POST",{title:"Standalone"})).status).toBe(201);
  });
  it("Tasks runs without full ProjectsModule and MilestonesModule", async()=>{
    const alice=await register(), own=await project(alice), phase=await milestone(alice,own);
    const host=await NestFactory.create(TaskHost,{logger:false,abortOnError:false});
    try{configureApp(host);await host.listen(0,"127.0.0.1");for(const job of host.get(SchedulerRegistry).getCronJobs().values())job.stop();
      expect(()=>host.get(ProjectsService)).toThrow();expect(()=>host.get(MilestonesService)).toThrow();
      const result=await request(alice,base(alice)+"/tasks","POST",{title:"SDK host",projectId:own,milestoneId:phase},address(host));
      expect(result.status).toBe(201);expect(result.data.projectId).toBe(own);
    }finally{await host.close();}
  });
});
function address(app:INestApplication){return "http://127.0.0.1:"+(app.getHttpServer().address() as {port:number}).port;}
