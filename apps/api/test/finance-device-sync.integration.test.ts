import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FinanceDeviceCommand, FinanceDeviceResult, FinanceDeviceSnapshot } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
// The JS test tooling already depends on pg. Keep this small driver boundary
// local to the opt-in migration test rather than adding runtime dependencies.
const pg = createRequire(__filename)("pg") as {
    Client: new (options: {
        connectionString: string;
    }) => {
        connect(): Promise<void>;
        end(): Promise<void>;
        query(sql: string, parameters?: unknown[]): Promise<{
            rows: Record<string, unknown>[];
        }>;
    };
};
describe("Finance device replication: PostgreSQL/RLS/HTTP", () => {
    let app: INestApplication, prisma: PrismaService, base: string;
    const prefix = `device-finance-${Date.now()}-${randomUUID().slice(0, 8)}`;
    beforeAll(async () => { app = await NestFactory.create(AppModule, { logger: false }); configureApp(app); await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as {
        port: number;
    }).port}`; prisma = app.get(PrismaService); });
    afterAll(async () => { if (prisma)
        await prisma.asSystem(async (tx) => { const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } }); const ids = users.map(u => u.id); const members = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } }); await tx.workspace.deleteMany({ where: { id: { in: members.map(m => m.workspaceId) } } }); await tx.user.deleteMany({ where: { id: { in: ids } } }); }); await app?.close(); });
    async function request<T = unknown>(path: string, token: string, method = "GET", body?: unknown) { const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); return { status: r.status, data: (text ? JSON.parse(text) : null) as T }; }
    async function user(name: string) { const r = await request<{
        accessToken: string;
        user: {
            id: string;
        };
    }>("/auth/register", "", "POST", { email: `${prefix}-${name}-${randomUUID().slice(0, 5)}@example.test`, name, password: "synthetic-test-password-123" }); expect(r.status).toBe(201); const token = r.data.accessToken; const ws = (await request<Array<{
        id: string;
    }>>("/workspaces/me", token)).data[0].id; return { token, userId: r.data.user.id, ws }; }
    async function setup() {
        const u = await user("owner"), deviceId = randomUUID(), path = `/workspaces/${u.ws}/finance`, sync = `${path}/device-sync/v1`;
        expect((await request(`/workspaces/${u.ws}/plugins/finance-device-sync`, u.token, "PATCH", { enabled: true })).status).toBe(200);
        expect((await request(`/workspaces/${u.ws}/sync/mode`, u.token, "PUT", { mode: "hybrid" })).status).toBe(200);
        expect((await request("/sync/devices", u.token, "POST", { deviceId, name: "Synthetic phone" })).status).toBe(201);
        const account = (await request<{
            id: string;
        }>(`${path}/accounts`, u.token, "POST", { name: "Private test", visibility: "private" })).data.id;
        const category = (await request<{
            id: string;
        }>(`${path}/categories`, u.token, "POST", { name: "Test expense", kind: "expense" })).data.id;
        const command: FinanceDeviceCommand = { protocol: 1, kind: "create", deviceId, opId: randomUUID(), entityId: randomUUID(), input: { accountId: account, categoryId: category, type: "expense", amount: 12050, occurredAt: "2026-10-26T09:00:00.000Z", note: "Synthetic expense" } };
        const send = (body: unknown) => request<FinanceDeviceResult & {
            code?: string;
        }>(`${sync}/commands`, u.token, "POST", body);
        const snapshot = () => request<FinanceDeviceSnapshot>(`${sync}/snapshot?deviceId=${deviceId}`, u.token);
        return { ...u, deviceId, path, sync, account, category, command, send, snapshot };
    }
    it("defaults off and preserves ordinary Finance CRUD", async () => { const u = await user("disabled"); expect((await request(`/workspaces/${u.ws}/finance/device-sync/v1/capability`, u.token)).status).toBe(409); expect((await request(`/workspaces/${u.ws}/finance/accounts`, u.token)).status).toBe(200); });
    it("atomically acknowledges a lost response and concurrent identical retries exactly once", async () => { const s = await setup(); const results = await Promise.all(Array.from({ length: 4 }, () => s.send(s.command))); expect(results.map(r => r.status)).toEqual([201, 201, 201, 201]); for (const r of results)
        expect(r.data).toEqual(results[0].data); const snap = (await s.snapshot()).data; expect(snap.transactions).toHaveLength(1); expect(snap.transactions[0].transaction.id).toBe(s.command.entityId); expect(snap.accounts[0].balance).toBe(-12050); expect((await s.send(s.command)).data).toEqual(results[0].data); });
    it("rejects another body or entity under the same opId without another write", async () => { const s = await setup(); expect((await s.send(s.command)).status).toBe(201); expect((await s.send({ ...s.command, entityId: randomUUID() })).data.code).toBe("op_body_mismatch"); expect((await s.snapshot()).data.transactions).toHaveLength(1); });
    it("rejects an offline edit after a desktop header or direct line mutation", async () => {
        const s = await setup();
        await s.send(s.command);
        let snap = (await s.snapshot()).data;
        let rev = snap.transactions[0].revision;
        expect((await request(`${s.path}/transactions/${s.command.entityId}`, s.token, "PATCH", { note: "Desktop edit" })).status).toBe(200);
        const update = { ...s.command, kind: "update", opId: randomUUID(), expectedRevision: rev };
        expect((await s.send(update)).data.code).toBe("revision_conflict");
        snap = (await s.snapshot()).data;
        rev = snap.transactions[0].revision;
        expect(snap.transactions[0].transaction.note).toBe("Desktop edit");
        await prisma.withUser(s.userId, tx => tx.transactionLine.update({ where: { id: snap.transactions[0].transaction.lines[0].id }, data: { amount: 15000 } }));
        expect((await s.send({ ...update, opId: randomUUID(), expectedRevision: rev })).data.code).toBe("revision_conflict");
        expect((await s.snapshot()).data.accounts[0].balance).toBe(-15000);
    });
    it("serializes two concurrent edits so only one expected revision wins", async () => { const s = await setup(); await s.send(s.command); const revision = (await s.snapshot()).data.transactions[0].revision; const results = await Promise.all([1, 2].map(n => s.send({ ...s.command, kind: "update", opId: randomUUID(), expectedRevision: revision, input: { ...s.command.input, note: `Edit ${n}` } }))); expect(results.map(r => r.status).sort()).toEqual([201, 409]); });
    it("retains a delete receipt/tombstone and does not recreate a deleted entity", async () => { const s = await setup(); await s.send(s.command); const revision = (await s.snapshot()).data.transactions[0].revision; const del = { protocol: 1, kind: "delete", deviceId: s.deviceId, opId: randomUUID(), entityId: s.command.entityId, expectedRevision: revision }; const r = await s.send(del); expect(r.status).toBe(201); expect((await s.send(del)).data).toEqual(r.data); expect((await s.send({ ...s.command, opId: randomUUID() })).data.code).toBe("entity_exists"); expect((await s.snapshot()).data.transactions).toHaveLength(0); expect((await s.snapshot()).data.accounts[0].balance).toBe(0); });
    it("rolls back invalid references with no receipt or financial effect", async () => { const s = await setup(); expect((await s.send({ ...s.command, input: { ...s.command.input, categoryId: randomUUID() } })).status).toBe(404); expect(await prisma.withUser(s.userId, tx => tx.financeDeviceReceipt.count({ where: { workspaceId: s.ws } }))).toBe(0); expect((await s.send(s.command)).status).toBe(201); });
    it("does not publish private finance or receipts to a second member", async () => { const s = await setup(); await s.send(s.command); const other = await user("member"); await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: s.ws, userId: other.userId, role: "member" } })); const deviceId = randomUUID(); await request("/sync/devices", other.token, "POST", { deviceId, name: "Other phone" }); const result = await request<FinanceDeviceSnapshot>(`${s.sync}/snapshot?deviceId=${deviceId}`, other.token); expect(result.status).toBe(200); expect(result.data.accounts).toHaveLength(0); expect(result.data.transactions).toHaveLength(0); expect(await prisma.withUser(other.userId, tx => tx.financeDeviceReceipt.count({ where: { workspaceId: s.ws } }))).toBe(0); expect(await prisma.withUser(other.userId, tx => tx.financeDeviceVersion.count({ where: { workspaceId: s.ws } }))).toBe(0); expect((await request(`${s.sync}/commands`, other.token, "POST", { ...s.command, deviceId, opId: randomUUID(), entityId: randomUUID() })).status).toBe(404); });
    it("blocks unknown/foreign/revoked devices and disabled/hybrid-off capability", async () => { const s = await setup(); expect((await s.send({ ...s.command, deviceId: randomUUID() })).status).toBe(403); await request(`/sync/devices/${s.deviceId}`, s.token, "DELETE"); expect((await s.send(s.command)).status).toBe(403); const second = await setup(); await request(`/workspaces/${second.ws}/plugins/finance-device-sync`, second.token, "PATCH", { enabled: false }); expect((await second.send(second.command)).status).toBe(409); expect((await request(`${second.path}/accounts`, second.token)).status).toBe(200); });
    it("refuses unsupported currency, invalid amounts and complex operations", async () => { const s = await setup(); expect((await s.send({ ...s.command, input: { ...s.command.input, amount: 2147483648 } })).status).toBe(400); await request(`${s.path}/accounts/${s.account}`, s.token, "PATCH", { currency: "USD" }); expect((await s.send(s.command)).data.code).toBe("unsupported_currency"); await request(`${s.path}/accounts/${s.account}`, s.token, "PATCH", { currency: "RUB" }); await s.send(s.command); const revision = (await s.snapshot()).data.transactions[0].revision; await request(`${s.path}/transactions/${s.command.entityId}`, s.token, "PATCH", { tags: ["Keep metadata"] }); const snap = (await s.snapshot()).data; expect(snap.transactions[0].editable).toBe(false); expect((await s.send({ ...s.command, kind: "update", opId: randomUUID(), expectedRevision: snap.transactions[0].revision })).data.code).toBe("read_only_transaction"); expect(snap.transactions[0].revision).toBeGreaterThan(revision); });
    it("keeps RLS-correct tombstones during account and workspace cascades", async () => { const s = await setup(); await s.send(s.command); await prisma.withUser(s.userId, tx => tx.account.delete({ where: { id: s.account } })); expect(await prisma.withUser(s.userId, tx => tx.financeDeviceVersion.count({ where: { workspaceId: s.ws } }))).toBe(0); expect((await s.snapshot()).data.transactions).toHaveLength(0); expect((await s.send(s.command)).status).toBe(404); });
    it("cannot resurrect a hidden tombstone under a new account", async () => { const s = await setup(); await s.send(s.command); await prisma.withUser(s.userId, tx => tx.account.delete({ where: { id: s.account } })); const other = (await request<{
        id: string;
    }>(`${s.path}/accounts`, s.token, "POST", { name: "Replacement" })).data.id; const result = await s.send({ ...s.command, opId: randomUUID(), input: { ...s.command.input, accountId: other } }); expect(result.status).toBe(409); expect((await s.snapshot()).data.transactions).toHaveLength(0); });
    it("makes linked expenses read-only without importing other modules' internals", async () => { const s = await setup(); await s.send(s.command); await prisma.withUser(s.userId, async (tx) => { const list = await tx.list.create({ data: { workspaceId: s.ws, name: "Synthetic linked list" } }); await tx.listItem.create({ data: { workspaceId: s.ws, listId: list.id, label: "Referenced expense", expenseTransactionId: s.command.entityId } }); }); const snap = (await s.snapshot()).data; expect(snap.transactions[0].editable).toBe(false); expect((await s.send({ protocol: 1, kind: "delete", deviceId: s.deviceId, opId: randomUUID(), entityId: s.command.entityId, expectedRevision: snap.transactions[0].revision })).data.code).toBe("read_only_transaction"); expect((await s.snapshot()).data.transactions).toHaveLength(1); });
    it("bumps both versions when a legacy writer moves a financial line", async () => { const s = await setup(); await s.send(s.command); const second = { ...s.command, opId: randomUUID(), entityId: randomUUID() }; await s.send(second); const before = (await s.snapshot()).data; const line = before.transactions.find(r => r.transaction.id === s.command.entityId)!.transaction.lines[0].id; await prisma.withUser(s.userId, tx => tx.transactionLine.update({ where: { id: line }, data: { transactionId: second.entityId } })); const versions = await prisma.withUser(s.userId, tx => tx.financeDeviceVersion.findMany({ where: { workspaceId: s.ws } })); for (const row of before.transactions)
        expect(versions.find(v => v.entityId === row.transaction.id)!.revision).toBeGreaterThan(row.revision); });
    it("stops receipt replay after membership loss, and rejects mode-off with data intact", async () => { const s = await setup(); await s.send(s.command); await request(`/workspaces/${s.ws}/sync/mode`, s.token, "PUT", { mode: "local" }); expect((await s.send(s.command)).status).toBe(409); expect((await request<Array<unknown>>(`${s.path}/transactions`, s.token)).data).toHaveLength(1); await prisma.asSystem(tx => tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: s.ws, userId: s.userId } } })); expect((await s.send(s.command)).status).toBe(403); await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: s.ws, userId: s.userId, role: "owner" } })); });
    it("rechecks private-account visibility before returning an existing receipt", async () => {
        const s = await setup();
        await request(`${s.path}/accounts/${s.account}`, s.token, "PATCH", { visibility: "workspace" });
        const other = await user("receipt-member");
        await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: s.ws, userId: other.userId, role: "member" } }));
        const deviceId = randomUUID();
        await request("/sync/devices", other.token, "POST", { deviceId, name: "Other phone" });
        const command = { ...s.command, deviceId };
        expect((await request(`${s.sync}/commands`, other.token, "POST", command)).status).toBe(201);
        expect(await prisma.withUser(other.userId, tx => tx.financeDeviceReceipt.count({ where: { workspaceId: s.ws } }))).toBe(1);
        await request(`${s.path}/accounts/${s.account}`, s.token, "PATCH", { visibility: "private" });
        expect(await prisma.withUser(other.userId, tx => tx.financeDeviceReceipt.count({ where: { workspaceId: s.ws } }))).toBe(0);
        expect((await request(`${s.sync}/commands`, other.token, "POST", command)).status).toBe(404);
        expect((await s.snapshot()).data.transactions).toHaveLength(1);
    });
    it("blocks a foreign registered device and a disabled Finance module without deleting data", async () => {
        const s = await setup(), other = await user("foreign-device"), foreignId = randomUUID();
        await request("/sync/devices", other.token, "POST", { deviceId: foreignId, name: "Foreign" });
        expect((await s.send({ ...s.command, deviceId: foreignId })).status).toBe(403);
        await s.send(s.command);
        expect((await request(`/workspaces/${s.ws}/modules/finance`, s.token, "PATCH", { enabled: false, confirm: true })).status).toBe(200);
        expect((await s.send(s.command)).status).toBe(409);
        expect(await prisma.withUser(s.userId, tx => tx.transaction.count({ where: { workspaceId: s.ws } }))).toBe(1);
    });
    it.skipIf(process.env.FINANCE_MIGRATION_ACCEPTANCE !== "1")("backfills a populated database without changing financial rows, then rolls DDL back", async () => {
        const url = process.env.DATABASE_URL!;
        if (!/^\/orion_finance_device_[a-z0-9_]+$/.test(new URL(url).pathname))
            throw new Error("Migration acceptance requires its dedicated fixture database");
        const s = await setup();
        await s.send(s.command);
        const before = (await s.snapshot()).data;
        const admin = new pg.Client({ connectionString: url });
        await admin.connect();
        try {
            await admin.query("BEGIN");
            const rowsBefore = (await admin.query('SELECT * FROM finance_transactions WHERE "workspaceId"=$1', [s.ws])).rows;
            const linesBefore = (await admin.query('SELECT * FROM finance_transaction_lines WHERE "workspaceId"=$1 ORDER BY id', [s.ws])).rows;
            await admin.query('DROP TRIGGER finance_device_header_version ON finance_transactions; DROP TRIGGER finance_device_line_version ON finance_transaction_lines; DROP FUNCTION finance_device_bump_version(); DROP TABLE finance_device_receipts; DROP TABLE finance_device_versions;');
            await admin.query(readFileSync(resolve(__dirname, "../prisma/migrations/20261026180000_finance_device_replication/migration.sql"), "utf8"));
            expect((await admin.query('SELECT * FROM finance_transactions WHERE "workspaceId"=$1', [s.ws])).rows).toEqual(rowsBefore);
            expect((await admin.query('SELECT * FROM finance_transaction_lines WHERE "workspaceId"=$1 ORDER BY id', [s.ws])).rows).toEqual(linesBefore);
            expect((await admin.query('SELECT revision,deleted FROM finance_device_versions WHERE "workspaceId"=$1', [s.ws])).rows).toEqual([{ revision: 1, deleted: false }]);
            expect((await admin.query('SELECT count(*)::int AS missing FROM finance_transactions t WHERE NOT EXISTS (SELECT 1 FROM finance_device_versions v WHERE v."workspaceId"=t."workspaceId" AND v."entityId"=t.id)')).rows[0].missing).toBe(0);
        }
        finally {
            await admin.query("ROLLBACK");
            await admin.end();
        }
        const after = (await s.snapshot()).data;
        expect(after.transactions).toEqual(before.transactions);
        expect(after.accounts).toEqual(before.accounts);
        expect((await s.send(s.command)).status).toBe(201);
    });
});
