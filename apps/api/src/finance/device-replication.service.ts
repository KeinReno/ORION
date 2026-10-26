import { createHash, randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { FINANCE_DEVICE_CAPABILITY, financeDeviceCommandSchema, financeDeviceResultSchema, financeDeviceSnapshotSchema, type FinanceDeviceCommand, type FinanceDeviceResult } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { PluginsService } from "../plugins/plugins.service";
import { FinanceDeviceReplication } from "./public/device-replication";
import { TransactionsService, toDto } from "./transactions/transactions.service";
import { BudgetAlertsService } from "./budget-alerts.service";
import { computeNetByAccount } from "./finance-refs.util";
import { ListExpenseReferences } from "../lists/public/expense-references.module";
import { HomePaymentReferences } from "../home-utilities/public/payment-references.module";
type Tx = Prisma.TransactionClient;
function fail(code: string, message: string): never { throw new ConflictException({ code, message }); }
function canonical(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    return JSON.stringify(value);
}
function simple(row: Prisma.TransactionGetPayload<{
    include: {
        lines: true;
    };
}>): boolean {
    return row.type !== "transfer" && row.lines.length === 1 && !row.reconciledAt && !row.importedRef
        && !row.recurringRuleId && !row.projectId && row.tags.length === 0 && row.mergedRefs.length === 0;
}
@Injectable()
export class FinanceDeviceReplicationService extends FinanceDeviceReplication {
    constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly plugins: PluginsService, private readonly transactions: TransactionsService, private readonly alerts: BudgetAlertsService, private readonly listReferences: ListExpenseReferences, private readonly homeReferences: HomePaymentReferences) { super(); }
    private async linked(tx: Tx, workspaceId: string, ids: string[]) {
        const lists = await this.listReferences.idsTx(tx, workspaceId, ids);
        const payments = await this.homeReferences.idsTx(tx, workspaceId, ids);
        const trades = await tx.investmentTrade.findMany({ where: { workspaceId, feeTransactionId: { in: ids } }, select: { feeTransactionId: true } });
        return new Set([...lists, ...payments, ...trades.map(t => t.feeTransactionId!)]);
    }
    private async authorize(tx: Tx, userId: string, workspaceId: string, deviceId?: string) {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await tx.$queryRaw `SELECT id FROM workspaces WHERE id=${workspaceId} FOR SHARE`;
        await this.plugins.assertEnabledTx(tx, userId, workspaceId, "finance-device-sync");
        const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { syncMode: true } });
        if (ws.syncMode !== "hybrid")
            fail("sync_mode_not_hybrid", "Включите гибридный режим пространства");
        if (deviceId) {
            await tx.$queryRaw `SELECT id FROM sync_devices WHERE id=${deviceId} AND "userId"=${userId} FOR SHARE`;
            const device = await tx.syncDevice.findUnique({ where: { id: deviceId } });
            if (!device || device.userId !== userId)
                throw new ForbiddenException("Устройство не зарегистрировано");
            if (device.revokedAt)
                throw new ForbiddenException("Устройство отозвано");
        }
    }
    async capability(userId: string, workspaceId: string) {
        await this.prisma.withUser(userId, tx => this.authorize(tx, userId, workspaceId));
        return { capability: FINANCE_DEVICE_CAPABILITY, protocol: 1 as const, snapshot: "full" as const };
    }
    async snapshot(userId: string, workspaceId: string, deviceId: string) {
        return this.prisma.withUser(userId, async (tx) => {
            await this.authorize(tx, userId, workspaceId, deviceId);
            const accounts = await tx.account.findMany({ where: { workspaceId }, orderBy: { id: "asc" }, take: 1001 });
            const ids = accounts.map(a => a.id);
            const categories = await tx.financeCategory.findMany({ where: { workspaceId }, orderBy: { id: "asc" }, take: 5001 });
            if (accounts.length > 1000 || categories.length > 5000)
                throw new PayloadTooLargeException("Финансовая копия превышает предел v1");
            const rows = await tx.transaction.findMany({ where: { workspaceId, accountId: { in: ids }, OR: [{ toAccountId: null }, { toAccountId: { in: ids } }] }, include: { lines: true }, orderBy: { id: "asc" }, take: 10001 });
            if (rows.length > 10000 || accounts.length > 1000 || categories.length > 5000)
                throw new PayloadTooLargeException("Финансовая копия превышает предел v1");
            const versions = await tx.financeDeviceVersion.findMany({ where: { workspaceId, entityId: { in: rows.map(r => r.id) } } });
            const revisions = new Map(versions.map(v => [v.entityId, v.revision]));
            const linked = await this.linked(tx, workspaceId, rows.map(r => r.id));
            const net = await computeNetByAccount(tx, workspaceId);
            const snapshot = financeDeviceSnapshotSchema.parse({ protocol: 1, capability: FINANCE_DEVICE_CAPABILITY, workspaceId,
                snapshotId: randomUUID(), complete: true, asOf: new Date().toISOString(),
                accounts: accounts.map(a => ({ ...a, balance: a.startingBalance + (net.get(a.id) ?? 0), archivedAt: a.archivedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
                categories: categories.map(c => ({ ...c, archivedAt: c.archivedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() })),
                transactions: rows.map(row => ({ transaction: toDto(row), revision: revisions.get(row.id), editable: simple(row) && !linked.has(row.id) && accounts.find(a => a.id === row.accountId)?.currency === "RUB" })),
            });
            if (Buffer.byteLength(JSON.stringify(snapshot)) > 8 * 1024 * 1024)
                throw new PayloadTooLargeException("Финансовая копия превышает предел v1");
            return snapshot;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }
    async command(userId: string, workspaceId: string, raw: FinanceDeviceCommand): Promise<FinanceDeviceResult> {
        const input = financeDeviceCommandSchema.parse(raw);
        const hash = createHash("sha256").update(canonical(input)).digest("hex");
        const committed = await this.prisma.withUser(userId, async (tx) => {
            await this.authorize(tx, userId, workspaceId, input.deviceId);
            // Receipt key and entity key are separate: concurrent reuse of one opId for
            // another entity must serialize before any domain write.
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([workspaceId, userId, input.deviceId, input.opId])},0))`;
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([workspaceId, input.entityId])},1))`;
            const receipt = await tx.financeDeviceReceipt.findUnique({ where: { workspaceId_userId_deviceId_opId: { workspaceId, userId, deviceId: input.deviceId, opId: input.opId } } });
            if (receipt) {
                if (receipt.bodyHash !== hash)
                    fail("op_body_mismatch", "Этот ID уже использован другой командой");
                return { result: financeDeviceResultSchema.parse(receipt.result), alerts: [] };
            }
            // Lock the canonical header so legacy desktop writers serialize with CAS.
            await tx.$queryRaw `SELECT id FROM finance_transactions WHERE id=${input.entityId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
            const current = await tx.transaction.findFirst({ where: { id: input.entityId, workspaceId }, include: { lines: true } });
            await tx.$queryRaw `SELECT "entityId" FROM finance_device_versions WHERE "workspaceId"=${workspaceId} AND "entityId"=${input.entityId} FOR UPDATE`;
            const version = await tx.financeDeviceVersion.findUnique({ where: { workspaceId_entityId: { workspaceId, entityId: input.entityId } } });
            if (input.kind === "create") {
                if (current || version)
                    fail("entity_exists", "ID операции уже использован");
            }
            else {
                if (!current || !version || version.deleted)
                    throw new NotFoundException("Операция недоступна или удалена");
                if (version.revision !== input.expectedRevision)
                    fail("revision_conflict", "Операция изменена на другом устройстве. Обновите копию.");
                if (!simple(current))
                    fail("read_only_transaction", "Эта операция доступна только для просмотра");
                if ((await this.linked(tx, workspaceId, [current.id])).has(current.id))
                    fail("read_only_transaction", "Операция связана с другим модулем и доступна только для просмотра");
            }
            const accountId = input.kind === "delete" ? current!.accountId : input.input.accountId;
            // Row lock makes privacy/archive changes serialize with this authorization.
            await tx.$queryRaw `SELECT id FROM finance_accounts WHERE id=${accountId} AND "workspaceId"=${workspaceId} FOR SHARE`;
            const account = await tx.account.findFirst({ where: { id: accountId, workspaceId, archivedAt: null } });
            if (!account)
                throw new NotFoundException("Счёт недоступен или архивирован");
            if (account.currency !== "RUB")
                fail("unsupported_currency", "В первой версии доступны операции в RUB");
            let alerts: Awaited<ReturnType<BudgetAlertsService["evaluate"]>> = [];
            // Reserve before inserting the header. The unique key also sees hidden
            // tombstones (for example after a private account was deleted).
            if (input.kind === "create")
                await tx.financeDeviceVersion.create({ data: { workspaceId, entityId: input.entityId, accountId } });
            if (input.kind === "delete")
                await tx.transaction.delete({ where: { id: input.entityId } });
            else {
                await tx.$queryRaw `SELECT id FROM finance_categories WHERE id=${input.input.categoryId} AND "workspaceId"=${workspaceId} FOR SHARE`;
                const category = await tx.financeCategory.findFirst({ where: { id: input.input.categoryId, workspaceId, kind: input.input.type, archivedAt: null } });
                if (!category)
                    throw new NotFoundException("Категория недоступна или не подходит к типу операции");
                const values = { tags: [], accountId, type: input.input.type, note: input.input.note, occurredAt: input.input.occurredAt, lines: [{ categoryId: category.id, amount: input.input.amount }] };
                const result = input.kind === "create" ? await this.transactions.createTx(tx, workspaceId, values, input.entityId)
                    : await this.transactions.updateTx(tx, workspaceId, input.entityId, values);
                alerts = result.alerts;
            }
            const next = await tx.financeDeviceVersion.findUniqueOrThrow({ where: { workspaceId_entityId: { workspaceId, entityId: input.entityId } } });
            const result = financeDeviceResultSchema.parse({ protocol: 1, opId: input.opId, entityId: input.entityId, outcome: input.kind === "delete" ? "deleted" : "applied", revision: next.revision });
            await tx.financeDeviceReceipt.create({ data: { workspaceId, userId, deviceId: input.deviceId, opId: input.opId, entityId: input.entityId, accountId, bodyHash: hash, result } });
            return { result, alerts };
        }).catch(error => {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
                fail("operation_conflict", "ID операции уже использован");
            if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.meta?.code === "40P01"))
                fail("concurrent_write", "Конкурентная запись. Обновите копию и повторите команду с тем же ID.");
            throw error;
        });
        await this.alerts.deliver(committed.alerts);
        return committed.result;
    }
}
