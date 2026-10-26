import type { FinanceDeviceCommand, FinanceDeviceResult, FinanceDeviceSnapshot } from "@orion/shared-types";

/** Finance-owned channel; caller cannot provide a different user's transaction/RLS context. */
export abstract class FinanceDeviceReplication {
  abstract capability(userId: string, workspaceId: string): Promise<{ capability: "finance.device-sync.v1"; protocol: 1; snapshot: "full" }>;
  abstract snapshot(userId: string, workspaceId: string, deviceId: string): Promise<FinanceDeviceSnapshot>;
  abstract command(userId: string, workspaceId: string, input: FinanceDeviceCommand): Promise<FinanceDeviceResult>;
}
