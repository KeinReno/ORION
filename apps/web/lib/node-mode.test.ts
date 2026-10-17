import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@orion/core";
import { NamespacedStorage, applyNodeMode, nodeStoragePrefix, readNodeMark } from "./node-mode";

const store = (value: string | null) => ({ getItem: () => value });

describe("node mode", () => {
  it("reads only a well-formed client mark; anything else is local", () => {
    expect(readNodeMark(store(null))).toBeNull();
    expect(readNodeMark(store("not json"))).toBeNull();
    expect(readNodeMark(store(JSON.stringify({ mode: "host", nodeId: "x" })))).toBeNull();
    expect(readNodeMark(store(JSON.stringify({ mode: "client" })))).toBeNull();
    expect(readNodeMark(store(JSON.stringify({ mode: "client", nodeId: "n1", name: "Дом" })))).toEqual({ mode: "client", nodeId: "n1", name: "Дом" });
  });

  it("routes through the local proxy only in client mode", () => {
    expect(applyNodeMode("http://localhost:4000", null)).toBe("http://localhost:4000");
    expect(applyNodeMode("http://localhost:4000", { mode: "client", nodeId: "n1", name: "Дом" })).toBe("http://localhost:4000/_remote");
  });

  it("keeps the host session and the local session apart, leaving local keys untouched", async () => {
    const inner = new MemoryStorage();
    const local = new NamespacedStorage(inner, nodeStoragePrefix(null));
    const remote = new NamespacedStorage(inner, nodeStoragePrefix({ mode: "client", nodeId: "n1", name: "Дом" }));
    await local.set("orion.auth.accessToken", "LOCAL");
    await remote.set("orion.auth.accessToken", "HOST");
    expect(await local.get("orion.auth.accessToken")).toBe("LOCAL");
    expect(await remote.get("orion.auth.accessToken")).toBe("HOST");
    expect(await inner.get("orion.auth.accessToken")).toBe("LOCAL");
  });
});
