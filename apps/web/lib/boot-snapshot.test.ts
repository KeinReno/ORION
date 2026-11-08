import { QueryClient } from "@tanstack/react-query";
import type { SessionUser, Workspace } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { applyBootSnapshot, clearBootSnapshot, readBootSnapshot, writeBootSnapshot } from "./boot-snapshot";

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

describe("boot snapshot", () => {
  it("round-trips a session and a workspace list, and drops a stale copy", () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    writeBootSnapshot(storage, {
      session: { at: now - 1000, data: user },
      workspaces: { at: now - 1000, data: [space] }
    });
    expect(readBootSnapshot(storage, now)).toEqual({
      session: { at: now - 1000, data: user },
      workspaces: { at: now - 1000, data: [space] }
    });
    expect(readBootSnapshot(storage, now + 25 * 60 * 60 * 1000)).toEqual({ session: null, workspaces: null });
  });

  it("ignores a snapshot that does not match the contract", () => {
    const storage = memoryStorage();
    storage.setItem("orion.boot.session.v1", JSON.stringify({ at: Date.now(), data: { id: "x" } }));
    expect(readBootSnapshot(storage).session).toBeNull();
  });

  it("seeds a query cache with the snapshot's own time", () => {
    const storage = memoryStorage();
    const at = Date.now() - 60_000;
    writeBootSnapshot(storage, { session: { at, data: user }, workspaces: { at, data: [space] } });
    const client = new QueryClient();
    applyBootSnapshot(client, storage);
    expect(client.getQueryData(["session"])).toEqual(user);
    expect(client.getQueryData(["workspaces"])).toEqual([space]);
    expect(client.getQueryState(["session"])?.dataUpdatedAt).toBe(at);
    clearBootSnapshot(storage);
    expect(readBootSnapshot(storage)).toEqual({ session: null, workspaces: null });
  });
});
