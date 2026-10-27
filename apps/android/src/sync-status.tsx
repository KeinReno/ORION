import { AlertCircle, CloudUpload } from "lucide-react";
import type { useLan } from "./use-lan";
import { syncSummary } from "./sync-summary";

export function SyncStatus({ connection, remoteActive, finance, open }: { connection: ReturnType<typeof useLan>; remoteActive: boolean; finance: boolean; localCount: number; open: () => void }) {
  if (!connection.state?.paired || finance || !remoteActive) return null;
  const summary = syncSummary(connection.client?.engine.status());
  if (!summary) return null;
  const Icon = summary.tone === "attention" ? AlertCircle : CloudUpload;
  return <button className="sync-summary" data-tone={summary.tone} aria-label={`${summary.label}. Открыть связь и обмен`} onClick={open}>
    <Icon size={16} aria-hidden="true" /><span role="status">{summary.label}</span>
  </button>;
}
