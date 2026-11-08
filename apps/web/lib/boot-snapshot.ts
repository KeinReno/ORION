import type { QueryClient } from "@tanstack/react-query";
import { sessionUserSchema, workspaceSchema, type SessionUser, type Workspace } from "@orion/shared-types";
import { nodeStoragePrefix, readNodeMark } from "./node-mode";

/**
 * A new OS window starts with an empty React Query cache, so it waits for
 * /auth/me and the workspace list before a section can ask for its own data.
 * The main window already has both. This snapshot lets the new window paint
 * from that copy and refresh it in the background.
 * Tokens are not stored here.
 */
const SESSION_KEY = "orion.boot.session.v1";
const WORKSPACES_KEY = "orion.boot.workspaces.v1";
/** Long enough to open a window, short enough that a finished session cannot paint tomorrow. */
const MAX_AGE_MS = 2 * 60 * 1000;

function isRecord(value: unknown): value is { at: number; data: unknown } {
  if (!value || typeof value !== "object" || !("data" in value)) return false;
  const at = (value as { at?: unknown }).at;
  return typeof at === "number" && Number.isFinite(at);
}

export interface BootSnapshot {
  session: { at: number; data: SessionUser } | null;
  workspaces: { at: number; userId: string; data: Workspace[] } | null;
}

function readRecord(storage: Storage, key: string, now: number): { at: number; userId?: string; data: unknown } | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return null;
    const { at, data } = parsed;
    if (!Number.isFinite(at) || at > now || now - at > MAX_AGE_MS) return null;
    const userId = (parsed as { userId?: unknown }).userId;
    return { at, data, ...(typeof userId === "string" && userId !== "" ? { userId } : {}) };
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
    if (workspaceRecord && workspaceParsed?.success && workspaceRecord.userId) {
      workspaces = { at: workspaceRecord.at, userId: workspaceRecord.userId, data: workspaceParsed.data };
    }
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

/** The same prefixed storage the window uses for the snapshot and the access token. */
export function bootLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  const prefix = nodeStoragePrefix(readNodeMark());
  const inner = window.localStorage;
  return {
    get length() {
      return inner.length;
    },
    clear: () => inner.clear(),
    key: (index) => inner.key(index),
    getItem: (key) => inner.getItem(prefix + key),
    setItem: (key, value) => inner.setItem(prefix + key, value),
    removeItem: (key) => inner.removeItem(prefix + key)
  };
}

/** Logout, user switch and a dead session drop the painted copy immediately. */
export function discardBootSnapshot(): void {
  const storage = bootLocalStorage();
  if (storage) clearBootSnapshot(storage);
}

/** The access token's subject. A missing or expired token means the snapshot must not paint. */
export function bootAccessSubject(token: string | null, now = Date.now()): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="))) as { sub?: unknown; exp?: unknown };
    if (typeof json.sub !== "string" || json.sub === "") return null;
    if (typeof json.exp === "number" && json.exp * 1000 <= now) return null;
    return json.sub;
  } catch {
    return null;
  }
}

/** Puts a still-valid snapshot into a fresh query cache. The copy stays stale, so the server confirms it at once. */
export function applyBootSnapshot(client: QueryClient, storage: Storage, now = Date.now()): void {
  const subject = bootAccessSubject(storage.getItem("orion.auth.accessToken"), now);
  if (!subject) {
    clearBootSnapshot(storage);
    return;
  }
  const snapshot = readBootSnapshot(storage, now);
  if (!snapshot.session || snapshot.session.data.id !== subject) {
    clearBootSnapshot(storage);
    return;
  }
  client.setQueryData(["session"], snapshot.session.data, { updatedAt: 0 });
  if (snapshot.workspaces?.userId === subject) client.setQueryData(["workspaces"], snapshot.workspaces.data, { updatedAt: 0 });
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
      if (!parsed.success) return;
      const switched = current.session !== null && current.session.data.id !== parsed.data.id;
      writeBootSnapshot(storage, {
        session: { at: state.dataUpdatedAt, data: parsed.data },
        workspaces: switched ? null : current.workspaces
      });
    } else if (key === "workspaces") {
      const parsed = workspaceSchema.array().safeParse(state.data);
      const userId = current.session?.data.id;
      if (parsed.success && userId) writeBootSnapshot(storage, { ...current, workspaces: { at: state.dataUpdatedAt, userId, data: parsed.data } });
    }
  });
}
