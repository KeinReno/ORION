import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type AgentHubContextResponse, type AgentHubDelegationPolicy, type AgentHubDelegationResult,
  type AgentHubExecution, type AgentMemoryRecord, type AgentHubReassignResult,
  type AgentHubTraceResponse, type AgentHubTraceStep
} from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";

/** Task 09: delegation, approval gate, trace tree and versioned agent memory on real PostgreSQL/RLS. */
describe("Agent Hub 2.0: orchestration, trace and memory", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let origin: string;
  const prefix = `agenthub2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let seq = 0;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) await prisma.asSystem(async tx => {
      const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
      const ids = users.map(user => user.id);
      if (!ids.length) return;
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      const workspaceIds = [...new Set(memberships.map(member => member.workspaceId))];
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      expect(await tx.agentHubExecution.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
      expect(await tx.agentHubTraceStep.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
      expect(await tx.agentMemoryRecord.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
    });
    await app?.close();
  });

  async function request<T = unknown>(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(origin + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup() {
    const email = `${prefix}-${seq++}@example.test`;
    const auth = await request<{ accessToken: string; user: { id: string } }>("POST", "/auth/register", undefined, {
      email, name: "Р’Р»Р°РґРµР»РµС†", password: "integration-password-123"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const ws = (await request<Array<{ id: string }>>("GET", "/workspaces/me", token)).data[0]!.id;
    const human = <T = unknown>(method: string, path: string, body?: unknown) =>
      request<T>(method, `/workspaces/${ws}${path}`, token, body);
    const task = await human<{ id: string }>("POST", "/tasks", { title: "РСЃРїРѕР»РЅРёС‚СЊ РїРѕРґРїРѕСЂСѓС‡РµРЅРёРµ" });
    expect(task.status).toBe(201);
    expect((await human("PATCH", "/modules/agent-hub", { enabled: true, confirm: true })).status).toBe(200);
    const issue = async (name: string) => {
      const created = await human<{ id: string; secret: string }>("POST", "/agent-tokens", {
        name, mode: "manager", expiresInDays: 7, scopes: ["tasks:read"],
        modulePermissions: [
          "agent-hub.execution.read", "agent-hub.execution.create",
          "agent-hub.memory.read", "agent-hub.memory.create"
        ]
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      return {
        ...created.data,
        call: <T = unknown>(method: string, path: string, body?: unknown) =>
          request<T>(method, `/ai/v1/agent-hub${path}`, created.data.secret, body)
      };
    };
    const profile = async (name: string, credentialId: string) => {
      const created = await human<{ id: string; name: string }>("POST", "/agent-hub/agents", {
        name, credentialIds: [credentialId]
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      return created.data;
    };
    const createTask = async (title: string) => {
      const created = await human<{ id: string }>("POST", "/tasks", { title });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      return created.data.id;
    };
    const createRun = async (taskId: string = task.data.id) => {
      const run = await human<AgentHubExecution>("POST", "/agent-hub/executions", { taskId });
      expect(run.status, JSON.stringify(run.data)).toBe(201);
      return run.data;
    };
    const start = async (worker: Awaited<ReturnType<typeof issue>>, runId: string) => {
      expect((await worker.call("POST", `/executions/${runId}/claim`, { expectedRevision: 0 })).status).toBe(201);
      const started = await worker.call<AgentHubExecution>("POST", `/executions/${runId}/report`, { action: "start", expectedRevision: 1 });
      expect(started.status, JSON.stringify(started.data)).toBe(201);
      return started.data;
    };
    return { ws, token, userId: auth.data.user.id, email, taskId: task.data.id, human, issue, profile, createTask, createRun, start };
  }

  it("delegates to another profile, then refuses Aв†’Bв†’A and depth above the owner limit", async () => {
    const s = await setup();
    const run = await s.createRun();
    const a = await s.issue("Profile A");
    const b = await s.issue("Profile B");
    const c = await s.issue("Profile C");
    const profileA = await s.profile("Profile A", a.id);
    const profileB = await s.profile("Profile B", b.id);
    const profileC = await s.profile("Profile C", c.id);
    await s.start(a, run.id);

    // Only the current worker may delegate.
    expect((await b.call("POST", `/executions/${run.id}/delegate`, {
      expectedRevision: 2, targetAgentId: profileB.id, summary: "Р§СѓР¶РѕРµ РїРѕСЂСѓС‡РµРЅРёРµ"
    })).status).toBe(403);

    const delegated = await a.call<AgentHubDelegationResult>("POST", `/executions/${run.id}/delegate`, {
      expectedRevision: 2, targetAgentId: profileB.id, summary: "РџСЂРѕРІРµСЂРёС‚СЊ С‚РµСЃС‚С‹",
      instructions: "РўРѕР»СЊРєРѕ С‡С‚РµРЅРёРµ", materialLinkIds: ["link-1"], constraints: { readOnly: true }
    });
    expect(delegated.status, JSON.stringify(delegated.data)).toBe(201);
    const child = delegated.data.execution;
    expect(child).toMatchObject({
      status: "queued", parentExecutionId: run.id, delegationDepth: 1,
      delegatedToProfileId: profileB.id, delegationChain: [profileA.id, profileB.id]
    });
    expect(child.target).toEqual({ kind: "delegation", id: child.id });
    expect(child.delegationPayload).toMatchObject({ summary: "РџСЂРѕРІРµСЂРёС‚СЊ С‚РµСЃС‚С‹", materialLinkIds: ["link-1"], constraints: { readOnly: true } });

    // The branch is visible only to the profile it was handed to.
    const otherQueue = await a.call<AgentHubExecution[]>("GET", "/executions");
    expect(otherQueue.data.some(row => row.id === child.id)).toBe(false);
    const targetQueue = await b.call<AgentHubExecution[]>("GET", "/executions");
    expect(targetQueue.data.some(row => row.id === child.id)).toBe(true);

    expect((await b.call("POST", `/executions/${child.id}/claim`, { expectedRevision: 0 })).status).toBe(201);
    expect((await b.call("POST", `/executions/${child.id}/report`, { action: "start", expectedRevision: 1 })).status).toBe(201);

    const cycle = await b.call<{ message: string }>("POST", `/executions/${child.id}/delegate`, {
      expectedRevision: 2, targetAgentId: profileA.id, summary: "Р’РµСЂРЅСѓС‚СЊ СЂРѕРґРёС‚РµР»СЋ"
    });
    expect(cycle.status).toBe(409);
    expect(cycle.data.message).toBe("delegation_cycle");

    const policy = await s.human<AgentHubDelegationPolicy>("PUT", "/agent-hub/policy", { maxDelegationDepth: 1 });
    expect(policy.status).toBe(200);
    expect(policy.data.maxDelegationDepth).toBe(1);
    const tooDeep = await b.call<{ message: string }>("POST", `/executions/${child.id}/delegate`, {
      expectedRevision: 2, targetAgentId: profileC.id, summary: "РўСЂРµС‚РёР№ СѓСЂРѕРІРµРЅСЊ"
    });
    expect(tooDeep.status).toBe(409);
    expect(tooDeep.data.message).toBe("delegation_depth_exceeded");

    // A delegator can tighten the policy but cannot widen it.
    await s.human("PUT", "/agent-hub/policy", { maxDelegationDepth: 3 });
    expect((await s.human("PUT", "/agent-hub/policy", { maxDelegationDepth: 99 })).status).toBe(400);
  });

  it("pauses above read-only operations until the owner approves or rejects", async () => {
    const s = await setup();
    const run = await s.createRun();
    const a = await s.issue("Approval worker");
    await s.profile("Approval worker", a.id);
    await s.start(a, run.id);

    const pending = await a.call<AgentHubExecution>("POST", `/executions/${run.id}/request-approval`, {
      expectedRevision: 2, action: "documents.document.update", reason: "РњРµРЅСЏРµС‚ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ РґРѕРєСѓРјРµРЅС‚"
    });
    expect(pending.status, JSON.stringify(pending.data)).toBe(201);
    expect(pending.data).toMatchObject({ status: "waiting_approval", approval: { action: "documents.document.update" } });

    // The worker cannot move itself forward while approval is pending.
    expect((await a.call("POST", `/executions/${run.id}/report`, { action: "start", expectedRevision: 3 })).status).toBe(409);
    const approved = await s.human<AgentHubExecution>("POST", `/agent-hub/executions/${run.id}/approve`, { expectedRevision: 3 });
    expect(approved.status, JSON.stringify(approved.data)).toBe(201);
    expect(approved.data).toMatchObject({ status: "working", approval: null });
    expect((await s.human("POST", `/agent-hub/executions/${run.id}/approve`, { expectedRevision: 4 })).status).toBe(409);

    const rejectedRun = await s.createRun(await s.createTask("Р’С‚РѕСЂРѕРµ РїРѕСЂСѓС‡РµРЅРёРµ"));
    const worker = await s.issue("Rejected worker");
    await s.profile("Rejected worker", worker.id);
    await s.start(worker, rejectedRun.id);
    expect((await worker.call("POST", `/executions/${rejectedRun.id}/request-approval`, {
      expectedRevision: 2, action: "finance.transaction.create", reason: "Р”РµРЅСЊРіРё"
    })).status).toBe(201);
    const rejected = await s.human<AgentHubExecution>("POST", `/agent-hub/executions/${rejectedRun.id}/reject`, {
      expectedRevision: 3, reason: "Р—Р°РїСЂРµС‰РµРЅРѕ РїРѕР»РёС‚РёРєРѕР№"
    });
    expect(rejected.status).toBe(201);
    expect(rejected.data).toMatchObject({ status: "failed", blockedReason: "Р—Р°РїСЂРµС‰РµРЅРѕ РїРѕР»РёС‚РёРєРѕР№", approval: null });
  });

  it("P3-1: admin agents skip the approval pause under non_admin policy; policy \"all\" pauses everyone", async () => {
    const s = await setup();
    const issueAdmin = async (name: string) => {
      const created = await s.human<{ id: string; secret: string }>("POST", "/agent-tokens", {
        // P3-1: режим admin — «Администратор» для политики подтверждений.
        name, mode: "admin", expiresInDays: 7, scopes: ["tasks:read"],
        modulePermissions: [
          "agent-hub.execution.read", "agent-hub.execution.create"
        ]
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      return {
        ...created.data,
        call: <T = unknown>(method: string, path: string, body?: unknown) =>
          request<T>(method, `/ai/v1/agent-hub${path}`, created.data.secret, body)
      };
    };

    // non_admin (default): admin agent does not pause; trace records auto_approved.
    const run = await s.createRun();
    const admin = await issueAdmin("Admin worker");
    await s.profile("Admin worker", admin.id);
    await s.start(admin, run.id);
    const auto = await admin.call<AgentHubExecution>("POST", `/executions/${run.id}/request-approval`, {
      expectedRevision: 2, action: "documents.document.update", reason: "trusted admin operation"
    });
    expect(auto.status, JSON.stringify(auto.data)).toBe(201);
    expect(auto.data).toMatchObject({ status: "working", approval: null });
    const trace = await s.human<{ steps: Array<{ type: string; name: string }> }>("GET", `/agent-hub/executions/${run.id}/trace`);
    expect(trace.status).toBe(200);
    expect(trace.data.steps.some(step => step.type === "approval_wait" && step.name === "auto_approved")).toBe(true);

    // policy "all": even the admin pauses, and the owner decides.
    const policy = await s.human<AgentHubDelegationPolicy>("PUT", "/agent-hub/policy", { maxDelegationDepth: 3, approvals: "all" });
    expect(policy.status).toBe(200);
    expect(policy.data.approvals).toBe("all");
    const paused = await admin.call<AgentHubExecution>("POST", `/executions/${run.id}/request-approval`, {
      expectedRevision: 2, action: "documents.document.update", reason: "policy all pauses everyone"
    });
    expect(paused.status, JSON.stringify(paused.data)).toBe(201);
    expect(paused.data).toMatchObject({ status: "waiting_approval" });
    const approved = await s.human<AgentHubExecution>("POST", `/agent-hub/executions/${run.id}/approve`, { expectedRevision: 3 });
    expect(approved.status).toBe(201);

    // Back to non_admin: the owner can flip the gate back.
    const back = await s.human<AgentHubDelegationPolicy>("PUT", "/agent-hub/policy", { maxDelegationDepth: 3, approvals: "non_admin" });
    expect(back.status).toBe(200);
    expect(back.data.approvals).toBe("non_admin");
  });

  it("builds the trace tree with tool_call/tool_result pairs and filters it", async () => {
    const s = await setup();
    const run = await s.createRun();
    const worker = await s.issue("Trace worker");
    const profile = await s.profile("Trace worker", worker.id);
    await s.start(worker, run.id);

    const callStep = await worker.call<AgentHubTraceStep>("POST", `/executions/${run.id}/trace`, {
      stepId: "call-1", type: "tool_call", name: "orion_list_tasks", payload: { filter: "open" }
    });
    expect(callStep.status, JSON.stringify(callStep.data)).toBe(201);
    const resultStep = await worker.call<AgentHubTraceStep>("POST", `/executions/${run.id}/trace`, {
      stepId: "result-1", parentStepId: "call-1", type: "tool_result", payload: { count: 2 }
    });
    expect(resultStep.status, JSON.stringify(resultStep.data)).toBe(201);
    expect(resultStep.data.durationMs).toBeGreaterThanOrEqual(0);
    expect((await worker.call("POST", `/executions/${run.id}/trace`, {
      stepId: "note-1", parentStepId: "result-1", type: "note", payload: { note: "РґРІРµ РѕС‚РєСЂС‹С‚С‹Рµ Р·Р°РґР°С‡Рё" }
    })).status).toBe(201);
    expect((await worker.call("POST", `/executions/${run.id}/trace`, {
      stepId: "result-2", type: "tool_result", payload: {}
    })).status).toBe(400);
    expect((await worker.call("POST", `/executions/${run.id}/trace`, {
      stepId: "result-3", parentStepId: "note-1", type: "tool_result", payload: {}
    })).status).toBe(400);
    // Delegation and approval facts are written by the service, not self-reported by a worker.
    expect((await worker.call("POST", `/executions/${run.id}/trace`, {
      stepId: "fake-delegation", type: "delegation", payload: {}
    })).status).toBe(400);
    expect((await worker.call("POST", `/executions/${run.id}/request-approval`, {
      expectedRevision: 2, action: "documents.document.update", reason: "РќСѓР¶РЅРѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ"
    })).status).toBe(201);

    const trace = await s.human<AgentHubTraceResponse>("GET", `/agent-hub/executions/${run.id}/trace`);
    expect(trace.status, JSON.stringify(trace.data)).toBe(200);
    expect(trace.data.total).toBe(4);
    expect(trace.data.steps.map(step => step.stepId).sort())
      .toEqual(["approval-wait:3", "call-1", "note-1", "result-1"]);
    const callNode = trace.data.tree.find(node => node.stepId === "call-1")!;
    expect(callNode.children.map(node => node.stepId)).toEqual(["result-1"]);
    expect(callNode.children[0]!.children.map(node => node.stepId)).toEqual(["note-1"]);
    expect(trace.data.tree.map(node => node.stepId).sort()).toEqual(["approval-wait:3", "call-1"]);

    const onlyCalls = await s.human<AgentHubTraceResponse>("GET", `/agent-hub/executions/${run.id}/trace?type=tool_call,tool_result`);
    expect(onlyCalls.data.steps.map(step => step.stepId).sort()).toEqual(["call-1", "result-1"]);
    const focused = await s.human<AgentHubTraceResponse>("GET", `/agent-hub/executions/${run.id}/trace?stepId=result-1`);
    expect(focused.data.tree.map(node => node.stepId)).toEqual(["result-1"]);
    expect(focused.data.tree[0]!.children.map(node => node.stepId)).toEqual(["note-1"]);
    const shallow = await s.human<AgentHubTraceResponse>("GET", `/agent-hub/executions/${run.id}/trace?depth=1`);
    const shallowCall = shallow.data.tree.find(node => node.stepId === "call-1")!;
    expect(shallowCall.children.map(node => node.stepId)).toEqual(["result-1"]);
    expect(shallowCall.children[0]!.children).toEqual([]);
    const byAgent = await s.human<AgentHubTraceResponse>("GET", `/agent-hub/executions/${run.id}/trace?agentId=${profile.id}`);
    expect(byAgent.data.total).toBe(4);
    expect((await s.human("GET", `/agent-hub/executions/${run.id}/trace?type=unknown`)).status).toBe(400);
  });

  it("keeps memory history through supersede chains and refuses another agent's user memory", async () => {
    const s = await setup();
    const alice = await s.issue("Alice agent");
    const bob = await s.issue("Bob agent");
    const aliceProfile = await s.profile("Alice agent", alice.id);
    await s.profile("Bob agent", bob.id);

    const first = await alice.call<AgentMemoryRecord>("POST", "/memory", {
      scope: "user", key: "preference", value: { theme: "dark" }
    });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data).toMatchObject({ scope: "user", scopeId: s.userId, validity: "valid", agentId: aliceProfile.id, source: "agent" });
    const second = await alice.call<AgentMemoryRecord>("POST", "/memory", {
      scope: "user", key: "preference", value: { theme: "light" }
    });
    expect(second.status, JSON.stringify(second.data)).toBe(201);
    expect(second.data).toMatchObject({ validity: "valid", agentId: aliceProfile.id });
    expect(second.data.id).not.toBe(first.data.id);

    const active = await alice.call<AgentMemoryRecord[]>("GET", "/memory?scope=user");
    expect(active.data.map(record => record.id)).toEqual([second.data.id]);
    const history = await s.human<AgentMemoryRecord[]>("GET", "/agent-hub/memory?scope=user&includeHistory=true");
    expect(history.status, JSON.stringify(history.data)).toBe(200);
    expect(history.data).toHaveLength(2);
    const superseded = history.data.find(record => record.id === first.data.id)!;
    expect(superseded).toMatchObject({ validity: "superseded", supersededById: second.data.id });

    // Another agent of the same human neither sees nor overwrites Alice's user memory.
    const bobRead = await bob.call<AgentMemoryRecord[]>("GET", "/memory?scope=user");
    expect(bobRead.status).toBe(200);
    expect(bobRead.data).toEqual([]);
    const bobWrite = await bob.call("POST", "/memory", { scope: "user", key: "preference", value: { theme: "system" } });
    expect(bobWrite.status).toBe(403);
    expect((await bob.call("POST", "/memory", { scope: "user", key: "bob-only", value: 1 })).status).toBe(201);

    const outdated = await s.human<AgentMemoryRecord>("PATCH", `/agent-hub/memory/${second.data.id}`, { validity: "outdated" });
    expect(outdated.status, JSON.stringify(outdated.data)).toBe(200);
    expect(outdated.data.validity).toBe("outdated");
    const context = await alice.call<AgentHubContextResponse>("GET", "/context?includeCapabilities=true");
    expect(context.status, JSON.stringify(context.data)).toBe(200);
    const entry = context.data.memory.find(item => item.id === second.data.id)!;
    expect(entry).toMatchObject({ needsVerification: true, validity: "outdated" });
    expect(context.data.warnings.length).toBeGreaterThan(0);
    const agentHubCapabilities = context.data.capabilities.find(module => module.moduleId === "agent-hub");
    expect(agentHubCapabilities?.tools.map(tool => tool.name)).toContain("orion_agent_hub_delegate");
  });

  it("reassigns a branch to another profile and keeps the previous journal", async () => {
    const s = await setup();
    const run = await s.createRun();
    const a = await s.issue("Original worker");
    const b = await s.issue("Successor worker");
    await s.profile("Original worker", a.id);
    const profileB = await s.profile("Successor worker", b.id);
    await s.start(a, run.id);

    const reassigned = await s.human<AgentHubReassignResult>("POST", `/agent-hub/executions/${run.id}/reassign`, {
      expectedRevision: 2, agentId: profileB.id, reason: "РќСѓР¶РµРЅ РґСЂСѓРіРѕР№ РїСЂРѕС„РёР»СЊ"
    });
    expect(reassigned.status, JSON.stringify(reassigned.data)).toBe(201);
    expect(reassigned.data.previous).toMatchObject({ id: run.id, status: "reassigned", workerId: null });
    const replacement = reassigned.data.execution;
    expect(replacement).toMatchObject({
      status: "queued", delegatedToProfileId: profileB.id, delegationDepth: 0,
      parentExecutionId: null, target: { kind: "task", id: s.taskId }
    });
    expect(replacement.delegationChain).toEqual([profileB.id]);
    expect((await a.call("POST", `/executions/${run.id}/report`, { action: "heartbeat", expectedRevision: 3 })).status).toBe(409);

    const queue = await b.call<AgentHubExecution[]>("GET", "/executions");
    expect(queue.data.some(row => row.id === replacement.id)).toBe(true);
    expect((await b.call("POST", `/executions/${replacement.id}/claim`, { expectedRevision: 0 })).status).toBe(201);

    const events = await s.human<Array<{ action: string }>>("GET", `/agent-hub/executions/${run.id}/events`);
    expect(events.data.map(event => event.action)).toEqual(["create", "claim", "start", "reassign"]);
  });
});
