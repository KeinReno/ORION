import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { ProjectsService } from "../src/projects/projects.service";
import { ProjectReferences } from "../src/projects/public/project-references";
import { ProjectFinanceReader } from "../src/projects/public/project-finance-reader";
import { ProjectCostsService } from "../src/finance/project-costs/project-costs.service";

const hostModules = new Set(["ScheduleModule", "PrismaModule", "BackgroundJobsModule", "ProjectAggregateModule",
  "AuthModule", "WorkspacesModule", "ModulesModule", "PluginsModule", "StorageModule", "FinanceModule"]);
const appImports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
class FinanceHost {}
Module({ imports: appImports.filter(entry => {
  const candidate = typeof entry === "function" ? entry : "module" in entry ? entry.module : undefined;
  return candidate && hostModules.has(candidate.name);
}) })(FinanceHost);
type Session = { accessToken: string; user: { id: string }; workspaceId: string };
type Row = { id: string; projectId: string | null; note: string };
type Costs = { currency: string | null; expense: number; income: number; operationCount: number;
  mixedCurrencies: boolean; byCurrency: Array<{ currency: string; expense: number; income: number }> };

describe("Finance uses Projects public contracts (ADR-0031)", () => {
  let app: INestApplication, prisma: PrismaService, origin: string;
  const prefix = `finance-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      { email: `${prefix}-${++serial}@example.test`, name: "Finance reference", password: "integration-password-123" });
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
  async function account(s: Session, currency = "RUB") {
    const result = await request(s, `${base(s)}/finance/accounts`, "POST", { name: `Account ${++serial}`, currency, startingBalance: 0 });
    expect(result.status).toBe(201); return result.data.id;
  }
  const transaction = (accountId: string, projectId: string | null, amount = 100) =>
    ({ accountId, projectId, type: "expense", occurredAt: "2026-11-01T10:00:00Z", note: "keep", lines: [{ categoryId: null, amount }] });
  const template = (accountId: string, projectId: string | null) => ({ accountId, projectId, name: "Template", type: "expense", amount: 100, note: "keep" });
  async function counts(workspaceId: string) {
    return prisma.asSystem(async tx => ({ transactions: await tx.transaction.count({ where: { workspaceId } }),
      lines: await tx.transactionLine.count({ where: { transaction: { workspaceId } } }), templates: await tx.financeTemplate.count({ where: { workspaceId } }) }));
  }
  const costsPath = (s: Session, id: string) => `${base(s)}/finance/projects/${id}/costs`;

  it.each(["transactions", "templates"] as const)("%s preserves valid links/null and rejects foreign or missing projects atomically", async kind => {
    const alice = await register(), bob = await register();
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: bob.workspaceId, userId: alice.user.id, role: "member" } }));
    const own = await project(alice), foreign = await project(bob), accountId = await account(alice);
    const path = `${base(alice)}/finance/${kind}`;
    const body = kind === "transactions" ? transaction(accountId, own) : template(accountId, own);
    const created = await request(alice, path, "POST", body); expect(created.status).toBe(201);
    expect(created.data.projectId).toBe(own);
    const before = await counts(alice.workspaceId);
    for (const id of [foreign, "missing-project"]) {
      const invalid = await request(alice, `${path}/${created.data.id}`, "PATCH", { projectId: id, note: "lose" });
      expect(invalid.status).toBe(400); expect(invalid.data).toMatchObject({ message: "Проект не найден в этом рабочем пространстве" });
      expect((await request(alice, path, "POST", { ...body, projectId: id })).status).toBe(400);
      expect(await counts(alice.workspaceId)).toEqual(before);
    }
    const saved = await prisma.asSystem(tx => kind === "transactions" ?
      tx.transaction.findUniqueOrThrow({ where: { id: created.data.id }, select: { projectId: true, note: true } }) :
      tx.financeTemplate.findUniqueOrThrow({ where: { id: created.data.id }, select: { projectId: true, note: true } }));
    expect(saved).toEqual({ projectId: own, note: "keep" });
    const spy = vi.spyOn(app.get(ProjectReferences), "existsTx");
    try {
      expect((await request(alice, `${path}/${created.data.id}`, "PATCH", { projectId: null })).data.projectId).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("costs keeps exact separate currencies and follows the project's leading currency", async () => {
    const alice = await register(), id = await project(alice, "USD"), rub = await account(alice), usd = await account(alice, "USD");
    for (const [acc, amount] of [[rub, 300], [rub, 200], [usd, 99]] as const) {
      expect((await request(alice, `${base(alice)}/finance/transactions`, "POST", transaction(acc, id, amount))).status).toBe(201);
    }
    const result = await request<Costs>(alice, costsPath(alice, id)); expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ currency: "USD", expense: 99, income: 0, operationCount: 3, mixedCurrencies: true });
    expect(result.data.byCurrency).toEqual([expect.objectContaining({ currency: "USD", expense: 99 }), expect.objectContaining({ currency: "RUB", expense: 500 })]);
    // No operation in the new project currency: fall back to currency with more operations.
    expect((await request(alice, `${base(alice)}/projects/${id}`, "PATCH", { currency: "EUR" })).status).toBe(200);
    expect((await request<Costs>(alice, costsPath(alice, id))).data.currency).toBe("RUB");
    const bob = await register(), foreign = await project(bob);
    await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: bob.workspaceId, userId: alice.user.id, role: "member" } }));
    for (const missing of [foreign, "missing-project"]) expect((await request(alice, costsPath(alice, missing))).status).toBe(400);
  });

  it("authorization and disabled-plugin guards precede readers", async () => {
    const alice = await register(), outsider = await register(), id = await project(alice), accountId = await account(alice);
    const spy = vi.spyOn(app.get(ProjectReferences), "existsTx"), currency = vi.spyOn(app.get(ProjectFinanceReader), "currencyTx");
    try {
      expect((await request(outsider, `${base(alice)}/finance/transactions`, "POST", transaction(accountId, id))).status).toBe(403);
      expect((await request(outsider, `${base(alice)}/finance/templates`, "POST", template(accountId, id))).status).toBe(403);
      expect((await request(outsider, costsPath(alice, id))).status).toBe(403);
      expect(spy).not.toHaveBeenCalled(); expect(currency).not.toHaveBeenCalled();
      expect((await request(alice, `${base(alice)}/plugins/finance-project-costs`, "PATCH", { enabled: false })).status).toBe(200);
      expect((await request(alice, costsPath(alice, id))).status).toBe(409); expect(currency).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); currency.mockRestore(); }
  });

  it("archived and disabled Projects preserve Finance data and reference policy", async () => {
    const alice = await register(), id = await project(alice), accountId = await account(alice);
    expect((await request(alice, `${base(alice)}/projects/${id}`, "DELETE")).status).toBe(200);
    expect((await request(alice, `${base(alice)}/modules/projects`, "PATCH", { enabled: false, confirm: true })).status).toBe(200);
    expect((await request(alice, `${base(alice)}/finance/transactions`, "POST", transaction(accountId, id))).status).toBe(201);
    expect((await request(alice, `${base(alice)}/finance/templates`, "POST", template(accountId, id))).status).toBe(201);
    // The service is independent of Projects' HTTP guard; no plugin guard is bypassed in production.
    const costs = await app.get(ProjectCostsService).costs(alice.user.id, alice.workspaceId, id);
    expect(costs.expense).toBe(100); expect(costs.operationCount).toBe(1);
  });

  it("currency projection preserves workspace scope, exact fields, RLS and transaction rollback", async () => {
    const alice = await register(), outsider = await register(), reader = app.get(ProjectFinanceReader);
    let id = "";
    await expect(prisma.withUser(alice.user.id, async tx => {
      const row = await tx.project.create({ data: { workspaceId: alice.workspaceId, name: "uncommitted", currency: "USD" } }); id = row.id;
      expect(await reader.currencyTx(tx, alice.workspaceId, id)).toEqual({ currency: "USD" });
      expect(await reader.currencyTx(tx, outsider.workspaceId, id)).toBeNull();
      throw new Error("currency rollback");
    })).rejects.toThrow("currency rollback");
    expect(await prisma.withUser(alice.user.id, tx => reader.currencyTx(tx, alice.workspaceId, id))).toBeNull();
    const committed = await project(alice);
    expect(await prisma.withUser(outsider.user.id, tx => reader.currencyTx(tx, alice.workspaceId, committed))).toBeNull();
    await prisma.asSystem(tx => tx.project.delete({ where: { id: committed } }));
    expect(await prisma.withUser(alice.user.id, tx => reader.currencyTx(tx, alice.workspaceId, committed))).toBeNull();
  });

  it("Finance works with SDKs and ProjectsModule physically absent", async () => {
    const alice = await register(), id = await project(alice), accountId = await account(alice);
    const host = await NestFactory.create(FinanceHost, { logger: false, abortOnError: false });
    try {
      configureApp(host); await host.listen(0, "127.0.0.1");
      for (const job of host.get(SchedulerRegistry).getCronJobs().values()) job.stop();
      expect(() => host.get(ProjectsService)).toThrow();
      expect((await request(alice, `${base(alice)}/projects`, "GET", undefined, address(host))).status).toBe(404);
      expect((await request(alice, `${base(alice)}/finance/transactions`, "POST", transaction(accountId, id), address(host))).status).toBe(201);
      expect((await request(alice, `${base(alice)}/finance/templates`, "POST", template(accountId, id), address(host))).status).toBe(201);
      const result = await request<Costs>(alice, costsPath(alice, id), "GET", undefined, address(host));
      expect(result.status).toBe(200); expect(result.data.expense).toBe(100);
    } finally { await host.close(); }
  });
});
function address(app: INestApplication) { return `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`; }
