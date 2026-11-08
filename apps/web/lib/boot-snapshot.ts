import type { QueryClient } from "@tanstack/react-query";
import { sessionUserSchema, workspaceSchema, type SessionUser, type Workspace } from "@orion/shared-types";

/**
 * A new OS window starts with an empty React Query cache, so it waits for
 * /auth/me and the workspace list before a section can ask for its own data.
 * The main window already has both. This snapshot lets the new window paint
 * from that copy and refresh it in the background.
 * Tokens are not stored here.
 */
const SESSION_KEY = "orion.boot.session.v1";
const WORKSPACES_KEY = "orion.boot.workspaces.v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is { at: number; data: unknown } {
  if (!value || typeof value !== "object" || !("data" in value)) return false;
  const at = (value as { at?: unknown }).at;
  return typeof at === "number" && Number.isFinite(at);
}

export interface BootSnapshot {
  session: { at: number; data: SessionUser } | null;
  workspaces: { at: number; data: Workspace[] } | null;
}

function readRecord(storage: Storage, key: string, now: number): { at: number; data: unknown } | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return null;
    const { at, data } = parsed;
    if (!Number.isFinite(at) || at > now || now - at > MAX_AGE_MS) return null;
    return { at, data };
  } catch {
    return null;
  }
}

export function readBootSnapshot(storage: Storage, now = Date.now()): BootSnapshot {
  let session: BootSnapshot["session"] = null;
  let workspaces: BootSnapshot["workspaces"] = null;
  try {
    const sessionRecord = readRecord(storage, SESSION_KEY, now);
    const sessionParsed = sessionRecord ? sessionUserSchema.safeParse(sessionRecord.data) : null;
    if (sessionRecord && sessionParsed?.success) session = { at: sessionRecord.at, data: sessionParsed.data };
    const workspaceRecord = readRecord(storage, WORKSPACES_KEY, now);
    const workspaceParsed = workspaceRecord ? workspaceSchema.array().safeParse(workspaceRecord.data) : null;
    if (workspaceRecord && workspaceParsed?.success) workspaces = { at: workspaceRecord.at, data: workspaceParsed.data };
  } catch {
    return { session: null, workspaces: null };
  }
  return { session, workspaces };
}

export function writeBootSnapshot(storage: Storage, snapshot: BootSnapshot): void {
  try {
    if (snapshot.session) storage.setItem(SESSION_KEY, JSON.stringify(snapshot.session));
    else storage.removeItem(SESSION_KEY);
    if (snapshot.workspaces) storage.setItem(WORKSPACES_KEY, JSON.stringify(snapshot.workspaces));
    else storage.removeItem(WORKSPACES_KEY);
  } catch {
    // A window without storage just waits for the network, as before.
  }
}

export function clearBootSnapshot(storage: Storage): void {
  writeBootSnapshot(storage, { session: null, workspaces: null });
}

/** Puts a still-valid snapshot into a fresh query cache, keeping its original time so a stale copy is refreshed. */
export function applyBootSnapshot(client: QueryClient, storage: Storage, now = Date.now()): void {
  const snapshot = readBootSnapshot(storage, now);
  if (snapshot.session) client.setQueryData(["session"], snapshot.session.data, { updatedAt: snapshot.session.at });
  if (snapshot.workspaces) client.setQueryData(["workspaces"], snapshot.workspaces.data, { updatedAt: snapshot.workspaces.at });
}

/** Remembers successful session and workspace reads, and drops them when the session fails. */
export function attachBootSnapshot(client: QueryClient, storage: Storage): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const key = event.query.queryKey[0];
    const state = event.query.state;
    if (key === "session" && state.status === "error") {
      clearBootSnapshot(storage);
      return;
    }
    if (state.status !== "success" || state.data == null) return;
    const current = readBootSnapshot(storage);
    if (key === "session") {
      const parsed = sessionUserSchema.safeParse(state.data);
      if (parsed.success) writeBootSnapshot(storage, { ...current, session: { at: state.dataUpdatedAt, data: parsed.data } });
    } else if (key === "workspaces") {
      const parsed = workspaceSchema.array().safeParse(state.data);
      if (parsed.success) writeBootSnapshot(storage, { ...current, workspaces: { at: state.dataUpdatedAt, data: parsed.data } });
    }
  });
}
