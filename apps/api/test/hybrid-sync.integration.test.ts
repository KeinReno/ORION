import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplicaStorage, ReplicaEngine, type SyncTransport } from "@orion/core/src/sync";
import {
  SYNC_PROTOCOL_VERSION,
  formatHlc,
  type PushSyncOpsInput,
  type PushSyncOpsResult,
  type RegisterSyncDeviceInput,
  type ReplicaPull,
  type ReplicaSnapshot,
  type SyncOp
} from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * ТЗ-06 этапы 1–2 против настоящей PostgreSQL/RLS: режим, снимок, лента изменений на триггерах, приём операций
 * (идемпотентность, откат устройства, удаление vs правка, LWW), отзыв доступа и сходимость двух реплик
 * через реальный HTTP-узел.
 */
describe("Hybrid sync (ADR-0016): snapshot, change feed, ops, convergence", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `hsync-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: ["error"] });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup(name: string) {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    const call = <T = unknown>(method: string, path: string, body?: unknown) => request<T>(`/workspaces/${ws}${path}`, { method, token, body });
    return { ws, token, call };
  }

  async function hybridSetup(name: string) {
    const s = await setup(name);
    expect((await s.call("PUT", "/sync/mode", { mode: "hybrid" })).status).toBe(200);
    const deviceId = randomUUID();
    expect((await request("/sync/devices", { method: "POST", token: s.token, body: { deviceId, name: "ПК" } })).status).toBe(201);
    return { ...s, deviceId };
  }

  async function getTask(call: Awaited<ReturnType<typeof setup>>["call"], id: string) {
    const all = await call<Array<{ id: string; parentId: string | null; status: string; priority: string; completedAt: string | null }>>("GET", "/tasks");
    return all.data.find((task) => task.id === id) as { id: string; parentId: string | null; status: string; priority: string; completedAt: string | null };
  }

  let seq = 0;
  const op = (deviceId: string, fields: Partial<SyncOp> & Pick<SyncOp, "entity" | "entityId" | "kind">, wallMs = Date.now()): SyncOp => {
    seq += 1;
    return { opId: randomUUID(), deviceId, deviceSeq: seq, hlc: formatHlc({ wallMs, counter: 0, deviceId }), ...fields } as SyncOp;
  };

  class HttpTransport implements SyncTransport {
    constructor(private readonly token: string, private readonly ws: string) {}
    private async ok<T>(p: Promise<{ status: number; data: unknown }>): Promise<T> {
      const r = await p;
      if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, details: r.data });
      return r.data as T;
    }
    registerDevice(input: RegisterSyncDeviceInput): Promise<void> {
      return this.ok<void>(request("/sync/devices", { method: "POST", token: this.token, body: input }));
    }
    snapshot(): Promise<ReplicaSnapshot> {
      return this.ok(request(`/workspaces/${this.ws}/sync/replica?protocol=${SYNC_PROTOCOL_VERSION}`, { method: "GET", token: this.token }));
    }
    pull(_ws: string, cursor: string): Promise<ReplicaPull> {
      return this.ok(request(`/workspaces/${this.ws}/sync/replica/changes?protocol=${SYNC_PROTOCOL_VERSION}&cursor=${encodeURIComponent(cursor)}`, { method: "GET", token: this.token }));
    }
    push(_ws: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult> {
      return this.ok(request(`/workspaces/${this.ws}/sync/ops`, { method: "POST", token: this.token, body: input }));
    }
  }

  it("observed writes remain editable when another device clock is ahead", async () => {
    const s = await hybridSetup("clock-skew");
    const transport = new HttpTransport(s.token, s.ws);
    const phone = new ReplicaEngine({ transport, storage: new MemoryReplicaStorage(), userId: "owner", workspaceId: s.ws, now: () => Date.now() + 80_000 });
    const pc = new ReplicaEngine({ transport, storage: new MemoryReplicaStorage(), userId: "owner", workspaceId: s.ws });
    await phone.sync();
    await pc.sync();
    const listId = randomUUID();
    const itemId = randomUUID();
    await phone.enqueue({ entity: "list", entityId: listId, kind: "create", fields: { name: "Clock test" } });
    await phone.enqueue({ entity: "listItem", entityId: itemId, parentId: listId, kind: "create", fields: { label: "Phone item", checked: true } });
    await phone.sync();
    await pc.sync();
    expect(pc.lists().lists.find(l => l.id === listId)?.items[0]?.checked).toBe(true);
    await pc.enqueue({ entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { checked: false } });
    await pc.sync();
    expect(pc.conflicts()).toEqual([]);
    await phone.sync();
    expect(phone.lists().lists.find(l => l.id === listId)?.items[0]?.checked).toBe(false);
    // A fresh installation must learn the same causal clock from a snapshot.
    const fresh = new ReplicaEngine({ transport, storage: new MemoryReplicaStorage(), userId: "owner", workspaceId: s.ws });
    await fresh.sync();
    await fresh.enqueue({ entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { checked: true } });
    await fresh.sync();
    expect(fresh.conflicts()).toEqual([]);
    await phone.sync();
    expect(phone.lists().lists.find(l => l.id === listId)?.items[0]?.checked).toBe(true);
  });

  it("causal watermark does not include another workspace's future stamps", async () => {
    const own = await hybridSetup("clock-owner");
    const foreign = await hybridSetup("clock-foreign");
    const future = op(foreign.deviceId, { entity: "list", entityId: randomUUID(), kind: "create", fields: { name: "Private clock" } }, Date.now() + 3_600_000);
    expect((await foreign.call<PushSyncOpsResult>("POST", "/sync/ops", { protocol: 1, deviceId: foreign.deviceId, ops: [future] })).data.results[0]?.outcome).toBe("applied");
    const snapshot = (await own.call<ReplicaSnapshot>("GET", "/sync/replica?protocol=1")).data;
    expect(snapshot.serverHlc < future.hlc).toBe(true);
    expect(snapshot.entities.list).toHaveLength(0);
    expect((await own.call("GET", `/sync/replica/changes?protocol=1&cursor=${encodeURIComponent(snapshot.cursor)}`)).status).toBe(200);
  });

  it("пространство не в гибриде: снимок и приём отвечают 409, режим меняет только владелец", async () => {
    const s = await setup("mode");
    const before = await s.call<{ code: string }>("GET", `/sync/replica?protocol=1`);
    expect(before.status).toBe(409);
    expect(before.data).toMatchObject({ code: "sync_mode_not_hybrid" });
    expect((await s.call("PUT", "/sync/mode", { mode: "nonsense" })).status).toBe(400);
    expect((await s.call("PUT", "/sync/mode", { mode: "hybrid" })).status).toBe(200);
    expect((await s.call("GET", `/sync/replica?protocol=1`)).status).toBe(200);
    expect((await s.call("GET", `/sync/replica?protocol=99`)).status).toBe(426);
  });

  it("чужое пространство недоступно: ни снимка, ни ленты, ни приёма", async () => {
    const owner = await hybridSetup("own");
    const stranger = await setup("str");
    expect((await request(`/workspaces/${owner.ws}/sync/replica?protocol=1`, { method: "GET", token: stranger.token })).status).toBe(403);
    expect((await request(`/workspaces/${owner.ws}/sync/replica/changes?protocol=1&cursor=x`, { method: "GET", token: stranger.token })).status).toBe(403);
    expect((await request(`/workspaces/${owner.ws}/sync/mode`, { method: "PUT", token: stranger.token, body: { mode: "local" } })).status).toBe(403);
    await request("/sync/devices", { method: "POST", token: stranger.token, body: { deviceId: randomUUID(), name: "x" } });
    const forged = await request(`/workspaces/${owner.ws}/sync/ops`, {
      method: "POST",
      token: stranger.token,
      body: { protocol: 1, deviceId: owner.deviceId, ops: [op(owner.deviceId, { entity: "list", entityId: randomUUID(), kind: "create", fields: { name: "x" } })] }
    });
    expect(forged.status).toBe(403);
  });

  it("лента изменений ловит запись обычным REST и удаление; курсор не теряет изменения", async () => {
    const s = await hybridSetup("feed");
    const first = await s.call<{ id: string }>("POST", "/lists", { name: "REST-список" });
    const snap = (await s.call<ReplicaSnapshot>("GET", "/sync/replica?protocol=1")).data;
    expect(snap.entities.list.map((l) => l.name)).toContain("REST-список");
    expect(snap.included).toEqual(expect.arrayContaining(["list", "listItem", "note", "task"]));

    const item = await s.call<{ id: string }>("POST", `/lists/${first.data.id}/items`, { label: "Хлеб" });
    await s.call("PATCH", `/lists/${first.data.id}/items/${item.data.id}`, { checked: true });
    const pulled = (await s.call<ReplicaPull>("GET", `/sync/replica/changes?protocol=1&cursor=${encodeURIComponent(snap.cursor)}`)).data;
    const change = pulled.changes.find((c) => c.entity === "listItem" && c.id === item.data.id);
    expect(change?.doc).toMatchObject({ label: "Хлеб", checked: true });

    await s.call("DELETE", `/lists/${first.data.id}/items/${item.data.id}`);
    const after = (await s.call<ReplicaPull>("GET", `/sync/replica/changes?protocol=1&cursor=${encodeURIComponent(pulled.cursor)}`)).data;
    expect(after.changes.find((c) => c.id === item.data.id)?.doc).toBeNull();
    // повторный pull с новым курсором ничего не возвращает
    const quiet = (await s.call<ReplicaPull>("GET", `/sync/replica/changes?protocol=1&cursor=${encodeURIComponent(after.cursor)}`)).data;
    expect(quiet.changes).toEqual([]);
  });

  it("приём операций: создание, идемпотентный повтор, op_id_reuse, откат устройства, будущее время", async () => {
    const s = await hybridSetup("ops");
    const push = (ops: SyncOp[], deviceId = s.deviceId) => s.call<PushSyncOpsResult>("POST", "/sync/ops", { protocol: 1, deviceId, ops });
    const listId = randomUUID();
    const create = op(s.deviceId, { entity: "list", entityId: listId, kind: "create", fields: { name: "Офлайн" } });
    const r1 = await push([create]);
    expect(r1.status).toBe(201);
    expect(r1.data.results[0]).toMatchObject({ outcome: "applied" });

    const replay = await push([create]);
    expect(replay.data.results[0]).toMatchObject({ outcome: "applied" });
    const lists = await s.call<Array<{ id: string }>>("GET", "/lists");
    expect(lists.data.filter((l) => l.id === listId)).toHaveLength(1);

    const reuse = await push([{ ...create, fields: { name: "Другое тело" } }]);
    expect(reuse.data.results[0]).toMatchObject({ outcome: "rejected", reason: "op_id_reuse" });

    const rolledBack = await push([op(s.deviceId, { entity: "list", entityId: randomUUID(), kind: "create", fields: { name: "после отката" } })].map((o) => ({ ...o, deviceSeq: create.deviceSeq })));
    expect(rolledBack.data.results[0]).toMatchObject({ outcome: "rejected", reason: "device_rolled_back" });

    const future = await push([op(s.deviceId, { entity: "list", entityId: randomUUID(), kind: "create", fields: { name: "из будущего" } }, Date.now() + 3 * 24 * 3600 * 1000)]);
    expect(future.data.results[0]).toMatchObject({ outcome: "rejected", reason: "hlc_in_future" });

    const noWrite = await push([op(s.deviceId, { entity: "note", entityId: randomUUID(), kind: "patch", fields: { isTemplate: true }, expectedRevision: 1 })]);
    expect(noWrite.status).toBe(400); // поля вне протокола не принимаются
  });

  it("удаление против правки, проигранное поле, пункт в удалённый список", async () => {
    const s = await hybridSetup("merge");
    const push = (ops: SyncOp[]) => s.call<PushSyncOpsResult>("POST", "/sync/ops", { protocol: 1, deviceId: s.deviceId, ops });
    const listId = randomUUID();
    const itemId = randomUUID();
    const t0 = Date.now();
    await push([
      op(s.deviceId, { entity: "list", entityId: listId, kind: "create", fields: { name: "L" } }, t0),
      op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "create", fields: { label: "Сыр" } }, t0 + 1)
    ]);

    // поздняя правка побеждает раннюю, доставленную позже
    const late = await push([op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { label: "Поздняя" } }, t0 + 5000)]);
    expect(late.data.results[0]?.outcome).toBe("applied");
    const early = await push([op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { label: "Ранняя" } }, t0 + 2000)]);
    expect(early.data.results[0]).toMatchObject({ outcome: "superseded", lost: { label: "Поздняя" } });
    expect(((await s.call<{ items: Array<{ label: string }> }>("GET", `/lists/${listId}`)).data.items[0])?.label).toBe("Поздняя");

    // двое отметили → без конфликта, checkedBy проставил узел
    const check = await push([op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { checked: true } }, t0 + 6000)]);
    expect(check.data.results[0]?.outcome).toBe("applied");
    const again = await push([op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { checked: true } }, t0 + 6100)]);
    expect(again.data.results[0]?.outcome).toBe("applied");
    expect(((await s.call<{ items: Array<{ checked: boolean; checkedById: string | null }> }>("GET", `/lists/${listId}`)).data.items[0])?.checkedById).not.toBeNull();

    // удаление списка без архива запрещено так же, как в REST
    const noArchive = await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "delete" })]);
    expect(noArchive.data.results[0]).toMatchObject({ outcome: "rejected", reason: "invalid" });
    await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "patch", fields: { archivedAt: new Date().toISOString() } }, t0 + 7000)]);

    // удаление пункта; потом правка того же пункта → конфликт entity_deleted
    await push([op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "delete" })]);
    const edit = await push([op(s.deviceId, { entity: "listItem", entityId: itemId, parentId: listId, kind: "patch", fields: { label: "Воскрес" } }, t0 + 9000)]);
    expect(edit.data.results[0]).toMatchObject({ outcome: "conflict", reason: "entity_deleted" });
    expect(((await s.call<{ items: unknown[] }>("GET", `/lists/${listId}`)).data.items)).toHaveLength(0);

    // удаляем список; пункт в удалённый список → parent_deleted
    await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "delete" })]);
    const orphan = await push([op(s.deviceId, { entity: "listItem", entityId: randomUUID(), parentId: listId, kind: "create", fields: { label: "в пустоту" } })]);
    expect(orphan.data.results[0]).toMatchObject({ outcome: "conflict", reason: "parent_deleted" });
    const nowhere = await push([op(s.deviceId, { entity: "listItem", entityId: randomUUID(), parentId: randomUUID(), kind: "create", fields: { label: "нет списка" } })]);
    expect(nowhere.data.results[0]).toMatchObject({ outcome: "rejected", reason: "parent_missing" });
  });

  it("правка REST после офлайн-времени операции не затирается (замена штампа по updatedAt)", async () => {
    const s = await hybridSetup("restwins");
    const push = (ops: SyncOp[]) => s.call<PushSyncOpsResult>("POST", "/sync/ops", { protocol: 1, deviceId: s.deviceId, ops });
    const list = await s.call<{ id: string }>("POST", "/lists", { name: "Исходное" });
    const oldWall = Date.now() - 3600_000; // устройство правило час назад, а REST — только что
    await s.call("PATCH", `/lists/${list.data.id}`, { name: "REST новее" });
    const r = await push([op(s.deviceId, { entity: "list", entityId: list.data.id, kind: "patch", fields: { name: "Офлайн старее" } }, oldWall)]);
    expect(r.data.results[0]).toMatchObject({ outcome: "superseded", lost: { name: "REST новее" } });
  });

  it("запись REST после sync обесценивает штамп поля, а запись sync чужого поля не сдвигает штампы остальных", async () => {
    const s = await hybridSetup("stamps");
    const push = (ops: SyncOp[]) => s.call<PushSyncOpsResult>("POST", "/sync/ops", { protocol: 1, deviceId: s.deviceId, ops });
    const hourAgo = Date.now() - 3600_000;
    const listId = randomUUID();
    await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "create", fields: { name: "Старт" } }, hourAgo)]);
    await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "patch", fields: { name: "Из sync" } }, hourAgo + 1000)]);
    // REST правит название «сейчас»: штамп sync (час назад) перестаёт защищать поле
    await s.call("PATCH", `/lists/${listId}`, { name: "Из REST" });
    const older = await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "patch", fields: { name: "Офлайн между" } }, hourAgo + 2000)]);
    expect(older.data.results[0]).toMatchObject({ outcome: "superseded", lost: { name: "Из REST" } });
    // а запись sync в поле kind не должна «освежить» поле name: правка name после REST всё ещё проигрывает REST, а не sync
    await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "patch", fields: { kind: "shopping" } }, Date.now())]);
    const fresh = await push([op(s.deviceId, { entity: "list", entityId: listId, kind: "patch", fields: { name: "Новее REST" } }, Date.now() + 5000)]);
    expect(fresh.data.results[0]?.outcome).toBe("applied");
  });

  it("устройство: незарегистрированное — 409, отозванное — 403; отзыв членства закрывает ленту", async () => {
    const s = await hybridSetup("dev");
    const body = (deviceId: string) => ({ protocol: 1, deviceId, ops: [op(deviceId, { entity: "list", entityId: randomUUID(), kind: "create", fields: { name: "z" } })] });
    const unknown = await s.call<{ code: string }>("POST", "/sync/ops", body(randomUUID()));
    expect(unknown.status).toBe(409);
    expect(unknown.data).toMatchObject({ code: "device_unknown" });

    expect((await request(`/sync/devices/${s.deviceId}`, { method: "DELETE", token: s.token })).status).toBe(200);
    const revoked = await s.call<{ code: string }>("POST", "/sync/ops", body(s.deviceId));
    expect(revoked.status).toBe(403);
    expect(revoked.data).toMatchObject({ code: "device_revoked" });
    // отозванное устройство не может «воскреснуть» повторной регистрацией
    expect((await request("/sync/devices", { method: "POST", token: s.token, body: { deviceId: s.deviceId, name: "ПК" } })).status).toBe(403);
  });

  it("слишком старый курсор → 410 resync_required; мусорный курсор тоже", async () => {
    const s = await hybridSetup("old");
    const old = Buffer.from(JSON.stringify({ x: "1", i: "0", t: Date.now() - 200 * 24 * 3600 * 1000 })).toString("base64url");
    const r = await s.call<{ code: string }>("GET", `/sync/replica/changes?protocol=1&cursor=${old}`);
    expect(r.status).toBe(410);
    expect(r.data).toMatchObject({ code: "resync_required" });
    expect((await s.call("GET", `/sync/replica/changes?protocol=1&cursor=%25%25`)).status).toBe(410);
  });

  it("два устройства разных пользователей сходятся с узлом через настоящий HTTP (случайные операции, сбои, REST параллельно)", async () => {
    const a = await hybridSetup("fa");
    // второй участник того же пространства: приглашаем через БД, как в других интеграционных тестах
    const b = await setup("fb");
    const bUserId = (await prisma.asSystem((tx) => tx.user.findFirstOrThrow({ where: { email: `${emailPrefix}-fb@example.test` }, select: { id: true } }))).id;
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: a.ws, userId: bUserId, role: "member" } }));

    let n = 0;
    const engines = [
      new ReplicaEngine({ transport: new HttpTransport(a.token, a.ws), storage: new MemoryReplicaStorage(), userId: "ua", workspaceId: a.ws, userName: "A" }),
      new ReplicaEngine({ transport: new HttpTransport(b.token, a.ws), storage: new MemoryReplicaStorage(), userId: bUserId, workspaceId: a.ws, userName: "B" })
    ];
    for (const e of engines) await e.sync();

    let state = 12345;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)] as T;
    for (let step = 0; step < 60; step += 1) {
      const e = pick(engines);
      const lists = e.lists().lists;
      const roll = random();
      if (roll < 0.2 || lists.length === 0) {
        await e.enqueue({ entity: "list", kind: "create", fields: { name: `L${step}` } });
      } else if (roll < 0.5) {
        await e.enqueue({ entity: "listItem", kind: "create", parentId: pick(lists).id, fields: { label: `i${step}` } });
      } else if (roll < 0.75) {
        const items = lists.flatMap((l) => l.items.map((i) => ({ l, i })));
        if (items.length) {
          const { l, i } = pick(items);
          await e.enqueue({ entity: "listItem", kind: "patch", entityId: i.id, parentId: l.id, fields: pick([{ checked: random() < 0.5 }, { label: `p${step}` }, { note: `n${step}` }]) });
        }
      } else if (roll < 0.85) {
        const items = lists.flatMap((l) => l.items.map((i) => ({ l, i })));
        if (items.length) {
          const { l, i } = pick(items);
          await e.enqueue({ entity: "listItem", kind: "delete", entityId: i.id, parentId: l.id });
        }
      } else if (roll < 0.9) {
        // обычный REST-пользователь правит тот же список параллельно
        await a.call("PATCH", `/lists/${pick(lists).id}`, { name: `rest${step}` });
      } else {
        n += 1;
        await e.sync();
      }
    }
    for (let round = 0; round < 3; round += 1) for (const e of engines) await e.sync();
    expect(n).toBeGreaterThan(0);

    const server = (await a.call<ReplicaSnapshot>("GET", "/sync/replica?protocol=1")).data;
    const strip = (d: Record<string, unknown>) => {
      const { createdAt: _c, updatedAt: _u, checkedByName: _n, ...rest } = d;
      return rest;
    };
    const byId = (docs: Array<Record<string, unknown>>) => Object.fromEntries(docs.map((d) => [d.id as string, strip(d)]));
    for (const [index, e] of engines.entries()) {
      expect(e.pending(), `устройство ${index}: очередь`).toHaveLength(0);
      const entities = e.entities();
      expect(Object.fromEntries(Object.entries(entities.list).map(([id, d]) => [id, strip(d)])), `устройство ${index}: списки`).toEqual(byId(server.entities.list as never));
      expect(Object.fromEntries(Object.entries(entities.listItem).map(([id, d]) => [id, strip(d)])), `устройство ${index}: пункты`).toEqual(byId(server.entities.listItem as never));
    }
  }, 120_000);

  it("этап 3: заметки — CAS по revision без слияния, корзина; задачи — LWW по полю, журнал и revision ведёт узел", async () => {
    const s = await hybridSetup("n3");
    const push = (ops: SyncOp[]) => s.call<PushSyncOpsResult>("POST", "/sync/ops", { protocol: 1, deviceId: s.deviceId, ops });
    const t0 = Date.now();

    // --- заметка
    const noteId = randomUUID();
    const made = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "create", fields: { title: "Офлайн-заметка", body: "раз" } }, t0)]);
    expect(made.data.results[0]?.outcome).toBe("applied");
    const row = await s.call<{ id: string; revision: number; number: number | null }>("GET", `/notes/${noteId}`);
    expect(row.data).toMatchObject({ id: noteId, revision: 1 });
    expect(row.data.number).not.toBeNull(); // номер выдал триггер узла, не клиент

    const ok = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "patch", fields: { body: "раз два" }, expectedRevision: 1 }, t0 + 10)]);
    expect(ok.data.results[0]?.outcome).toBe("applied");
    expect((await s.call<{ revision: number; body: string }>("GET", `/notes/${noteId}`)).data).toMatchObject({ revision: 2, body: "раз два" });

    const stale = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "patch", fields: { body: "устаревшее" }, expectedRevision: 1 }, t0 + 20)]);
    expect(stale.data.results[0]).toMatchObject({ outcome: "conflict", reason: "revision" });
    expect((await s.call<{ body: string }>("GET", `/notes/${noteId}`)).data.body).toBe("раз два");

    const noRevision = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "patch", fields: { body: "без ревизии" } }, t0 + 30)]);
    expect(noRevision.data.results[0]).toMatchObject({ outcome: "rejected", reason: "invalid" });

    // REST-правка сдвигает ревизию: офлайн-устройство с прежней основой получает явный конфликт
    await s.call("PATCH", `/notes/${noteId}`, { body: "REST", expectedRevision: 2 });
    const behind = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "patch", fields: { body: "поверх" }, expectedRevision: 2 }, t0 + 40)]);
    expect(behind.data.results[0]).toMatchObject({ outcome: "conflict", reason: "revision" });

    // удаление в корзину; правка после него — conflict entity_deleted; в снимок корзина не попадает
    const trashed = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "delete" })]);
    expect(trashed.data.results[0]?.outcome).toBe("applied");
    expect((await s.call<{ deletedAt: string | null }>("GET", `/notes/${noteId}`)).data.deletedAt).not.toBeNull();
    const afterTrash = await push([op(s.deviceId, { entity: "note", entityId: noteId, kind: "patch", fields: { body: "в корзину" }, expectedRevision: 3 }, t0 + 50)]);
    expect(afterTrash.data.results[0]).toMatchObject({ outcome: "conflict", reason: "entity_deleted" });
    const snap = (await s.call<ReplicaSnapshot>("GET", "/sync/replica?protocol=1")).data;
    expect(snap.entities.note.find((n) => n.id === noteId)).toBeUndefined();

    // --- задача
    const taskId = randomUUID();
    const taskMade = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "create", fields: { title: "Офлайн-задача", priority: "low", status: "in_progress" } }, t0)]);
    expect(taskMade.data.results[0]?.outcome).toBe("applied");
    expect((await getTask(s.call, taskId))).toMatchObject({ status: "in_progress", priority: "low" });

    const checklistId = randomUUID();
    const checklistMade = await push([op(s.deviceId, { entity: "task", entityId: checklistId, kind: "create", fields: { title: "Проверить документы", parentId: taskId } }, t0 + 1)]);
    expect(checklistMade.data.results[0]?.outcome).toBe("applied");
    expect(await getTask(s.call, checklistId)).toMatchObject({ parentId: taskId, status: "todo" });
    const missingParent = await push([op(s.deviceId, { entity: "task", entityId: randomUUID(), kind: "create", fields: { title: "Сирота", parentId: randomUUID() } }, t0 + 2)]);
    expect(missingParent.data.results[0]).toMatchObject({ outcome: "rejected", reason: "parent_missing" });

    const done = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "patch", fields: { status: "done" } }, t0 + 100)]);
    expect(done.data.results[0]?.outcome).toBe("applied");
    const afterDone = (await getTask(s.call, taskId));
    expect(afterDone.status).toBe("done");
    expect(afterDone.completedAt).not.toBeNull(); // completedAt — дело узла

    // другое поле с более ранним HLC не проигрывает: LWW идёт по полю, а не по сущности
    const otherField = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "patch", fields: { priority: "high" } }, t0 + 50)]);
    expect(otherField.data.results[0]?.outcome).toBe("applied");
    const sameField = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "patch", fields: { status: "todo" } }, t0 + 60)]);
    expect(sameField.data.results[0]).toMatchObject({ outcome: "superseded", lost: { status: "done" } });

    const staleTask = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "patch", fields: { title: "Старая основа" }, expectedRevision: 1 }, t0 + 500)]);
    expect(staleTask.data.results[0]).toMatchObject({ outcome: "conflict", reason: "revision" });

    // поле, которого нет в протоколе (исполнитель), — не принимается вовсе
    const forbidden = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "patch", fields: { assigneeId: "x" } })]);
    expect(forbidden.status).toBe(400);

    await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "delete" })]);
    expect(await getTask(s.call, taskId)).toBeUndefined();
    expect(await getTask(s.call, checklistId)).toBeUndefined();
    const late = await push([op(s.deviceId, { entity: "task", entityId: taskId, kind: "patch", fields: { title: "позже" } }, t0 + 900)]);
    expect(late.data.results[0]).toMatchObject({ outcome: "conflict", reason: "entity_deleted" });
  });

  it("этап 3: два устройства сходятся на заметках и задачах через настоящий HTTP", async () => {
    const a = await hybridSetup("n3a");
    const b = await setup("n3b");
    const bUserId = (await prisma.asSystem((tx) => tx.user.findFirstOrThrow({ where: { email: `${emailPrefix}-n3b@example.test` }, select: { id: true } }))).id;
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: a.ws, userId: bUserId, role: "member" } }));
    const mk = (token: string, userId: string) => new ReplicaEngine({ transport: new HttpTransport(token, a.ws), storage: new MemoryReplicaStorage(), userId, workspaceId: a.ws });
    const [ea, eb] = [mk(a.token, "ua"), mk(b.token, bUserId)] as [ReplicaEngine, ReplicaEngine];
    await ea.sync();
    await eb.sync();

    const note = await ea.enqueue({ entity: "note", kind: "create", fields: { title: "Общая", body: "старт" } });
    const task = await ea.enqueue({ entity: "task", kind: "create", fields: { title: "Сделать" } });
    await ea.sync();
    await eb.sync();
    await ea.enqueue({ entity: "note", kind: "patch", entityId: note.entityId, fields: { body: "от A" } });
    await eb.enqueue({ entity: "note", kind: "patch", entityId: note.entityId, fields: { body: "от B" } });
    await ea.enqueue({ entity: "task", kind: "patch", entityId: task.entityId, fields: { status: "done" } });
    await eb.enqueue({ entity: "task", kind: "patch", entityId: task.entityId, fields: { priority: "high" } });
    await ea.sync();
    await eb.sync();
    await ea.sync();

    expect(eb.conflicts().some((c) => c.reason === "revision")).toBe(true); // B проиграл заметку явно
    for (const e of [ea, eb]) {
      expect(e.notes().find((n) => n.id === note.entityId)?.body).toBe("от A");
      expect(e.tasks().find((t) => t.id === task.entityId)).toMatchObject({ status: "done", priority: "high" });
    }
    // «сохранить мою поверх»
    await eb.retryConflict(eb.conflicts().find((c) => c.reason === "revision")!.opId);
    await eb.sync();
    await ea.sync();
    expect(ea.notes().find((n) => n.id === note.entityId)?.body).toBe("от B");
  }, 60_000);

  it("отзыв членства: следующий sync стирает копию на устройстве", async () => {
    const a = await hybridSetup("ra");
    const b = await setup("rb");
    const bUserId = (await prisma.asSystem((tx) => tx.user.findFirstOrThrow({ where: { email: `${emailPrefix}-rb@example.test` }, select: { id: true } }))).id;
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: a.ws, userId: bUserId, role: "member" } }));
    const storage = new MemoryReplicaStorage();
    const engine = new ReplicaEngine({ transport: new HttpTransport(b.token, a.ws), storage, userId: bUserId, workspaceId: a.ws });
    await engine.sync();
    expect(engine.hasCopy()).toBe(true);
    await prisma.asSystem((tx) => tx.workspaceMember.deleteMany({ where: { workspaceId: a.ws, userId: bUserId } }));
    const report = await engine.sync();
    expect(report.phase).toBe("revoked");
    expect(await storage.load(bUserId, a.ws)).toBeNull();
  });
});
