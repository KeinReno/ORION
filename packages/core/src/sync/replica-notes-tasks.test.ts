import { describe, expect, it } from "vitest";
import { MemoryHost } from "./memory-host";
import { ReplicaEngine } from "./replica-engine";
import { MemoryReplicaStorage } from "./replica-types";

let counter = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;

function device(host: MemoryHost, user = "u1") {
  return new ReplicaEngine({ transport: host, storage: new MemoryReplicaStorage(), userId: user, workspaceId: "ws", uuid, now: () => host.nowMs });
}

/** ТЗ-06 этап 3: заметки (явный конфликт по revision) и задачи (LWW по полю). */
describe("ReplicaEngine — этап 3: заметки", () => {
  it("заметка, созданная и несколько раз правленная офлайн, доезжает цепочкой без самоконфликта", async () => {
    const host = new MemoryHost();
    const a = device(host);
    await a.sync();
    host.failNext = 100;
    const created = await a.enqueue({ entity: "note", kind: "create", fields: { title: "Идея", body: "раз" } });
    await a.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { body: "раз два" } });
    await a.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { body: "раз два три" } });
    expect(a.notes()[0]?.body).toBe("раз два три");
    host.failNext = 0;
    await a.sync();
    expect(a.conflicts()).toHaveLength(0);
    expect(a.pending()).toHaveLength(0);
    expect(a.notes()[0]).toMatchObject({ body: "раз два три", revision: 3 });
  });

  it("два устройства правят одну заметку: проигравший видит явный конфликт, слияния нет", async () => {
    const host = new MemoryHost();
    const a = device(host, "a");
    const b = device(host, "b");
    await a.sync();
    const created = await a.enqueue({ entity: "note", kind: "create", fields: { title: "Общая", body: "исходный" } });
    await a.sync();
    await b.sync();
    await a.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { body: "от A" } });
    await b.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { body: "от B" } });
    await a.sync();
    await b.sync();
    expect(b.conflicts()[0]).toMatchObject({ outcome: "conflict", reason: "revision" });
    expect(b.syncStateOf("note", created.entityId)).toBe("conflict");
    // версия узла победила; текст B не потерян — он лежит в операции конфликта
    expect(b.notes()[0]?.body).toBe("от A");
    expect(b.conflicts()[0]?.op.fields).toEqual({ body: "от B" });

    // «сохранить мою поверх»: переотправка против текущей ревизии узла
    const conflictId = b.conflicts()[0]!.opId;
    await b.retryConflict(conflictId);
    await b.sync();
    await a.sync();
    expect(b.conflicts()).toHaveLength(0);
    expect(a.notes()[0]?.body).toBe("от B");
  });

  it("«загрузить версию узла» снимает конфликт и оставляет текст узла", async () => {
    const host = new MemoryHost();
    const a = device(host, "a");
    const b = device(host, "b");
    await a.sync();
    const created = await a.enqueue({ entity: "note", kind: "create", fields: { title: "T" } });
    await a.sync();
    await b.sync();
    await a.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { title: "A" } });
    await b.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { title: "B" } });
    await a.sync();
    await b.sync();
    await b.dismissConflict(b.conflicts()[0]!.opId);
    expect(b.conflicts()).toHaveLength(0);
    expect(b.notes()[0]?.title).toBe("A");
  });

  it("удаление заметки (в корзину) против правки: правка получает entity_deleted", async () => {
    const host = new MemoryHost();
    const a = device(host, "a");
    const b = device(host, "b");
    await a.sync();
    const created = await a.enqueue({ entity: "note", kind: "create", fields: { title: "Х" } });
    await a.sync();
    await b.sync();
    await a.enqueue({ entity: "note", kind: "delete", entityId: created.entityId });
    await b.enqueue({ entity: "note", kind: "patch", entityId: created.entityId, fields: { title: "Правка" } });
    await a.sync();
    await b.sync();
    expect(b.conflicts()[0]).toMatchObject({ outcome: "conflict", reason: "entity_deleted" });
    expect(b.notes()).toHaveLength(0);
  });
});

describe("ReplicaEngine — этап 3: задачи", () => {
  it("поля задачи сливаются по LWW: разные поля двух устройств сохраняются оба", async () => {
    const host = new MemoryHost();
    const a = device(host, "a");
    const b = device(host, "b");
    await a.sync();
    const created = await a.enqueue({ entity: "task", kind: "create", fields: { title: "Задача" } });
    await a.sync();
    await b.sync();
    host.nowMs += 1000;
    await a.enqueue({ entity: "task", kind: "patch", entityId: created.entityId, fields: { status: "done" } });
    await b.enqueue({ entity: "task", kind: "patch", entityId: created.entityId, fields: { priority: "high" } });
    await a.sync();
    await b.sync();
    await a.sync();
    for (const d of [a, b]) {
      expect(d.conflicts()).toHaveLength(0);
      expect(d.tasks()[0]).toMatchObject({ status: "done", priority: "high" });
    }
  });

  it("одно и то же поле: позднее по HLC побеждает, проигравший узнаёт значение узла", async () => {
    const host = new MemoryHost();
    const a = device(host, "a");
    const b = device(host, "b");
    await a.sync();
    const created = await a.enqueue({ entity: "task", kind: "create", fields: { title: "Исходная" } });
    await a.sync();
    await b.sync();
    host.nowMs += 5000;
    await a.enqueue({ entity: "task", kind: "patch", entityId: created.entityId, fields: { title: "Позже" } });
    await a.sync();
    host.nowMs -= 4000; // часы B отстают: его правка «раньше»
    await b.enqueue({ entity: "task", kind: "patch", entityId: created.entityId, fields: { title: "Раньше" } });
    await b.sync();
    expect(b.conflicts()[0]).toMatchObject({ outcome: "superseded", lost: { title: "Позже" } });
    await b.sync();
    expect(b.tasks()[0]?.title).toBe("Позже");
  });

  it("явный expectedRevision у задачи: устаревшая основа даёт конфликт revision", async () => {
    const host = new MemoryHost();
    const a = device(host, "a");
    await a.sync();
    const created = await a.enqueue({ entity: "task", kind: "create", fields: { title: "T" } });
    await a.sync();
    await a.enqueue({ entity: "task", kind: "patch", entityId: created.entityId, fields: { title: "T2" } });
    await a.sync();
    await a.enqueue({ entity: "task", kind: "patch", entityId: created.entityId, fields: { title: "T3" }, expectedRevision: 1 });
    await a.sync();
    expect(a.conflicts()[0]).toMatchObject({ outcome: "conflict", reason: "revision" });
  });
});
