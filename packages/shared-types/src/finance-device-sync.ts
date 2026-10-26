import { z } from "zod";
import { accountSchema, financeCategorySchema, transactionSchema } from "./finance";
export const FINANCE_DEVICE_CAPABILITY = "finance.device-sync.v1" as const;
const revision = z.number().int().positive().safe();
const input = z.object({
    accountId: z.string().uuid(), categoryId: z.string().uuid(), type: z.enum(["income", "expense"]),
    amount: z.number().int().positive().max(2147483647), occurredAt: z.string().datetime(), note: z.string().max(20000),
}).strict();
const base = { protocol: z.literal(1), deviceId: z.string().uuid(), opId: z.string().uuid(), entityId: z.string().uuid() };
export const financeDeviceCommandSchema = z.discriminatedUnion("kind", [
    z.object({ ...base, kind: z.literal("create"), input }).strict(),
    z.object({ ...base, kind: z.literal("update"), expectedRevision: revision, input }).strict(),
    z.object({ ...base, kind: z.literal("delete"), expectedRevision: revision }).strict(),
]);
export type FinanceDeviceCommand = z.infer<typeof financeDeviceCommandSchema>;
export const financeDeviceResultSchema = z.object({
    protocol: z.literal(1), opId: z.string().uuid(), entityId: z.string().uuid(),
    outcome: z.enum(["applied", "deleted"]), revision,
});
export type FinanceDeviceResult = z.infer<typeof financeDeviceResultSchema>;
export const financeDeviceSnapshotSchema = z.object({
    protocol: z.literal(1), capability: z.literal(FINANCE_DEVICE_CAPABILITY), workspaceId: z.string(),
    snapshotId: z.string().uuid(), asOf: z.string(), complete: z.literal(true),
    accounts: z.array(accountSchema), categories: z.array(financeCategorySchema),
    transactions: z.array(z.object({ transaction: transactionSchema, revision, editable: z.boolean() })),
});
export type FinanceDeviceSnapshot = z.infer<typeof financeDeviceSnapshotSchema>;
