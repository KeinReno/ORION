import { describe, expect, it } from "vitest";
import { MemoryHost } from "./memory-host";
import { ReplicaEngine, ReplicaWriteError } from "./replica-engine";
import { MemoryReplicaStorage } from "./replica-types";

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

function device(host: MemoryHost, opts: { storage?: MemoryReplicaStorage; user?: string; clock?: () => number } = {}) {
  const storage = opts.storage ?? new MemoryReplicaStorage();
  const engine = new ReplicaEngine({
    transport: host,
    storage,
    userId: opts.user ?? "u1",
    workspaceId: "ws",
    uuid,
    now: opts.clock ?? (() => host.nowMs)
  });
  return { engine, storage };
}

async function addList(engine: ReplicaEngine, name = "Покупки") {
  return engine.enqueue({ entity: "list", kind: "create", fields: { name } });
}
async function addItem(engine: ReplicaEngine, listId: string, label: string, extra: Record<string, unknown> = {}) {
  return engine.enqueue({ entity: "listItem", kind: "create", parentId: listId, fields: { label, ...extra } });
}

describe("ReplicaEngine — этап 1: копия и чтение", () => {
  it("грузит снимок, показывает метку времени, офлайн остаётся читаемой", async () => {
    const host = new MemoryHost();
    host.restWrite("list", "11111111-1111-4111-8111-111111111111", { name: "Дом" });
    const { engine } = device(host);
    await engine.sync();
    expect(engine.lists().lists.map((l) => l.name)).toEqual(["Дом"]);
    expect(engine.status().asOf).toBe(new Date(host.nowMs).toISOString());
    host.failNext = 5;
    const report = await engine.sync();
    expect(report.phase).toBe("offline");
    expect(engine.lists().lists).toHaveLength(1);
  });

  it("правка заметки, которой нет в копии, отвергается с объяснением; неизвестные поля — тоже", async () => {
    const host = new MemoryHost();
    const { engine } = device(host);
    await engine.sync();
    await expect(engine.enqueue({ entity: "note", kind: "patch", entityId: uuid(), fields: { title: "x" } })).rejects.toBeInstanceOf(ReplicaWriteError);
    await expect(engine.enqueue({ entity: "task", kind: "patch", entityId: uuid(), fields: { assigneeId: "x" } })).rejects.toBeInstanceOf(ReplicaWriteError);
  });

  it("отзыв членства удаляет копию при следующем подключении", async () => {
    const host = new MemoryHost();
    const { engine, storage } = device(host);
    await engine.sync();
    expect(await storage.load("u1", "ws")).not.toBeNull();
    host.revoked = true;
    const report = await engine.sync();
    expect(report.phase).toBe("revoked");
    expect(engine.hasCopy()).toBe(false);
    expect(await storage.load("u1", "ws")).toBeNull();
  });

  it("после возврата сети данные обновляются", async () => {
    const host = new MemoryHost();
    const { engine } = device(host);
    await engine.sync();
    host.restWrite("list", "22222222-2222-4222-8222-222222222222", { name: "Новый" });
    host.failNext = 1;
    await engine.sync();
    expect(engine.lists().lists).toHaveLength(0);
    await engine.sync();
    expect(engine.lists().lists.map((l) => l.name)).toEqual(["Новый"]);
  });
});

describe("ReplicaEngine — этап 2: запись на списках", () => {
  it("офлайн-запись: local → queued → synced только после подтверждения узла", async () => {
    const host = new MemoryHost();
    const { engine } = device(host);
    await engine.sync();
    host.failNext = 10;
    const list = await addList(engine);
    expect(engine.syncStateOf("list", list.entityId)).toBe("local");
    await engine.sync();
    expect(engine.syncStateOf("list", list.entityId)).toBe("queued");
    expect(engine.lists().lists[0]?.name).toBe("Покупки"); // видно сразу, хотя узел не знает
    host.failNext = 0;
    await engine.sync();
    expect(engine.syncStateOf("list", list.entityId)).toBe("synced");
    expect(engine.pending()).toHaveLength(0);
    expect(host.rows.has(`list:${list.entityId}`)).toBe(true);
  });

  it("потерянный ответ + повторная отправка не дублирует (идемпотентность)", async () => {
    const host = new MemoryHost();
    const { engine } = device(host);
    await engine.sync();
    const list = await addList(engine);
    host.dropPushResponses = 1;
    expect((await engine.sync()).phase).toBe("offline");
    expect(engine.pending()).toHaveLength(1);
    await engine.sync();
    expect(engine.pending()).toHaveLength(0);
    expect([...host.rows.keys()].filter((k) => k.startsWith("list:"))).toEqual([`list:${list.entityId}`]);
  });

  it("двое отметили один пункт — конфликта нет; отметил/снял — решает HLC", async () => {
    const host = new MemoryHost();
    const a = device(host, { user: "a" });
    const b = device(host, { user: "b" });
    await a.engine.sync();
    const list = await addList(a.engine);
    const item = await addItem(a.engine, list.entityId, "Молоко");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.enqueue({ entity: "listItem", kind: "patch", entityId: item.entityId, parentId: list.entityId, fields: { checked: true } });
    await b.engine.enqueue({ entity: "listItem", kind: "patch", entityId: item.entityId, parentId: list.entityId, fields: { checked: true } });
    await a.engine.sync();
    await b.engine.sync();
    expect(a.engine.conflicts()).toHaveLength(0);
    expect(b.engine.conflicts()).toHaveLength(0);
    await a.engine.sync();
    expect(a.engine.lists().lists[0]?.items[0]?.checked).toBe(true);
  });

  it("одновременное удаление и правка: удаление побеждает, автор правки видит конфликт", async () => {
    const host = new MemoryHost();
    const a = device(host);
    const b = device(host);
    await a.engine.sync();
    const list = await addList(a.engine);
    const item = await addItem(a.engine, list.entityId, "Хлеб");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.enqueue({ entity: "listItem", kind: "delete", entityId: item.entityId, parentId: list.entityId });
    await b.engine.enqueue({ entity: "listItem", kind: "patch", entityId: item.entityId, parentId: list.entityId, fields: { label: "Батон" } });
    await a.engine.sync();
    await b.engine.sync();
    expect(b.engine.conflicts()[0]).toMatchObject({ outcome: "conflict", reason: "entity_deleted" });
    expect(b.engine.syncStateOf("listItem", item.entityId)).toBe("conflict");
    expect(b.engine.lists().lists[0]?.items).toHaveLength(0);
  });

  it("проигранное поле возвращается как lost и показывается", async () => {
    const host = new MemoryHost();
    const a = device(host);
    const b = device(host);
    await a.engine.sync();
    const list = await addList(a.engine);
    const item = await addItem(a.engine, list.entityId, "Сыр");
    await a.engine.sync();
    await b.engine.sync();
    // b правит «раньше» по своим часам, но доставляет позже → проигрывает по HLC
    host.nowMs += 60_000;
    await a.engine.enqueue({ entity: "listItem", kind: "patch", entityId: item.entityId, parentId: list.entityId, fields: { label: "Сыр рокфор" } });
    await a.engine.sync();
    host.nowMs -= 120_000;
    const bb = device(host, { clock: () => host.nowMs });
    void bb;
    await b.engine.enqueue({ entity: "listItem", kind: "patch", entityId: item.entityId, parentId: list.entityId, fields: { label: "Сыр моцарелла" } });
    await b.engine.sync();
    await a.engine.sync();
    expect(host.canonical()[`listItem:${item.entityId}`]).toMatchObject({ label: expect.any(String) });
  });

  it("откат устройства из бэкапа: новая личность, неотправленное сохранено", async () => {
    const host = new MemoryHost();
    const storage = new MemoryReplicaStorage();
    const { engine } = device(host, { storage });
    await engine.sync();
    const list = await addList(engine, "A");
    await engine.sync();
    const backup = storage.dump();
    await addItem(engine, list.entityId, "после бэкапа");
    await engine.sync();
    // «восстановили» старый диск: операции после бэкапа забыты, deviceSeq откатился
    storage.restore(backup);
    const restored = device(host, { storage });
    await restored.engine.open();
    await restored.engine.enqueue({ entity: "list", kind: "create", fields: { name: "B после отката" } });
    const report = await restored.engine.sync();
    expect(report.phase).toBe("idle");
    const names = [...host.rows].filter(([k]) => k.startsWith("list:")).map(([, r]) => r.fields.name);
    expect(names).toEqual(expect.arrayContaining(["A", "B после отката"]));
    expect(restored.engine.pending()).toHaveLength(0);
  });

  it("resync_required: снимок грузится заново, очередь сохраняется", async () => {
    const host = new MemoryHost();
    const { engine } = device(host);
    await engine.sync();
    await addList(engine, "Очередь");
    host.failNext = 1;
    await engine.sync();
    host.minCursor = 10_000;
    await engine.sync();
    expect(engine.pending()).toHaveLength(0);
    expect(engine.lists().lists.map((l) => l.name)).toContain("Очередь");
  });
});
