import { describe, expect, it } from "vitest";
import { financeDeviceCommandSchema } from "./finance-device-sync";
const command = { protocol: 1, kind: "create", deviceId: "00000000-0000-4000-8000-000000000001", opId: "00000000-0000-4000-8000-000000000002", entityId: "00000000-0000-4000-8000-000000000003", input: { accountId: "00000000-0000-4000-8000-000000000004", categoryId: "00000000-0000-4000-8000-000000000005", type: "expense", amount: 12345, occurredAt: "2026-10-26T12:00:00.000Z", note: "Synthetic" } };
describe("finance device v1 contract", () => {
    it("does not accept authority overrides, transfers or fractional/overflow money", () => {
        expect(financeDeviceCommandSchema.safeParse(command).success).toBe(true);
        for (const value of [{ ...command, workspaceId: "other" }, { ...command, userId: "other" }, { ...command, input: { ...command.input, type: "transfer" } }, { ...command, input: { ...command.input, amount: 1.5 } }, { ...command, input: { ...command.input, amount: 2147483648 } }])
            expect(financeDeviceCommandSchema.safeParse(value).success).toBe(false);
    });
    it("requires a current revision for update/delete and rejects unknown protocol", () => {
        expect(financeDeviceCommandSchema.safeParse({ ...command, protocol: 2 }).success).toBe(false);
        expect(financeDeviceCommandSchema.safeParse({ ...command, kind: "update" }).success).toBe(false);
        expect(financeDeviceCommandSchema.safeParse({ ...command, kind: "update", expectedRevision: 1 }).success).toBe(true);
        expect(financeDeviceCommandSchema.safeParse({ protocol: 1, kind: "delete", deviceId: command.deviceId, opId: command.opId, entityId: command.entityId, expectedRevision: 0 }).success).toBe(false);
    });
});
