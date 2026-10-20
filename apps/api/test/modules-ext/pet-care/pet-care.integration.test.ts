import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MODULE_CATALOG, ORION_MODULE_IDS, orionModuleIdSchema } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";
import { SNAPSHOT_MODEL_REGISTRY } from "../../../src/sync/snapshot-registry";
import { SYNC_CLASSIFICATION } from "../../../src/sync/sync-classification";

/**
 * Pet Care (образец модуля по манифесту, G5/G10): CRUD, изоляция второго пользователя (API и RLS),
 * 409 при выключенном модуле, сохранность данных при выключении и подключение через сгенерированные реестры.
 */
describe("Pet Care module connected by manifest", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `pet-care-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
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
        // Каскад от пространства обязан унести и таблицы модуля.
        const orphans = await tx.petCarePet.count({ where: { workspaceId: { in: workspaceIds } } });
        if (orphans > 0) throw new Error(`Cleanup left ${orphans} pet(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = any>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  let counter = 0;
  async function setup() {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${counter++}@example.test`, password: "integration-password-123", name: "Хозяин" }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    return {
      token,
      ws,
      userId: response.data.user.id,
      call: (method: string, path: string, body?: unknown) => request(`/workspaces/${ws}/pet-care${path}`, { method, token, body }),
      setModule: (enabled: boolean) => request(`/workspaces/${ws}/modules/pet-care`, { method: "PATCH", token, body: { enabled } })
    };
  }

  it("is registered through the generated registries, not by hand", () => {
    expect((ORION_MODULE_IDS as readonly string[]).includes("pet-care")).toBe(true);
    expect(orionModuleIdSchema.safeParse("pet-care").success).toBe(true);
    // Закрытый enum остаётся закрытым: произвольная строка по-прежнему не принимается.
    expect(orionModuleIdSchema.safeParse("not-a-module").success).toBe(false);
    expect(MODULE_CATALOG.find((item) => item.id === "pet-care")?.panelId).toBe("pet-care");

    for (const model of ["PetCarePet", "PetCareEntry", "PetCareDay", "PetCareEvent"]) {
      expect(SNAPSHOT_MODEL_REGISTRY.find((item) => item.model === model)?.policy).toBe("included");
      expect(SYNC_CLASSIFICATION[model]).toBeDefined();
    }
  });

  it("creates, lists, updates and deletes pets and care entries", async () => {
    const { call } = await setup();
    expect((await call("GET", "/pets")).data).toEqual([]);

    const created = await call("POST", "/pets", { name: "  Барсик ", species: "cat", birthday: "2020-05-17", notes: "Любит рыбу" });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ name: "Барсик", species: "cat", birthday: "2020-05-17", notes: "Любит рыбу" });

    const defaults = await call("POST", "/pets", { name: "Рыжик" });
    expect(defaults.data).toMatchObject({ species: "other", birthday: null, notes: "" });

    expect((await call("POST", "/pets", { name: "   " })).status).toBe(400);
    expect((await call("POST", "/pets", { name: "Х", species: "dragon" })).status).toBe(400);
    expect((await call("POST", "/pets", { name: "Х", birthday: "17.05.2020" })).status).toBe(400);

    const petId = created.data.id as string;
    const updated = await call("PATCH", `/pets/${petId}`, { name: "Барсик II", birthday: null });
    expect(updated.data).toMatchObject({ name: "Барсик II", birthday: null, species: "cat" });
    expect((await call("GET", "/pets")).data.map((p: { name: string }) => p.name)).toEqual(["Барсик II", "Рыжик"]);

    const feeding = await call("POST", `/pets/${petId}/entries`, { kind: "feeding", note: "Сухой корм" });
    expect(feeding.status).toBe(201);
    const vet = await call("POST", `/pets/${petId}/entries`, { kind: "vet", occurredAt: "2020-01-01T10:00:00.000Z" });
    expect(vet.data).toMatchObject({ kind: "vet", occurredAt: "2020-01-01T10:00:00.000Z", note: "" });
    expect((await call("POST", `/pets/${petId}/entries`, { kind: "bath" })).status).toBe(400);

    const entries = await call("GET", `/pets/${petId}/entries`);
    expect(entries.data.map((e: { kind: string }) => e.kind)).toEqual(["feeding", "vet"]); // свежие сверху

    expect((await call("DELETE", `/pets/${petId}/entries/${feeding.data.id}`)).status).toBe(204);
    expect((await call("GET", `/pets/${petId}/entries`)).data).toHaveLength(1);
    expect((await call("DELETE", `/pets/${petId}/entries/${feeding.data.id}`)).status).toBe(404);

    expect((await call("DELETE", `/pets/${petId}`)).status).toBe(204);
    expect((await call("GET", `/pets/${petId}/entries`)).status).toBe(404);
    expect((await call("GET", "/pets")).data).toHaveLength(1);
  });

  it("isolates a second user: API membership check, per-workspace ownership and database RLS", async () => {
    const alice = await setup();
    const bob = await setup();
    const pet = await alice.call("POST", "/pets", { name: "Секретный" });
    await alice.call("POST", `/pets/${pet.data.id}/entries`, { kind: "walk" });

    // Чужое пространство: нет членства → 403.
    const foreign = await request(`/workspaces/${alice.ws}/pet-care/pets`, { method: "GET", token: bob.token });
    expect(foreign.status).toBe(403);
    expect((await request(`/workspaces/${alice.ws}/pet-care/pets`, { method: "POST", token: bob.token, body: { name: "Взлом" } })).status).toBe(403);

    // Свое пространство, но чужой питомец → 404, а не данные.
    expect((await bob.call("GET", `/pets/${pet.data.id}/entries`)).status).toBe(404);
    expect((await bob.call("PATCH", `/pets/${pet.data.id}`, { name: "Взлом" })).status).toBe(404);
    expect((await bob.call("DELETE", `/pets/${pet.data.id}`)).status).toBe(404);
    expect((await bob.call("GET", "/pets")).data).toEqual([]);

    // RLS отдельно от кода: прямой запрос от имени Боба не видит строк Алисы, от имени Алисы — видит.
    const hidden = await prisma.withUser(bob.userId, (tx) => tx.petCarePet.findMany({ where: { workspaceId: alice.ws } }));
    const hiddenEntries = await prisma.withUser(bob.userId, (tx) => tx.petCareEntry.findMany({ where: { workspaceId: alice.ws } }));
    expect(hidden).toEqual([]);
    expect(hiddenEntries).toEqual([]);
    const visible = await prisma.withUser(alice.userId, (tx) => tx.petCarePet.findMany({ where: { workspaceId: alice.ws } }));
    expect(visible).toHaveLength(1);

    // Алиса по-прежнему видит свои данные.
    expect((await alice.call("GET", "/pets")).data).toHaveLength(1);
  });

  it("answers 409 while the module is disabled, keeps the data, and works again after enabling", async () => {
    const { call, setModule } = await setup();
    const pet = await call("POST", "/pets", { name: "Останется" });
    await call("POST", `/pets/${pet.data.id}/entries`, { kind: "medication", note: "Таблетка" });

    const off = await setModule(false);
    expect(off.status).toBe(200);
    for (const [method, path, body] of [
      ["GET", "/pets", undefined],
      ["POST", "/pets", { name: "Нельзя" }],
      ["GET", `/pets/${pet.data.id}/entries`, undefined],
      ["DELETE", `/pets/${pet.data.id}`, undefined]
    ] as const) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(409);
    }

    expect((await setModule(true)).status).toBe(200);
    expect((await call("GET", "/pets")).data.map((p: { name: string }) => p.name)).toEqual(["Останется"]);
    expect((await call("GET", `/pets/${pet.data.id}/entries`)).data).toHaveLength(1);
  });

  it("keeps the pet profile for the vet: breed, clinic contact, chronic conditions and allergies", async () => {
    const { call } = await setup();
    const created = await call("POST", "/pets", { name: "Мурчик", species: "cat", breed: " Британец ", vetContact: "+7 900 000-00-00", chronic: "гастрит", allergies: "курица" });
    expect(created.data).toMatchObject({ breed: "Британец", vetContact: "+7 900 000-00-00", chronic: "гастрит", allergies: "курица" });
    expect((await call("POST", "/pets", { name: "Без профиля" })).data).toMatchObject({ breed: "", vetContact: "", chronic: "", allergies: "" });
    const patched = await call("PATCH", `/pets/${created.data.id}`, { allergies: "" });
    expect(patched.data).toMatchObject({ allergies: "", chronic: "гастрит" });
  });

  it("stores the wellbeing diary by day: upsert is idempotent, status is derived, input is validated", async () => {
    const { call } = await setup();
    const petId = (await call("POST", "/pets", { name: "Мурчик", species: "cat" })).data.id as string;
    const url = (day: string) => `/pets/${petId}/days/${day}`;

    const first = await call("PUT", url("2026-10-18"), { vomitingCount: 2, stool: "liquid", weightKg: 4.4, symptoms: [{ id: "vomiting", severity: "severe", count: 2, time: "night" }] });
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ day: "2026-10-18", status: "bad", statusAuto: true, vomitingCount: 2, weightKg: 4.4, temperature: null });
    expect(first.data.symptoms).toEqual([{ id: "vomiting", severity: "severe", count: 2, time: "night", note: "" }]);

    // Повторное сохранение — та же строка, а не вторая; ручной статус уважается.
    const again = await call("PUT", url("2026-10-18"), { status: "good", statusAuto: false, note: "Всё прошло" });
    expect(again.data).toMatchObject({ id: first.data.id, status: "good", statusAuto: false, vomitingCount: 0, symptoms: [], weightKg: null, note: "Всё прошло" });

    await call("PUT", url("2026-10-20"), { stool: "blood" });
    await call("PUT", url("2026-10-19"), {});
    const list = await call("GET", `/pets/${petId}/days?from=2026-10-18&to=2026-10-20`);
    expect(list.data.map((d: { day: string; status: string }) => [d.day, d.status])).toEqual([
      ["2026-10-18", "good"],
      ["2026-10-19", "good"],
      ["2026-10-20", "critical"]
    ]);
    expect((await call("GET", `/pets/${petId}/days?from=2026-10-19&to=2026-10-19`)).data).toHaveLength(1);
    expect((await call("GET", `/pets/${petId}/days`)).status).toBe(200); // окно по умолчанию

    for (const [day, body] of [
      ["2026-02-31", {}],
      ["вчера", {}],
      ["2026-10-18", { appetite: "huge" }],
      ["2026-10-18", { temperature: 12 }],
      ["2026-10-18", { vomitingCount: -1 }],
      ["2026-10-18", { symptoms: [{ id: "vomiting" }, { id: "vomiting" }] }]
    ] as const) {
      expect((await call("PUT", url(day), body)).status, `${day} ${JSON.stringify(body)}`).toBe(400);
    }
    expect((await call("GET", `/pets/${petId}/days?from=2020-01-01&to=2026-10-20`)).status).toBe(400);
    expect((await call("GET", `/pets/${petId}/days?from=2026-10-20&to=2026-10-01`)).status).toBe(400);

    expect((await call("DELETE", url("2026-10-18"))).status).toBe(204);
    expect((await call("DELETE", url("2026-10-18"))).status).toBe(404);
    expect((await call("GET", `/pets/${petId}/days?from=2026-10-18&to=2026-10-20`)).data).toHaveLength(2);

    // Удаление питомца уносит дневник.
    expect((await call("DELETE", `/pets/${petId}`)).status).toBe(204);
    expect((await call("GET", `/pets/${petId}/days`)).status).toBe(404);
  });

  it("records pet events and removes them one by one", async () => {
    const { call } = await setup();
    const petId = (await call("POST", "/pets", { name: "Мурчик" })).data.id as string;
    const food = await call("POST", `/pets/${petId}/events`, { day: "2026-10-10", type: "food_change", title: "Новый корм" });
    expect(food.status).toBe(201);
    expect(food.data).toMatchObject({ day: "2026-10-10", type: "food_change", title: "Новый корм", note: "" });
    await call("POST", `/pets/${petId}/events`, { day: "2026-10-12", title: "Гости" });
    expect((await call("POST", `/pets/${petId}/events`, { day: "2026-10-12", type: "party" })).status).toBe(400);
    expect((await call("POST", `/pets/${petId}/events`, { day: "2026-13-01" })).status).toBe(400);

    const list = await call("GET", `/pets/${petId}/events?from=2026-10-01&to=2026-10-31`);
    expect(list.data.map((e: { day: string; type: string }) => [e.day, e.type])).toEqual([
      ["2026-10-12", "note"],
      ["2026-10-10", "food_change"]
    ]);
    expect((await call("GET", `/pets/${petId}/events?from=2026-10-11&to=2026-10-11`)).data).toEqual([]);

    expect((await call("DELETE", `/pets/${petId}/events/${food.data.id}`)).status).toBe(204);
    expect((await call("DELETE", `/pets/${petId}/events/${food.data.id}`)).status).toBe(404);
    expect((await call("GET", `/pets/${petId}/events?from=2026-10-01&to=2026-10-31`)).data).toHaveLength(1);
  });

  it("imports a MurHP backup without duplicating on repeat and without erasing what is already filled in", async () => {
    const { call } = await setup();
    const petId = (await call("POST", "/pets", { name: "Мурчик", species: "cat", breed: "Британец" })).data.id as string;
    const backup = {
      app: "murhp",
      version: 1,
      exportedAt: "2026-10-19T10:00:00Z",
      cat: { name: "Кот", birthdate: "2020-05-17", breed: "Дворовый", weightKg: 5.1, vetContact: "+7 900", chronic: "", allergies: "курица", notes: "" },
      days: [
        { date: "2026-10-01", status: "bad", statusAuto: false, appetite: "reduced", activity: "weird", stool: "liquid", water: "normal", vomitingCount: 2, weightKg: 5, temperature: 38.6, meds: "церукал", note: "плохо", symptoms: [{ id: "vomiting", severity: "severe", count: 2, time: "night", note: "" }] },
        { date: "2026-10-02", status: "good" },
        { date: "2026-02-31", status: "good" },
        "мусор"
      ],
      events: [{ date: "2026-10-01", type: "food_change", title: "Новый корм", note: "" }, { date: "вчера", type: "note" }]
    };

    const first = await call("POST", `/pets/${petId}/import-murhp`, { backup });
    expect(first.status).toBe(201);
    expect(first.data).toEqual({ daysCreated: 2, daysUpdated: 0, daysSkipped: 0, eventsCreated: 1, eventsSkipped: 0, invalidRows: 3, profileFilled: ["день рождения", "контакт ветеринара", "аллергии", "вес"] });

    const days = (await call("GET", `/pets/${petId}/days?from=2026-10-01&to=2026-10-02`)).data;
    expect(days[0]).toMatchObject({ day: "2026-10-01", status: "bad", statusAuto: false, activity: "", stool: "liquid", temperature: 38.6, meds: "церукал" });
    const pet = (await call("GET", "/pets")).data[0];
    expect(pet).toMatchObject({ breed: "Британец", birthday: "2020-05-17", allergies: "курица", vetContact: "+7 900" });

    // Повтор: ничего не дублируется и профиль уже не «заполняется» заново.
    const repeat = await call("POST", `/pets/${petId}/import-murhp`, { backup });
    expect(repeat.data).toEqual({ daysCreated: 0, daysUpdated: 0, daysSkipped: 2, eventsCreated: 0, eventsSkipped: 1, invalidRows: 3, profileFilled: [] });
    expect((await call("GET", `/pets/${petId}/events?from=2026-10-01&to=2026-10-31`)).data).toHaveLength(1);

    // Своя правка в ORION переживает обычный импорт и заменяется только по явной просьбе.
    await call("PUT", `/pets/${petId}/days/2026-10-02`, { note: "Моя правка" });
    await call("POST", `/pets/${petId}/import-murhp`, { backup });
    expect((await call("GET", `/pets/${petId}/days?from=2026-10-02&to=2026-10-02`)).data[0].note).toBe("Моя правка");
    const replaced = await call("POST", `/pets/${petId}/import-murhp`, { backup, overwrite: true });
    expect(replaced.data).toMatchObject({ daysCreated: 0, daysUpdated: 2, daysSkipped: 0 });
    expect((await call("GET", `/pets/${petId}/days?from=2026-10-02&to=2026-10-02`)).data[0].note).toBe("");

    expect((await call("POST", `/pets/${petId}/import-murhp`, { backup: { app: "other", days: [] } })).status).toBe(400);
    expect((await call("POST", `/pets/${petId}/import-murhp`, { backup: "строка" })).status).toBe(400);
  });

  it("isolates the diary: foreign workspace, foreign pet and database RLS", async () => {
    const alice = await setup();
    const bob = await setup();
    const petId = (await alice.call("POST", "/pets", { name: "Секретный" })).data.id as string;
    await alice.call("PUT", `/pets/${petId}/days/2026-10-18`, { note: "приватно" });
    const event = await alice.call("POST", `/pets/${petId}/events`, { day: "2026-10-18", title: "приватно" });

    const foreign = (method: string, path: string, body?: unknown) => request(`/workspaces/${alice.ws}/pet-care${path}`, { method, token: bob.token, body });
    expect((await foreign("GET", `/pets/${petId}/days`)).status).toBe(403);
    expect((await foreign("PUT", `/pets/${petId}/days/2026-10-18`, {})).status).toBe(403);
    expect((await foreign("POST", `/pets/${petId}/import-murhp`, { backup: { app: "murhp", days: [] } })).status).toBe(403);

    // Своё пространство Боба, чужой питомец Алисы → 404, а не данные и не запись.
    expect((await bob.call("GET", `/pets/${petId}/days`)).status).toBe(404);
    expect((await bob.call("PUT", `/pets/${petId}/days/2026-10-18`, { note: "взлом" })).status).toBe(404);
    expect((await bob.call("DELETE", `/pets/${petId}/days/2026-10-18`)).status).toBe(404);
    expect((await bob.call("GET", `/pets/${petId}/events`)).status).toBe(404);
    expect((await bob.call("POST", `/pets/${petId}/events`, { day: "2026-10-18" })).status).toBe(404);
    expect((await bob.call("DELETE", `/pets/${petId}/events/${event.data.id}`)).status).toBe(404);
    expect((await bob.call("POST", `/pets/${petId}/import-murhp`, { backup: { app: "murhp", days: [{ date: "2026-10-01" }] } })).status).toBe(404);

    // RLS отдельно от кода.
    const hiddenDays = await prisma.withUser(bob.userId, (tx) => tx.petCareDay.findMany({ where: { workspaceId: alice.ws } }));
    const hiddenEvents = await prisma.withUser(bob.userId, (tx) => tx.petCareEvent.findMany({ where: { workspaceId: alice.ws } }));
    expect(hiddenDays).toEqual([]);
    expect(hiddenEvents).toEqual([]);
    expect(await prisma.withUser(alice.userId, (tx) => tx.petCareDay.count({ where: { workspaceId: alice.ws } }))).toBe(1);
    expect((await alice.call("GET", `/pets/${petId}/days?from=2026-10-18&to=2026-10-18`)).data[0].note).toBe("приватно");
  });

  it("answers 409 for the diary while the module is disabled and keeps the data", async () => {
    const { call, setModule } = await setup();
    const petId = (await call("POST", "/pets", { name: "Останется" })).data.id as string;
    await call("PUT", `/pets/${petId}/days/2026-10-18`, { note: "дневник" });
    await call("POST", `/pets/${petId}/events`, { day: "2026-10-18", title: "событие" });

    expect((await setModule(false)).status).toBe(200);
    for (const [method, path, body] of [
      ["GET", `/pets/${petId}/days`, undefined],
      ["PUT", `/pets/${petId}/days/2026-10-18`, {}],
      ["DELETE", `/pets/${petId}/days/2026-10-18`, undefined],
      ["GET", `/pets/${petId}/events`, undefined],
      ["POST", `/pets/${petId}/events`, { day: "2026-10-18" }],
      ["POST", `/pets/${petId}/import-murhp`, { backup: { app: "murhp", days: [] } }]
    ] as const) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(409);
    }

    expect((await setModule(true)).status).toBe(200);
    expect((await call("GET", `/pets/${petId}/days?from=2026-10-18&to=2026-10-18`)).data[0].note).toBe("дневник");
    expect((await call("GET", `/pets/${petId}/events?from=2026-10-18&to=2026-10-18`)).data).toHaveLength(1);
  });
});
