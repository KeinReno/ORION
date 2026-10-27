import type { ReplicaStatus } from "@orion/core";

/** The connection screen owns explanations; lists show only actionable counts. */
export function syncSummary(status?: ReplicaStatus) {
  if (!status) return null;
  if (status.phase === "revoked") return { label: "Доступ приостановлен", tone: "attention" };
  if (status.conflicts) return { label: `Конфликты: ${status.conflicts}`, tone: "attention" };
  if (status.pending) return { label: `В очереди: ${status.pending}`, tone: "pending" };
  return null;
}
