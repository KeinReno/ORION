import { describe, expect, it } from "vitest";
import { MemoryHost } from "./memory-host";
import { ReplicaEngine } from "./replica-engine";
import { MemoryReplicaStorage } from "./replica-types";

/** Детерминированный ГПСЧ (mulberry32) — сид попадает в сообщение при падении, сценарий воспроизводим. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strip(doc: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...doc };
  delete rest.createdAt; delete rest.updatedAt; delete rest.checkedAt; delete rest.checkedById; delete rest.checkedByName;
  return rest;
}

async function scenario(seed: number): Promise<number> {
  const random = rng(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
  let idCounter = 0;
  const uuid = () => `${seed.toString(16).padStart(8, "0")}-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;
  const host = new MemoryHost();
  host.pullLimit = 3;
  const skews = [0, -90_000, 45_000];
  const devices = skews.map((skew, index) => {
    const engine = new ReplicaEngine({
      transport: host,
      storage: new MemoryReplicaStorage(),
      userId: `u${index}`,
      workspaceId: "ws",
      uuid,
      now: () => host.nowMs + skew
    });
    return engine;
  });
  for (const engine of devices) await engine.sync();

  const knownLists = (): string[] => [...host.rows.keys()].filter((k) => k.startsWith("list:")).map((k) => k.slice(5));

  for (let step = 0; step < 120; step += 1) {
    host.nowMs += Math.floor(random() * 5000);
    const engine = pick(devices);
    const roll = random();
    const view = engine.lists().lists;
    if (roll < 0.15 || view.length === 0) {
      await engine.enqueue({ entity: "list", kind: "create", fields: { name: `L${step}` } }).catch(() => undefined);
    } else if (roll < 0.4) {
      const list = pick(view);
      await engine.enqueue({ entity: "listItem", kind: "create", parentId: list.id, fields: { label: `i${step}`, sortOrder: Math.floor(random() * 100) } });
    } else if (roll < 0.65) {
      const items = view.flatMap((l) => l.items.map((i) => ({ l, i })));
      if (items.length > 0) {
        const { l, i } = pick(items);
        const field = pick(["checked", "label", "sortOrder", "note"]);
        const fields =
          field === "checked" ? { checked: random() < 0.5 } : field === "label" ? { label: `x${step}` } : field === "note" ? { note: `n${step}` } : { sortOrder: Math.floor(random() * 100) };
        await engine.enqueue({ entity: "listItem", kind: "patch", entityId: i.id, parentId: l.id, fields });
      }
    } else if (roll < 0.75) {
      const items = view.flatMap((l) => l.items.map((i) => ({ l, i })));
      if (items.length > 0) {
        const { l, i } = pick(items);
        await engine.enqueue({ entity: "listItem", kind: "delete", entityId: i.id, parentId: l.id });
      }
    } else if (roll < 0.8) {
      await engine.enqueue({ entity: "list", kind: "delete", entityId: pick(view).id });
    } else if (roll < 0.85) {
      const ids = knownLists();
      if (ids.length > 0) host.restWrite("list", pick(ids), { name: `rest${step}` });
    } else {
      // сбои сети: потеря ответа и обрыв до обработки; повтор доставки случается сам при следующем sync
      const fault = random();
      if (fault < 0.3) host.dropPushResponses = 1;
      else if (fault < 0.5) host.failNext = 1;
      await engine.sync();
    }
  }

  // Сеть восстановилась: все синхронизируются до тишины (два круга: чужие изменения доходят после своих).
  host.dropPushResponses = 0;
  host.failNext = 0;
  for (let round = 0; round < 3; round += 1) for (const engine of devices) await engine.sync();

  const canonical = host.canonical();
  const expected = Object.fromEntries(Object.entries(canonical).map(([k, v]) => [k, strip(v as Record<string, unknown>)]));
  for (const [index, engine] of devices.entries()) {
    expect(engine.pending(), `seed ${seed}: у устройства ${index} осталась очередь`).toHaveLength(0);
    const entities = engine.entities();
    const actual: Record<string, unknown> = {};
    for (const [id, doc] of Object.entries(entities.list)) actual[`list:${id}`] = strip(doc);
    for (const [id, doc] of Object.entries(entities.listItem)) actual[`listItem:${id}`] = strip(doc);
    const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(sorted(actual), `seed ${seed}: устройство ${index} не сошлось с узлом`).toEqual(sorted(expected));
  }
  return Object.keys(canonical).length;
}

describe("сходимость реплик (property/fuzz, ТЗ-06 этап 2)", () => {
  it("три устройства со сдвигом часов, сбоями и дублями сходятся к состоянию узла", async () => {
    let rows = 0;
    for (let seed = 1; seed <= 60; seed += 1) rows += await scenario(seed);
    // не вырожденный прогон: сценарии действительно оставляют данные на узле
    expect(rows).toBeGreaterThan(300);
  }, 60_000);

  it("перестановка порядка доставки: два устройства, одинаковые операции, разный порядок синхронизации", async () => {
    for (const order of [[0, 1], [1, 0]]) {
      const host = new MemoryHost();
      let n = 0;
      const uuid = () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const mk = (index: number) =>
        new ReplicaEngine({ transport: host, storage: new MemoryReplicaStorage(), userId: `u${index}`, workspaceId: "ws", uuid, now: () => host.nowMs });
      const devs = [mk(0), mk(1)];
      for (const d of devs) await d.sync();
      const list = await devs[0]!.enqueue({ entity: "list", kind: "create", fields: { name: "L" } });
      await devs[0]!.sync();
      await devs[1]!.sync();
      host.nowMs += 1000;
      await devs[0]!.enqueue({ entity: "list", kind: "patch", entityId: list.entityId, fields: { name: "от 0" } });
      host.nowMs += 1000;
      await devs[1]!.enqueue({ entity: "list", kind: "patch", entityId: list.entityId, fields: { name: "от 1" } });
      for (const i of order) await devs[i]!.sync();
      for (const d of devs) await d.sync();
      // позднее по HLC всегда побеждает, независимо от порядка доставки
      expect(devs.map((d) => d.lists().lists[0]?.name)).toEqual(["от 1", "от 1"]);
    }
  });
});

/** Этап 3: заметки (CAS, конфликты) и задачи (LWW) под теми же сбоями — реплики всё равно сходятся с узлом. */
async function notesTasksScenario(seed: number): Promise<number> {
  const random = rng(seed * 7919);
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
  let idCounter = 0;
  const uuid = () => `${seed.toString(16).padStart(8, "0")}-1111-4000-8000-${String(++idCounter).padStart(12, "0")}`;
  const host = new MemoryHost();
  host.pullLimit = 4;
  const devices = [0, -60_000, 30_000].map(
    (skew, index) => new ReplicaEngine({ transport: host, storage: new MemoryReplicaStorage(), userId: `n${index}`, workspaceId: "ws", uuid, now: () => host.nowMs + skew })
  );
  for (const engine of devices) await engine.sync();

  for (let step = 0; step < 100; step += 1) {
    host.nowMs += Math.floor(random() * 4000);
    const engine = pick(devices);
    const notes = engine.notes();
    const tasks = engine.tasks();
    const roll = random();
    if (roll < 0.12) {
      await engine.enqueue({ entity: "note", kind: "create", fields: { title: `N${step}`, body: `b${step}` } });
    } else if (roll < 0.3 && notes.length > 0) {
      await engine.enqueue({ entity: "note", kind: "patch", entityId: pick(notes).id, fields: pick([{ body: `e${step}` }, { title: `T${step}` }, { tags: [`t${step % 3}`] }]) });
    } else if (roll < 0.35 && notes.length > 0) {
      await engine.enqueue({ entity: "note", kind: "delete", entityId: pick(notes).id });
    } else if (roll < 0.47) {
      await engine.enqueue({ entity: "task", kind: "create", fields: { title: `K${step}` } });
    } else if (roll < 0.7 && tasks.length > 0) {
      const fields = pick([{ status: pick(["todo", "in_progress", "done"]) }, { title: `kt${step}` }, { priority: pick(["low", "high"]) }, { sortOrder: Math.floor(random() * 50) }]);
      await engine.enqueue({ entity: "task", kind: "patch", entityId: pick(tasks).id, fields });
    } else if (roll < 0.75 && tasks.length > 0) {
      await engine.enqueue({ entity: "task", kind: "delete", entityId: pick(tasks).id });
    } else if (roll < 0.8) {
      const keys = [...host.rows.keys()].filter((k) => k.startsWith("note:") || k.startsWith("task:"));
      if (keys.length > 0) {
        const key = pick(keys);
        const [entity, id] = key.split(":") as ["note" | "task", string];
        host.restWrite(entity, id, entity === "note" ? { body: `rest${step}` } : { title: `rest${step}` });
      }
    } else {
      const fault = random();
      if (fault < 0.3) host.dropPushResponses = 1;
      else if (fault < 0.5) host.failNext = 1;
      await engine.sync();
    }
  }
  host.dropPushResponses = 0;
  host.failNext = 0;
  for (let round = 0; round < 4; round += 1) for (const engine of devices) await engine.sync();

  const expected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(host.canonical())) if (key.startsWith("note:") || key.startsWith("task:")) expected[key] = value;
  const norm = (doc: Record<string, unknown>) => {
    const rest = { ...doc };
    delete rest.createdAt; delete rest.updatedAt;
    return rest;
  };
  for (const [index, engine] of devices.entries()) {
    expect(engine.pending(), `seed ${seed}: очередь устройства ${index}`).toHaveLength(0);
    const entities = engine.entities();
    const actual: Record<string, unknown> = {};
    for (const [id, doc] of Object.entries(entities.note)) actual[`note:${id}`] = norm(doc);
    for (const [id, doc] of Object.entries(entities.task)) actual[`task:${id}`] = norm(doc);
    expect(Object.keys(actual).sort(), `seed ${seed}: состав устройства ${index}`).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(actual[key], `seed ${seed}: ${key} на устройстве ${index}`).toMatchObject(norm(expected[key] as Record<string, unknown>));
    }
  }
  return Object.keys(expected).length;
}

describe("сходимость реплик: заметки и задачи (ТЗ-06 этап 3)", () => {
  it("три устройства со сбоями, CAS-конфликтами и REST-правками сходятся к состоянию узла", async () => {
    let rows = 0;
    for (let seed = 1; seed <= 40; seed += 1) rows += await notesTasksScenario(seed);
    expect(rows).toBeGreaterThan(150);
  }, 90_000);
});
