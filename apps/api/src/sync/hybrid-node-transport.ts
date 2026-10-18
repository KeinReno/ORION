import type { SyncTransport } from "@orion/core/src/sync/replica-types";
import {
  SYNC_PROTOCOL_VERSION,
  type PushSyncOpsInput,
  type PushSyncOpsResult,
  type RegisterSyncDeviceInput,
  type ReplicaPull,
  type ReplicaSnapshot
} from "@orion/shared-types";
import type { HybridSyncService } from "./hybrid-sync.service";

/**
 * ADR-0020: `SyncTransport` авторитетного узла для `RelayIngress`. Каждый вызов идёт в те же методы
 * `HybridSyncService`, что и REST (`withUser`, членство, режим `hybrid`, RLS, идемпотентность) — от имени
 * пользователя, к которому привязано Link-устройство. Ничего своего в этом слое нет, намеренно.
 */
export function hybridNodeTransport(
  hybrid: Pick<HybridSyncService, "registerDevice" | "snapshot" | "pull" | "push">,
  userId: string
): SyncTransport {
  return {
    registerDevice: async (input: RegisterSyncDeviceInput) => void (await hybrid.registerDevice(userId, input)),
    snapshot: (workspaceId: string): Promise<ReplicaSnapshot> => hybrid.snapshot(userId, workspaceId, SYNC_PROTOCOL_VERSION),
    pull: (workspaceId: string, cursor: string): Promise<ReplicaPull> =>
      hybrid.pull(userId, workspaceId, cursor, SYNC_PROTOCOL_VERSION),
    push: (workspaceId: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult> => hybrid.push(userId, workspaceId, input)
  };
}
