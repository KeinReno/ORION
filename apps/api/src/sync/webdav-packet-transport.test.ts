import { describe, expect, it } from "vitest";
import { generateLinkKey } from "@orion/core/src/link/packet-codec";
import { RelayIngress, RelayNodeTransport } from "@orion/core/src/link/relay";
import { MemoryHost } from "@orion/core/src/sync/memory-host";
import { ReplicaEngine } from "@orion/core/src/sync/replica-engine";
import { MemoryReplicaStorage } from "@orion/core/src/sync/replica-types";
import { hybridNodeTransport } from "./hybrid-node-transport";
import { WebdavPacketTransport, type LinkWebdavFiles } from "./webdav-packet-transport";

/** Ведёт себя как WebDAV: каталоги неявные, листинг — дети уровня, повторный PUT перезаписал бы файл. */
class FakeDav implements LinkWebdavFiles {
  readonly store = new Map<string, Buffer>();
  puts = 0;
  async putFile(rel: string, data: Buffer) {
    this.puts += 1;
    this.store.set(rel, Buffer.from(data));
  }
  async getFile(rel: string) {
    const b = this.store.get(rel);
    if (!b) throw Object.assign(new Error("not found"), { status: 404 });
    return b;
  }
  async exists(rel: string) {
    const prefix = `${rel}/`;
    return this.store.has(rel) || [...this.store.keys()].some((k) => k.startsWith(prefix));
  }
  async deleteFile(rel: string) {
    this.store.delete(rel);
  }
  async listNames(rel: string) {
    const prefix = `${rel}/`;
    return [...new Set([...this.store.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split("/")[0]!))].sort();
  }
}

describe("WebdavPacketTransport", () => {
  it("put не перезаписывает, get отсутствующего → null, list — дети уровня", async () => {
    const dav = new FakeDav();
    const t = new WebdavPacketTransport(dav);
    expect(await t.put("a/b/1.pkt", new Uint8Array([1]))).toBe(true);
    expect(await t.put("a/b/1.pkt", new Uint8Array([2]))).toBe(false);
    expect(dav.puts).toBe(1);
    expect([...(await t.get("a/b/1.pkt"))!]).toEqual([1]);
    expect(await t.get("a/b/2.pkt")).toBeNull();
    expect(await t.list("a")).toEqual(["b"]);
    expect(await t.list("zzz")).toEqual([]);
    await t.remove("a/b/1.pkt");
    expect(await t.list("a/b")).toEqual([]);
    expect((await t.probe()).ok).toBe(true);
  });

  it("Hybrid Sync сходится через WebDAV-адаптер; провайдер не видит текст", async () => {
    const dav = new FakeDav();
    const box = new WebdavPacketTransport(dav);
    const host = new MemoryHost();
    const keys = [generateLinkKey("k1")];
    const ingress = new RelayIngress({ box, workspaceId: "ws", epoch: 1, keys, host });
    let n = 0;
    const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const engine = (device: string) =>
      new ReplicaEngine({
        transport: new RelayNodeTransport({
          box, workspaceId: "ws", epoch: 1, keys, deviceId: device, maxPolls: 3,
          wait: async () => void (await ingress.pollOnce())
        }),
        storage: new MemoryReplicaStorage(), userId: "u1", workspaceId: "ws", uuid, now: () => host.nowMs
      });
    const a = engine("pc");
    const b = engine("phone");
    await a.sync();
    await b.sync();
    await a.enqueue({ entity: "list", kind: "create", fields: { name: "Тайный список" } });
    await a.sync();
    await b.sync();
    expect(b.lists().lists.map((l) => l.name)).toEqual(["Тайный список"]);
    for (const bytes of dav.store.values()) expect(bytes.toString("utf8")).not.toContain("Тайный");
  });
});

describe("hybridNodeTransport", () => {
  it("вызывает HybridSyncService от имени привязанного пользователя", async () => {
    const calls: unknown[][] = [];
    const hybrid = {
      registerDevice: async (...a: unknown[]) => void calls.push(["register", ...a]),
      snapshot: async (...a: unknown[]) => (calls.push(["snapshot", ...a]), {} as never),
      pull: async (...a: unknown[]) => (calls.push(["pull", ...a]), {} as never),
      push: async (...a: unknown[]) => (calls.push(["push", ...a]), {} as never)
    };
    const t = hybridNodeTransport(hybrid as never, "user-1");
    await t.registerDevice({ deviceId: "d", name: "n" });
    await t.snapshot("ws");
    await t.pull("ws", "c");
    await t.push("ws", { protocol: 1, deviceId: "d", ops: [] } as never);
    expect(calls.map((c) => [c[0], c[1]])).toEqual([["register", "user-1"], ["snapshot", "user-1"], ["pull", "user-1"], ["push", "user-1"]]);
    expect(calls[1]).toEqual(["snapshot", "user-1", "ws", 1]);
  });
});
