/**
 * DELETE tool arguments travel in the query (`buildAgentToolRequest`), while module controllers read `reason` from the
 * JSON body and task/note/event deletes read `@Query("reason")`. One copy, applied before pipes, makes either reader
 * see a reason that arrived in only one of those places. An empty string is "not given", so it does not wipe the other
 * side. When both are set, the query wins: that is the DELETE channel of the agent tool contract.
 */
export interface AgentDeleteReasonRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  query?: Record<string, unknown> | null;
  body?: unknown;
}

export function readAgentDeleteReason(source: { query?: unknown; body?: unknown }): string | undefined {
  return reasonText(field(source.query, "reason")) ?? reasonText(field(source.body, "reason"));
}

export function applyAgentDeleteReason(req: AgentDeleteReasonRequest): void {
  if (!isAgentV1Delete(req)) return;
  const reason = readAgentDeleteReason(req);
  if (reason === undefined) return;
  if (!req.query || typeof req.query !== "object") req.query = {};
  req.query.reason = reason;
  if (isRecord(req.body)) req.body.reason = reason;
  else req.body = { reason };
}

function isAgentV1Delete(req: AgentDeleteReasonRequest): boolean {
  if (req.method !== "DELETE") return false;
  // originalUrl is the client path. `path` is only a fallback: after a mount it can be relative and would miss `/ai/v1`.
  const path = (req.originalUrl ?? req.url ?? req.path ?? "").split("?")[0] ?? "";
  return path === "/ai/v1" || path.startsWith("/ai/v1/");
}

function reasonText(value: unknown): string | undefined {
  if (Array.isArray(value)) return reasonText(value[0]);
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

function field(container: unknown, key: string): unknown {
  if (!isRecord(container)) return undefined;
  return container[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
