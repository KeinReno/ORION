import { QueryClient } from "@tanstack/react-query";
import type { SessionUser, Workspace } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { applyBootSnapshot, bootAccessSubject, clearBootSnapshot, readBootSnapshot, writeBootSnapshot } from "./boot-snapshot";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value)
  };
}

const user = {
  id: "user-1",
  email: "a@b.c",
  name: "Аня",
  unlockKind: "password",
  hasAvatar: false,
  passwordStrength: 2,
  passwordChangedAt: null
} satisfies SessionUser;

const space = {
  id: "ws-1",
  name: "Дом",
  role: "owner",
  disabledModules: [],
  pluginOverrides: [],
  restrictedModules: [],
  isPersonal: true,
  theme: null
} satisfies Workspace;

function token(sub: string, exp?: number): string {
  const json = JSON.stringify(exp === undefined ? { sub } : { sub, exp });
  const body = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `e.${body}.s`;
}

describe("boot snapshot", () => {
  it("round-trips a session and a workspace list, and drops a stale copy", () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writeBootSnapshot(storage, {
      session: { at: now - 1000, data: user },
      workspaces: { at: now - 1000, userId: user.id, data: [space] }
    });
    expect(readBootSnapshot(storage, now)).toEqual({
      session: { at: now - 1000, data: user },
      workspaces: { at: now - 1000, userId: user.id, data: [space] }
    });
    expect(readBootSnapshot(storage, now + 3 * 60 * 1000)).toEqual({ session: null, workspaces: null });
  });

  it("ignores a snapshot that does not match the contract", () => {
    const storage = memoryStorage();
    storage.setItem("orion.boot.session.v1", JSON.stringify({ at: Date.now(), data: { id: "x" } }));
    expect(readBootSnapshot(storage).session).toBeNull();
  });

  it("paints only the user who still holds a live access token", () => {
    const storage = memoryStorage();
    const at = Date.now() - 60_000;
    storage.setItem("orion.auth.accessToken", token(user.id, Math.floor(Date.now() / 1000) + 60));
    writeBootSnapshot(storage, { session: { at, data: user }, workspaces: { at, userId: user.id, data: [space] } });
    const client = new QueryClient();
    applyBootSnapshot(client, storage);
    expect(client.getQueryData(["session"])).toEqual(user);
    expect(client.getQueryData(["workspaces"])).toEqual([space]);
    expect(client.getQueryState(["session"])?.dataUpdatedAt).toBe(0);
  });

  it("drops another person's spaces and an expired session", () => {
    const storage = memoryStorage();
    const now = Date.now();
    storage.setItem("orion.auth.accessToken", token("user-2", Math.floor(now / 1000) + 60));
    writeBootSnapshot(storage, { session: { at: now, data: user }, workspaces: { at: now, userId: user.id, data: [space] } });
    const client = new QueryClient();
    applyBootSnapshot(client, storage, now);
    expect(client.getQueryData(["session"])).toBeUndefined();
    expect(client.getQueryData(["workspaces"])).toBeUndefined();
    expect(readBootSnapshot(storage, now)).toEqual({ session: null, workspaces: null });

    storage.setItem("orion.auth.accessToken", token(user.id, Math.floor(now / 1000) - 5));
    writeBootSnapshot(storage, { session: { at: now, data: user }, workspaces: { at: now, userId: user.id, data: [space] } });
    expect(bootAccessSubject(storage.getItem("orion.auth.accessToken"), now)).toBeNull();
    applyBootSnapshot(client, storage, now);
    expect(readBootSnapshot(storage, now)).toEqual({ session: null, workspaces: null });
    clearBootSnapshot(storage);
  });
});
