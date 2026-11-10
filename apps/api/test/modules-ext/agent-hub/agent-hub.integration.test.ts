import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MODULE_CATALOG, ORION_MODULE_IDS, type AgentHubExecution, type AgentHubEvent } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";
import { SNAPSHOT_MODEL_REGISTRY } from "../../../src/sync/snapshot-registry";

describe("Agent Hub: durable human queue v1", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  const prefix = `agenthub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let serial = 0;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) await prisma.asSystem(async (tx) => {
      const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
      const ids = users.map((u) => u.id);
      if (!ids.length) return;
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      expect(await tx.agentHubExecution.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
      expect(await tx.agentHubEvent.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
    });
    await app?.close();
  });

  async function request<T = any>(path: string, method: string, token?: string, body?: unknown) {
    const response = await fetch(url + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup() {
    const auth = await request<{ accessToken: string }>("/auth/register", "POST", undefined, {
      email: `${prefix}-${serial++}@example.test`, password: "integration-password-123", name: "Владелец"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const ws = (await request<Array<{ id: string }>>("/workspaces/me", "GET", token)).data[0]!.id;
    const call = <T = any>(method: string, path: string, body?: unknown) =>
      request<T>(`/workspaces/${ws}/agent-hub${path}`, method, token, body);
    const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, "POST", token, { title: "Проверить выполнение" });
    expect(task.status).toBe(201);
    return {
      ws, token, taskId: task.data.id, email: `${prefix}-${serial - 1}@example.test`, call,
      setModule: (enabled: boolean) => request(`/workspaces/${ws}/modules/agent-hub`, "PATCH", token, { enabled, confirm: true })
    };
  }

  async function issueCredentialForWorkspace(workspaceId: string, token: string, name: string) {
    const created = await request<{ id: string; secret: string }>(`/workspaces/${workspaceId}/agent-tokens`, "POST", token, {
      name, scopes: ["tasks:read"], modulePermissions: ["agent-hub.execution.read", "agent-hub.execution.create"]
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    return created.data;
  }

  async function issueCredential(s: Awaited<ReturnType<typeof setup>>, name: string) {
    return issueCredentialForWorkspace(s.ws, s.token, name);
  }

  async function inviteMember(owner: Awaited<ReturnType<typeof setup>>, member: Awaited<ReturnType<typeof setup>>) {
    const invited = await request<{ acceptUrl: string }>(`/workspaces/${owner.ws}/invites`, "POST", owner.token, {
      email: member.email, role: "member"
    });
    expect(invited.status, JSON.stringify(invited.data)).toBe(201);
    const inviteToken = new URL(invited.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${inviteToken}/accept`, "POST", member.token)).status).toBe(201);
  }

  it("is a registered optional module with persistent snapshot models", () => {
    expect(ORION_MODULE_IDS).toContain("agent-hub");
    expect(MODULE_CATALOG.find((m) => m.id === "agent-hub")?.defaultEnabled).toBe(true);
    for (const model of ["AgentHubExecution", "AgentHubEvent"]) {
      expect(SNAPSHOT_MODEL_REGISTRY.find((m) => m.model === model)?.policy).toBe("included");
    }
  });

  it("creates one execution with atomic journal; repeats idempotently by requestId", async () => {
    const s = await setup();
    await s.setModule(true);
    const requestId = crypto.randomUUID();
    const first = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId, requestId });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data).toMatchObject({ id: requestId, workspaceId: s.ws, target: { kind: "task", id: s.taskId }, status: "queued", revision: 0 });
    const repeat = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId, requestId });
    expect(repeat.status).toBe(201);
    expect(repeat.data.id).toBe(requestId);
    const events = await s.call<AgentHubEvent[]>("GET", `/executions/${requestId}/events`);
    expect(events.data).toHaveLength(1);
    expect(events.data[0]).toMatchObject({ action: "create", revision: 0 });
    const duplicate = await s.call("POST", "/executions", { taskId: s.taskId });
    expect(duplicate.status).toBe(409);
  });

  it("only one competing create can succeed for the same task", async () => {
    const s = await setup();
    await s.setModule(true);
    const [first, second] = await Promise.all([
      s.call("POST", "/executions", { taskId: s.taskId }),
      s.call("POST", "/executions", { taskId: s.taskId })
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const runs = await s.call<AgentHubExecution[]>("GET", "/executions");
    expect(runs.data).toHaveLength(1);
  });

  it("cancels with expected revision and appends one event; terminal immutable", async () => {
    const s = await setup();
    await s.setModule(true);
    const created = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId });
    const id = created.data.id;
    const canceled = await s.call<AgentHubExecution>("POST", `/executions/${id}/cancel`, { expectedRevision: 0 });
    expect(canceled.status).toBe(201);
    expect(canceled.data).toMatchObject({ status: "canceled", revision: 1 });
    expect((await s.call("POST", `/executions/${id}/cancel`, { expectedRevision: 0 })).status).toBe(409);
    const events = await s.call<AgentHubEvent[]>("GET", `/executions/${id}/events`);
    expect(events.data.map((e) => [e.revision, e.action])).toEqual([[0, "create"], [1, "cancel"]]);
    // Terminal execution frees the unique partial index for an independent retry.
    expect((await s.call("POST", "/executions", { taskId: s.taskId })).status).toBe(201);
  });

  it("isolates different workspaces and refuses non-existent task ids", async () => {
    const a = await setup(), b = await setup();
    await a.setModule(true);
    await b.setModule(true);
    expect((await a.call("POST", "/executions", { taskId: b.taskId })).status).toBe(404);
    const created = await a.call<AgentHubExecution>("POST", "/executions", { taskId: a.taskId });
    expect((await b.call("GET", `/executions/${created.data.id}`)).status).toBe(404);
    expect((await b.call("GET", `/executions/${created.data.id}/events`)).status).toBe(404);
  });

  it("disabling the module denies API but preserves the queue and history", async () => {
    const s = await setup();
    await s.setModule(true);
    const first = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId });
    expect((await s.setModule(false)).status).toBe(200);
    expect((await s.call("GET", "/executions")).status).toBe(409);
    await s.setModule(true);
    const runs = await s.call<AgentHubExecution[]>("GET", "/executions");
    expect(runs.data.map((r) => r.id)).toEqual([first.data.id]);
    expect((await s.call<AgentHubEvent[]>("GET", `/executions/${first.data.id}/events`)).data).toHaveLength(1);
  });

  it("creates stable profiles and task assignments, checks lead role, and persists across module disable", async () => {
    const owner = await setup();
    const member = await setup();
    await owner.setModule(true);
    await inviteMember(owner, member);
    const credential = await issueCredential(owner, "Codex local");
    const profile = await request<{ id: string; name: string; credentialStatus: string }>(
      `/workspaces/${owner.ws}/agent-hub/agents`, "POST", owner.token,
      { name: "Codex", credentialIds: [credential.id] }
    );
    expect(profile.status, JSON.stringify(profile.data)).toBe(201);
    expect(profile.data).toMatchObject({ name: "Codex", credentialStatus: "active" });

    const assignment = await request<{ workspaceId: string; taskId: string; agent: { id: string; name: string } | null; credentialStatus: string }>(
      `/workspaces/${owner.ws}/agent-hub/task-assignments/${owner.taskId}`, "PUT", owner.token,
      { agentId: profile.data.id }
    );
    expect(assignment.status, JSON.stringify(assignment.data)).toBe(200);
    expect(assignment.data).toMatchObject({
      workspaceId: owner.ws, taskId: owner.taskId,
      agent: { id: profile.data.id, name: "Codex" }, credentialStatus: "active"
    });
    const persisted = await prisma.asSystem(async (tx) => tx.agentHubTaskAssignment.findUniqueOrThrow({
      where: { workspaceId_taskId: { workspaceId: owner.ws, taskId: owner.taskId } }
    }));
    expect(persisted).toMatchObject({ workspaceId: owner.ws, taskId: owner.taskId, profileId: profile.data.id });

    const memberWrite = await request(`/workspaces/${owner.ws}/agent-hub/task-assignments/${owner.taskId}`, "PUT", member.token, { agentId: profile.data.id });
    expect(memberWrite.status).toBe(403);
    const memberCredential = await issueCredentialForWorkspace(owner.ws, member.token, "Member credential");
    const memberProfile = await request(`/workspaces/${owner.ws}/agent-hub/agents`, "POST", member.token, { name: "Member agent", credentialIds: [memberCredential.id] });
    expect(memberProfile.status).toBe(403);

    expect((await owner.setModule(false)).status).toBe(200);
    expect((await request(`/workspaces/${owner.ws}/agent-hub/task-assignments/${owner.taskId}`, "GET", owner.token)).status).toBe(409);
    await owner.setModule(true);
    const afterReenable = await request<{ agent: { id: string } | null }>(`/workspaces/${owner.ws}/agent-hub/task-assignments/${owner.taskId}`, "GET", owner.token);
    expect(afterReenable.status).toBe(200);
    expect(afterReenable.data.agent?.id).toBe(profile.data.id);
  });

  it("isolates profiles and rejects credentials owned by another user/workspace", async () => {
    const alice = await setup();
    const bob = await setup();
    await alice.setModule(true);
    await bob.setModule(true);
    await inviteMember(alice, bob);
    const aliceCredential = await issueCredential(alice, "Alice agent");
    const bobCredential = await issueCredentialForWorkspace(alice.ws, bob.token, "Bob agent");
    const created = await request<{ id: string }>(`/workspaces/${alice.ws}/agent-hub/agents`, "POST", alice.token, {
      name: "Alice persona", credentialIds: [aliceCredential.id]
    });
    expect(created.status).toBe(201);

    const foreignCredential = await request(`/workspaces/${alice.ws}/agent-hub/agents`, "POST", alice.token, {
      name: "Foreign credential", credentialIds: [bobCredential.id]
    });
    expect(foreignCredential.status).toBe(403);
    expect((await request(`/workspaces/${bob.ws}/agent-hub/task-assignments/${alice.taskId}`, "GET", bob.token)).status).toBe(404);
    expect((await request(`/workspaces/${bob.ws}/agent-hub/task-assignments/${alice.taskId}`, "GET", bob.token)).status).toBe(404);
  });

  it("serializes competing assignment writes and keeps one current durable assignment", async () => {
    const s = await setup();
    await s.setModule(true);
    const firstCredential = await issueCredential(s, "First");
    const secondCredential = await issueCredential(s, "Second");
    const first = await request<{ id: string }>(`/workspaces/${s.ws}/agent-hub/agents`, "POST", s.token, { name: "First", credentialIds: [firstCredential.id] });
    const second = await request<{ id: string }>(`/workspaces/${s.ws}/agent-hub/agents`, "POST", s.token, { name: "Second", credentialIds: [secondCredential.id] });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const results = await Promise.all([
      request<{ agent: { id: string } | null }>(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "PUT", s.token, { agentId: first.data.id }),
      request<{ agent: { id: string } | null }>(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "PUT", s.token, { agentId: second.data.id })
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const persisted = await prisma.asSystem(async (tx) => tx.agentHubTaskAssignment.findMany({ where: { workspaceId: s.ws, taskId: s.taskId } }));
    expect(persisted).toHaveLength(1);
    expect([first.data.id, second.data.id]).toContain(persisted[0]!.profileId);
  });

  it("routes queued work only to the assigned credential and fences reassignment during a claim", async () => {
    const s = await setup();
    await s.setModule(true);
    const assignedCredential = await issueCredential(s, "Assigned worker");
    const otherCredential = await issueCredential(s, "Other worker");
    const assignedProfile = await request<{ id: string }>(`/workspaces/${s.ws}/agent-hub/agents`, "POST", s.token, {
      name: "Assigned worker", credentialIds: [assignedCredential.id]
    });
    const otherProfile = await request<{ id: string }>(`/workspaces/${s.ws}/agent-hub/agents`, "POST", s.token, {
      name: "Other worker", credentialIds: [otherCredential.id]
    });
    expect(assignedProfile.status).toBe(201);
    expect(otherProfile.status).toBe(201);
    expect((await request(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "PUT", s.token, { agentId: assignedProfile.data.id })).status).toBe(200);
    const execution = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId });
    expect(execution.status).toBe(201);

    const otherQueue = await request<AgentHubExecution[]>("/ai/v1/agent-hub/executions", "GET", otherCredential.secret);
    expect(otherQueue.status).toBe(200);
    expect(otherQueue.data.some(row => row.id === execution.data.id)).toBe(false);
    const deniedClaim = await request(`/ai/v1/agent-hub/executions/${execution.data.id}/claim`, "POST", otherCredential.secret, { expectedRevision: 0 });
    expect(deniedClaim.status).toBe(403);

    const assignedQueue = await request<AgentHubExecution[]>("/ai/v1/agent-hub/executions", "GET", assignedCredential.secret);
    expect(assignedQueue.status).toBe(200);
    expect(assignedQueue.data.some(row => row.id === execution.data.id)).toBe(true);
    const claim = await request<AgentHubExecution>(`/ai/v1/agent-hub/executions/${execution.data.id}/claim`, "POST", assignedCredential.secret, { expectedRevision: 0 });
    expect(claim.status, JSON.stringify(claim.data)).toBe(201);
    expect(claim.data).toMatchObject({ status: "claimed", workerId: assignedCredential.id, revision: 1 });

    const reassignment = await request(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "PUT", s.token, { agentId: otherProfile.data.id });
    expect(reassignment.status).toBe(409);
  });

  it("retains assignment after credential revocation but reports missing authority and refuses a new assignment", async () => {
    const s = await setup();
    await s.setModule(true);
    const credential = await issueCredential(s, "Revocable");
    const profile = await request<{ id: string }>(`/workspaces/${s.ws}/agent-hub/agents`, "POST", s.token, { name: "Revocable agent", credentialIds: [credential.id] });
    expect(profile.status).toBe(201);
    expect((await request(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "PUT", s.token, { agentId: profile.data.id })).status).toBe(200);
    expect((await request(`/workspaces/${s.ws}/agent-tokens/${credential.id}`, "DELETE", s.token)).status).toBe(204);

    const assignment = await request<{ agent: { id: string } | null; credentialStatus: string }>(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "GET", s.token);
    expect(assignment.status).toBe(200);
    expect(assignment.data).toMatchObject({ agent: { id: profile.data.id }, credentialStatus: "revoked" });
    expect((await request(`/workspaces/${s.ws}/agent-hub/task-assignments/${s.taskId}`, "PUT", s.token, { agentId: profile.data.id })).status).toBe(409);
  });
});
