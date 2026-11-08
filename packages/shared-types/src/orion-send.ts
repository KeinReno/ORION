import { z } from "zod";

/**
 * Orion Send — прямая передача между двумя самостоятельными узлами.
 * Не Hybrid Sync и не режим Host/Client: слушатель отдаёт только этот протокол.
 * Мажорная версия 1. Следующая мажорная не должна молча приниматься как эта.
 */
export const SEND_PROTOCOL_VERSION = 1;
export const SEND_SERVICE_TYPE = "orion-send";
export const SEND_DEFAULT_PORT = 4455;
export const SEND_TOKEN_HEADER = "x-orion-device";
export const SEND_REQUEST_HEADER = "x-orion-request-id";
export const SEND_VERSION_HEADER = "x-orion-send-version";
export const SEND_CHUNK_BYTES = 1024 * 1024;

export const SEND_TRANSFER_STATUSES = [
  "pending",
  "accepted",
  "transferring",
  "paused",
  "verifying",
  "completed",
  "rejected",
  "cancelled",
  "failed"
] as const;

export const sendTransferStatusSchema = z.enum(SEND_TRANSFER_STATUSES);
export type SendTransferStatus = z.infer<typeof sendTransferStatusSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const sendInfoSchema = z.object({
  protocol: z.number().int(),
  nodeId: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  features: z.array(z.string())
});
export type SendInfo = z.infer<typeof sendInfoSchema>;

export const sendManifestFileSchema = z.object({
  relativePath: z.string().min(1).max(240),
  size: z.number().int().nonnegative(),
  sha256: sha256Schema
});

export const sendManifestSchema = z.object({
  protocol: z.literal(SEND_PROTOCOL_VERSION),
  transferId: z.string().uuid(),
  files: z.array(sendManifestFileSchema).min(1).max(5000)
});
export type SendManifest = z.infer<typeof sendManifestSchema>;

export const sendTransferFileSchema = z.object({
  index: z.number().int().nonnegative(),
  relativePath: z.string(),
  size: z.number().int().nonnegative(),
  sha256: sha256Schema,
  receivedBytes: z.number().int().nonnegative(),
  state: z.enum(["pending", "transferring", "verified", "failed"])
});

export const sendTransferSchema = z.object({
  transferId: z.string(),
  sourceDeviceId: z.string(),
  targetDeviceId: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  status: sendTransferStatusSchema,
  files: z.array(sendTransferFileSchema),
  totalBytes: z.number().int().nonnegative(),
  transferredBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  peerName: z.string(),
  error: z.string().nullable(),
  bytesPerSecond: z.number().nonnegative(),
  channel: z.enum(["orion", "localsend"])
});
export type SendTransfer = z.infer<typeof sendTransferSchema>;

export const sendPeerSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  address: z.string().nullable(),
  port: z.number().int().nullable(),
  online: z.boolean(),
  trusted: z.boolean(),
  mutual: z.boolean(),
  revoked: z.boolean(),
  channel: z.enum(["orion", "localsend"]),
  compatible: z.boolean()
});
export type SendPeer = z.infer<typeof sendPeerSchema>;

export const sendStatusSchema = z.object({
  enabled: z.boolean(),
  listening: z.boolean(),
  port: z.number().int(),
  nodeId: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  downloadDir: z.string(),
  maxParallel: z.number().int(),
  localSendCompat: z.boolean(),
  localSendListen: z.boolean(),
  error: z.string().nullable()
});
export type SendStatus = z.infer<typeof sendStatusSchema>;

export const sendEnableInputSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(0).max(65535).optional(),
  downloadDir: z.string().trim().min(1).max(500).optional(),
  maxParallel: z.number().int().min(1).max(4).optional(),
  localSendCompat: z.boolean().optional()
});
export type SendEnableInput = z.infer<typeof sendEnableInputSchema>;

export const sendPairInputSchema = z.object({
  address: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  deviceName: z.string().trim().min(1).max(80)
});
export type SendPairInput = z.infer<typeof sendPairInputSchema>;

export const sendPairingSchema = z.object({
  requestId: z.string(),
  code: z.string(),
  status: z.enum(["pending", "approved", "denied", "expired", "error"]),
  message: z.string().nullable(),
  peerId: z.string().nullable()
});
export type SendPairing = z.infer<typeof sendPairingSchema>;

export const sendPendingPairSchema = z.object({
  id: z.string(),
  deviceName: z.string(),
  address: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  attemptsLeft: z.number().int()
});
export type SendPendingPair = z.infer<typeof sendPendingPairSchema>;

export const sendAcceptInputSchema = z.object({
  directory: z.string().trim().min(1).max(500).optional()
});
export type SendAcceptInput = z.infer<typeof sendAcceptInputSchema>;

export const sendOutgoingInputSchema = z.object({
  peerId: z.string().min(1),
  batchId: z.string().uuid()
});
export type SendOutgoingInput = z.infer<typeof sendOutgoingInputSchema>;

export const sendPathsInputSchema = z.object({
  peerId: z.string().min(1),
  paths: z.array(z.string().min(1).max(1000)).min(1).max(5000)
});
export type SendPathsInput = z.infer<typeof sendPathsInputSchema>;

export const sendDocumentsInputSchema = z.object({
  peerId: z.string().min(1),
  workspaceId: z.string().min(1),
  documentIds: z.array(z.string().min(1)).min(1).max(100)
});
export type SendDocumentsInput = z.infer<typeof sendDocumentsInputSchema>;

/** Копия заметки или задачи — отдельный файл. Это не синхронизация того же объекта. */
export const sendCopyEnvelopeSchema = z.object({
  kind: z.enum(["note", "task"]),
  sourceId: z.string().min(1).max(80),
  exportedAt: z.string().min(1).max(40),
  payload: z.record(z.unknown())
});
export type SendCopyEnvelope = z.infer<typeof sendCopyEnvelopeSchema>;

export const sendCopyInputSchema = z.object({
  peerId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  envelope: sendCopyEnvelopeSchema
});
export type SendCopyInput = z.infer<typeof sendCopyInputSchema>;

export const sendManualInputSchema = z.object({
  address: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional()
});
export type SendManualInput = z.infer<typeof sendManualInputSchema>;

export const sendStagedSchema = z.object({
  batchId: z.string().uuid(),
  files: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative()
});
export type SendStaged = z.infer<typeof sendStagedSchema>;

/** Контракт экспорта проекта. Применения нет: базу PostgreSQL копировать нельзя. */
export const projectBundleContractSchema = z.object({
  contract: z.literal("orion.project-bundle"),
  contractVersion: z.literal(1),
  sourceWorkspaceId: z.string(),
  projectId: z.string(),
  exportedAt: z.string()
});

/** Имена событий Agent Link. Сейчас их никто не публикует. */
export const AGENT_LINK_EVENT_KINDS = [
  "job.received",
  "file.opened",
  "document.read",
  "object.changed",
  "result.sending",
  "confirmation.waiting"
] as const;

export const agentLinkJobSchema = z.object({
  jobId: z.string(),
  sourceDeviceId: z.string(),
  targetDeviceId: z.string(),
  permissionIds: z.array(z.string()),
  status: z.enum(["draft", "offered", "accepted", "running", "completed", "failed", "cancelled"])
});
export type AgentLinkJob = z.infer<typeof agentLinkJobSchema>;

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Относительный путь внутри каталога приёма. `null` — путь опасный или пустой. */
export function safeRelativePath(input: string): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 240) return null;
  if (input.includes("\0") || input.includes("\\") || input.includes(":")) return null;
  const parts = input.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        part.endsWith(" ") ||
        RESERVED_NAME.test(part)
    )
  ) {
    return null;
  }
  return parts.join("/");
}

export function sendPairingCodeInput(clientNonce: string, serverNonce: string, fingerprint: string): string {
  return `orion-send-pair/v1|${clientNonce}|${serverNonce}|${fingerprint.replace(/:/g, "").toLowerCase()}`;
}
