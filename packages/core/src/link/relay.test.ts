import { describe, expect, it } from "vitest";
import { MemoryHost } from "../sync/memory-host";
import { ReplicaEngine } from "../sync/replica-engine";
import { MemoryReplicaStorage } from "../sync/replica-types";
import {
  PacketError,
  decryptPacket,
  encryptPacket,
  generateLinkKey,
  readPacketHeader,
  type LinkKey,
  type PacketHeader
} from "./packet-codec";
import { MemoryPacketTransport } from "./packet-transport";
import { RelayIngress, RelayNodeTransport } from "./relay";

const WS = "ws";
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const header = (over: Partial<PacketHeader> = {}): PacketHeader => ({
  linkVersion: 1,
  protocolVersion: 1,
  workspaceId: WS,
  epoch: 1,
  sourceDeviceId: "d1",
  kind: "request",
  seq: 1,
  keyId: "k1",
  createdAt: "2026-10-19T00:00:00.000Z",
  ...over
});

describe("packet-codec", () => {
  const key = generateLinkKey("k1");
  const ctx = (keys: LinkKey[] = [key]) => ({ workspaceId: WS, epoch: 1, keys });

  it("круг шифрования; облако видит только заголовок", async () => {
    const bytes = await encryptPacket(header(), { secret: "Молоко" }, key);
    expect(new TextDecoder().decode(bytes)).not.toContain("Молоко");
    const { body } = await decryptPacket(bytes, ctx());
    expect(body).toEqual({ secret: "Молоко" });
  });

  it("отвергает подмену заголовка, чужой ключ, чужую эпоху, усечение и мусор", async () => {
    const bytes = await encryptPacket(header(), { a: 1 }, key);
    const { head } = readPacketHeader(bytes);
    const forged = bytes.slice();
    const text = new TextDecoder().decode(head).replace('"seq":1', '"seq":2');
    expect(text.length).toBe(head.length);
    forged.set(new TextEncoder().encode(text), 5 + 4);
    await expect(decryptPacket(forged, ctx())).rejects.toMatchObject({ code: "corrupt" });
    await expect(decryptPacket(bytes, ctx([generateLinkKey("k1")]))).rejects.toMatchObject({ code: "corrupt" });
    await expect(decryptPacket(bytes, ctx([generateLinkKey("other")]))).rejects.toMatchObject({ code: "unknown_key" });
    await expect(decryptPacket(bytes, { ...ctx(), epoch: 2 })).rejects.toMatchObject({ code: "wrong_context" });
    await expect(decryptPacket(bytes.slice(0, 40), ctx())).rejects.toBeInstanceOf(PacketError);
    await expect(decryptPacket(new Uint8Array(100), ctx())).rejects.toMatchObject({ code: "malformed" });
  });

  it("ротация: старый keyId читается, пока ключ в связке", async () => {
    const old = generateLinkKey("k0");
    const bytes = await encryptPacket(header({ keyId: "k0" }), { a: 1 }, old);
    const next = generateLinkKey("k1");
    await expect(decryptPacket(bytes, ctx([next, old]))).resolves.toBeTruthy();
    await expect(decryptPacket(bytes, ctx([next]))).rejects.toMatchObject({ code: "unknown_key" });
  });
});

function world() {
  const host = new MemoryHost();
  const box = new MemoryPacketTransport();
  const keys = [generateLinkKey("k1")];
  const ingress = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys, host });
  const make = (linkDeviceId: string) => {
    const transport = new RelayNodeTransport({
      box,
      workspaceId: WS,
      epoch: 1,
      keys,
      deviceId: linkDeviceId,
      maxPolls: 3,
      wait: async () => void (await ingress.pollOnce())
    });
    const engine = new ReplicaEngine({
      transport,
      storage: new MemoryReplicaStorage(),
      userId: "u1",
      workspaceId: WS,
      uuid,
      now: () => host.nowMs
    });
    return { engine, transport };
  };
  return { host, box, ingress, make, keys };
}

describe("Orion Link: ReplicaEngine через ящик (прототип ADR-0020)", () => {
  it("два устройства сходятся через зашифрованный ящик, а в ящике нет открытого текста", async () => {
    const { host, box, make } = world();
    const a = make("pc").engine;
    const b = make("phone").engine;
    await a.sync();
    await b.sync();
    const list = await a.enqueue({ entity: "list", kind: "create", fields: { name: "Секретный список" } });
    await a.enqueue({ entity: "listItem", kind: "create", parentId: list.entityId, fields: { label: "Хлеб" } });
    await a.sync();
    await b.sync();
    expect(b.lists().lists.map((l) => l.name)).toEqual(["Секретный список"]);
    expect(b.lists().lists[0]!.items.map((i) => i.label)).toEqual(["Хлеб"]);
    expect(host.rows.size).toBe(2);
    for (const bytes of box.files.values()) expect(new TextDecoder().decode(bytes)).not.toMatch(/Хлеб|Секретный/);
  });

  it("узел офлайн: операции остаются в очереди и доходят позже без дублей", async () => {
    const { host, box, ingress, keys } = world();
    let nodeUp = false;
    const transport = new RelayNodeTransport({
      box,
      workspaceId: WS,
      epoch: 1,
      keys,
      deviceId: "pc",
      maxPolls: 2,
      wait: async () => {
        if (nodeUp) await ingress.pollOnce();
      }
    });
    const engine = new ReplicaEngine({
      transport,
      storage: new MemoryReplicaStorage(),
      userId: "u1",
      workspaceId: WS,
      uuid,
      now: () => host.nowMs
    });
    nodeUp = true;
    await engine.sync();
    await engine.enqueue({ entity: "list", kind: "create", fields: { name: "Дом" } });
    nodeUp = false;
    expect((await engine.sync()).phase).toBe("offline");
    expect(engine.status().pending).toBe(1);
    expect(host.rows.size).toBe(0);
    nodeUp = true;
    await engine.sync();
    expect(engine.status().pending).toBe(0);
    expect([...host.rows.keys()].filter((k) => k.startsWith("list:"))).toHaveLength(1);
  });

  it("ответ потерян (узел применил, клиент не дождался): повтор даёт duplicate, не второй список", async () => {
    const { host, box, ingress, keys } = world();
    let silent = true;
    const transport = new RelayNodeTransport({
      box,
      workspaceId: WS,
      epoch: 1,
      keys,
      deviceId: "pc",
      maxPolls: 2,
      // пока silent, узел применяет запрос, но ответ мы не читаем (стираем ответ из ящика)
      wait: async () => {
        await ingress.pollOnce();
        if (silent) for (const path of [...box.files.keys()]) if (path.includes("/down/")) box.files.delete(path);
      }
    });
    const engine = new ReplicaEngine({
      transport,
      storage: new MemoryReplicaStorage(),
      userId: "u1",
      workspaceId: WS,
      uuid,
      now: () => host.nowMs
    });
    silent = false;
    await engine.sync();
    await engine.enqueue({ entity: "list", kind: "create", fields: { name: "Один" } });
    silent = true;
    const report = await engine.sync();
    expect(report.phase).toBe("offline");
    silent = false;
    await engine.sync();
    expect([...host.rows.keys()].filter((k) => k.startsWith("list:"))).toHaveLength(1);
    expect(engine.status().pending).toBe(0);
  });

  it("повреждённый и усечённый ответ не портят копию; следующая попытка проходит", async () => {
    const { box, make } = world();
    const a = make("pc");
    await a.engine.sync();
    await a.engine.enqueue({ entity: "list", kind: "create", fields: { name: "Целый" } });
    box.corruptNextGets = 1;
    box.truncateNextGets = 0;
    await a.engine.sync();
    await a.engine.sync();
    expect(a.engine.lists().lists.map((l) => l.name)).toEqual(["Целый"]);
    expect(a.engine.status().pending).toBe(0);
  });

  it("сбой самого ящика = офлайн, а не ошибка данных", async () => {
    const { box, make } = world();
    const a = make("pc");
    box.failNext = 3;
    const report = await a.engine.sync();
    expect(report.phase).toBe("offline");
  });

  it("отзыв доступа на узле доезжает до клиента кодом 403", async () => {
    const { host, make } = world();
    const a = make("pc");
    await a.engine.sync();
    host.revoked = true;
    const report = await a.engine.sync();
    expect(report.phase).toBe("revoked");
  });

  it("пакеты чужой эпохи узел не исполняет", async () => {
    const { host, box, keys } = world();
    const stale = new RelayIngress({ box, workspaceId: WS, epoch: 2, keys, host });
    const transport = new RelayNodeTransport({ box, workspaceId: WS, epoch: 1, keys, deviceId: "pc", maxPolls: 1, wait: async () => void (await stale.pollOnce()) });
    await expect(transport.registerDevice({ deviceId: "x", name: "x" })).rejects.toBeInstanceOf(TypeError);
    expect(host.devices.size).toBe(0);
  });

  it("неспаренное Link-устройство получает 403 и узел не вызывается", async () => {
    const { host, box, keys } = world();
    const ingress = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys, host: async (id) => (id === "pc" ? host : null) });
    const mk = (deviceId: string) =>
      new RelayNodeTransport({ box, workspaceId: WS, epoch: 1, keys, deviceId, maxPolls: 2, wait: async () => void (await ingress.pollOnce()) });
    await mk("pc").registerDevice({ deviceId: "a", name: "a" });
    await expect(mk("stranger").registerDevice({ deviceId: "b", name: "b" })).rejects.toMatchObject({ status: 403 });
    expect([...host.devices]).toEqual(["a"]);
  });

  it("заметки и задачи идут через ящик: конфликт заметки по revision виден проигравшему, задача сходится", async () => {
    const { make } = world();
    const a = make("pc").engine;
    const b = make("phone").engine;
    await a.sync();
    const note = await a.enqueue({ entity: "note", kind: "create", fields: { title: "Общая", body: "исходный" } });
    const task = await a.enqueue({ entity: "task", kind: "create", fields: { title: "Купить хлеб" } });
    await a.sync();
    await b.sync();
    expect(b.notes()[0]?.body).toBe("исходный");
    expect(b.tasks()[0]?.title).toBe("Купить хлеб");

    await a.enqueue({ entity: "note", kind: "patch", entityId: note.entityId, fields: { body: "от A" } });
    await b.enqueue({ entity: "note", kind: "patch", entityId: note.entityId, fields: { body: "от B" } });
    await b.enqueue({ entity: "task", kind: "patch", entityId: task.entityId, fields: { title: "Купить батон" } });
    await a.sync();
    await b.sync();
    expect(b.conflicts()[0]).toMatchObject({ outcome: "conflict", reason: "revision" });
    expect(b.conflicts()[0]?.op.fields).toEqual({ body: "от B" });
    await a.sync();
    expect(a.tasks()[0]?.title).toBe("Купить батон");
  });

  it("большой снимок режется на части и собирается; порча одной части не ломает копию", async () => {
    const world1 = world();
    const { host, box, keys } = world1;
    for (let i = 0; i < 40; i += 1) host.restWrite("list", `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`, { name: `Список ${i} ${"я".repeat(200)}` });
    const ingress = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys, host, chunkBytes: 2048 });
    const transport = new RelayNodeTransport({
      box,
      workspaceId: WS,
      epoch: 1,
      keys,
      deviceId: "pc",
      maxPolls: 4,
      wait: async () => void (await ingress.pollOnce())
    });
    const engine = new ReplicaEngine({ transport, storage: new MemoryReplicaStorage(), userId: "u1", workspaceId: WS, uuid, now: () => host.nowMs });
    // Провайдер один раз отдаёт часть №1 с испорченным битом: клиент ждёт и забирает целую со следующего опроса.
    let spoiled = false;
    const realGet = box.get.bind(box);
    box.get = async (path: string) => {
      const bytes = await realGet(path);
      if (bytes && !spoiled && path.endsWith(".c0001.pkt")) {
        spoiled = true;
        const copy = bytes.slice();
        copy[copy.length - 1] = copy[copy.length - 1]! ^ 1;
        return copy;
      }
      return bytes;
    };
    await engine.sync();
    expect(spoiled).toBe(true);
    expect(transport.rejected.some((e) => e.code === "corrupt")).toBe(true);
    expect(engine.lists().lists).toHaveLength(40);
    expect([...box.files.keys()].some((k) => /\.c\d{4}\.pkt$/.test(k))).toBe(true);
  });

  it("клиент убирает старые ответы, оставляя хвост, и номера запросов не откатываются", async () => {
    const { box, make } = world();
    const a = make("pc");
    await a.engine.sync();
    for (let i = 0; i < 30; i += 1) await a.engine.enqueue({ entity: "list", kind: "create", fields: { name: `L${i}` } }).then(() => a.engine.sync());
    await new Promise((r) => setTimeout(r, 0));
    const downs = [...box.files.keys()].filter((k) => k.includes("/down/pc/")).map((k) => Number.parseInt(k.split("/").pop()!, 10));
    expect(downs.length).toBeLessThanOrEqual(22);
    expect(Math.max(...downs)).toBeGreaterThan(30);
    const fresh = make("pc");
    await fresh.engine.sync();
    expect(Math.min(...[...box.files.keys()].filter((k) => k.includes("/down/pc/")).map((k) => Number.parseInt(k.split("/").pop()!, 10)))).toBeGreaterThan(1);
  });

  it("большой запрос (заметка) режется на части, узел исполняет его один раз, части убираются", async () => {
    const { host, box, keys } = world();
    const ingress = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys, host });
    const transport = new RelayNodeTransport({
      box, workspaceId: WS, epoch: 1, keys, deviceId: "pc", maxPolls: 3, chunkBytes: 1024,
      wait: async () => void (await ingress.pollOnce())
    });
    const engine = new ReplicaEngine({ transport, storage: new MemoryReplicaStorage(), userId: "u1", workspaceId: WS, uuid, now: () => host.nowMs });
    await engine.sync();
    const body = "Длинный текст ".repeat(1000);
    await engine.enqueue({ entity: "note", kind: "create", fields: { title: "Большая", body } });
    await engine.sync();
    expect(engine.status().pending).toBe(0);
    expect([...host.rows.keys()].filter((k) => k.startsWith("note:"))).toHaveLength(1);
    expect([...box.files.keys()].filter((k) => k.includes("/up/"))).toEqual([]);
  });

  it("недописанный запрос (нет манифеста) узел не исполняет и не трогает", async () => {
    const { host, box, keys } = world();
    const ingress = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys, host, chunkBytes: 1024 });
    const transport = new RelayNodeTransport({
      box, workspaceId: WS, epoch: 1, keys, deviceId: "pc", maxPolls: 1, chunkBytes: 1024,
      wait: async () => undefined
    });
    // Клиент «упал» после записи частей, но до манифеста: симулируем потерей файла манифеста.
    const pending = transport.push(WS, { protocol: 1, deviceId: "d", ops: [] } as never).catch(() => undefined);
    await pending;
    for (const path of [...box.files.keys()]) if (/\/up\/pc\/\d+\.pkt$/.test(path)) box.files.delete(path);
    expect(await ingress.pollOnce()).toBe(0);
    expect(host.devices.size).toBe(0);
  });

  it("после ротации узел отвечает ключом запроса: устройство со старым ключом продолжает работать", async () => {
    const { host, box } = world();
    const oldKey = generateLinkKey("old");
    const newKey = generateLinkKey("new");
    const ingress = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys: [newKey, oldKey], host });
    const mk = (deviceId: string, key: typeof oldKey) =>
      new RelayNodeTransport({ box, workspaceId: WS, epoch: 1, keys: [key], deviceId, maxPolls: 2, wait: async () => void (await ingress.pollOnce()) });
    await mk("legacy", oldKey).registerDevice({ deviceId: "a", name: "a" });
    await mk("fresh", newKey).registerDevice({ deviceId: "b", name: "b" });
    expect([...host.devices].sort()).toEqual(["a", "b"]);
    // «cut off»: узел знает только новый ключ — старое устройство больше не читается и не исполняется
    const strict = new RelayIngress({ box, workspaceId: WS, epoch: 1, keys: [newKey], host });
    const cut = new RelayNodeTransport({ box, workspaceId: WS, epoch: 1, keys: [oldKey], deviceId: "legacy", maxPolls: 1, wait: async () => void (await strict.pollOnce()) });
    await expect(cut.registerDevice({ deviceId: "c", name: "c" })).rejects.toBeInstanceOf(TypeError);
    expect(host.devices.has("c")).toBe(false);
  });
});
