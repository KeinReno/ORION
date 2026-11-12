import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { WorkspaceTransferPreview } from "@orion/shared-types";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../src/storage/storage-adapter";
import { WorkspaceTransferService } from "../src/sync/workspace-transfer.service";
import { configureApp } from "../src/configure-app";

/**
 * ТЗ-05 §5.5 — «Перенести моё пространство на узел»: экспорт `.orion` → импорт как НОВОЕ
 * пространство. Проверяется главное обещание: ничего существующего не затирается
 * (ID-коллизия, повторный импорт, обрыв посередине).
 */
describe("ТЗ-05: перенос пространства между узлами", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailPrefix = `tz05t-${runId}`;
  const marker = `Перенос${runId.replace(/\W/g, "")}`;
  const storageDir = path.resolve(process.env.STORAGE_DIR ?? "./tmp/integration-documents");

  type Person = { token: string; userId: string; email: string; personal: string };
  let anna: Person; // владелец исходного пространства (на «старом узле»)
  let boris: Person; // тот, кто импортирует на «хост»
  let source: string;
  const ids: { parent?: string; child?: string; note?: string; doc?: string; account?: string } = {};

  async function request<T = unknown>(
    url: string,
    options: { method?: string; token?: string; body?: unknown; form?: FormData; raw?: boolean } = {}
  ): Promise<{ status: number; data: T; text: string; bytes: Buffer }> {
    const response = await fetch(`${baseUrl}${url}`, {
      method: options.method ?? "GET",
      headers: { ...(options.form ? {} : { "Content-Type": "application/json" }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = options.raw ? "" : bytes.toString("utf8");
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: response.status, data: data as T, text, bytes };
  }

  async function register(name: string): Promise<Person> {
    const email = `${emailPrefix}-${name}@example.test`;
    const r = await request<{ accessToken: string; user: { id: string } }>("/auth/register", { method: "POST", body: { email, password: "integration-password-123", name } });
    expect(r.status).toBe(201);
    const spaces = await request<Array<{ id: string }>>("/workspaces/me", { token: r.data.accessToken });
    return { token: r.data.accessToken, userId: r.data.user.id, email, personal: spaces.data[0]!.id };
  }

  function importForm(file: Buffer, fields: Record<string, string>): FormData {
    const form = new FormData();
    form.append("file", new Blob([file]), "перенос.orion");
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return form;
  }

  const importAs = (person: Person, file: Buffer, fields: Record<string, string>) =>
    request<WorkspaceTransferPreview>("/workspaces/import", { method: "POST", token: person.token, form: importForm(file, fields) });

  async function exportFile(passphrase?: string): Promise<Buffer> {
    const r = await request(`/workspaces/${source}/export`, { method: "POST", token: anna.token, body: passphrase ? { passphrase } : {}, raw: true });
    expect(r.status).toBe(201);
    return r.bytes;
  }

  async function counts(workspaceId: string) {
    return prisma.asSystem(async (tx) => ({
      tasks: await tx.task.count({ where: { workspaceId } }),
      notes: await tx.note.count({ where: { workspaceId } }),
      documents: await tx.document.count({ where: { workspaceId } }),
      links: await tx.entityLink.count({ where: { workspaceId } }),
      projects: await tx.project.count({ where: { workspaceId } })
    }));
  }

  const storageEntries = () => (existsSync(storageDir) ? readdirSync(storageDir).sort() : []);

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    anna = await register("anna");
    boris = await register("boris");
    source = anna.personal;

    const project = await request<{ id: string }>(`/workspaces/${source}/projects`, { method: "POST", token: anna.token, body: { name: `Проект ${marker}` } });
    const parent = await request<{ id: string }>(`/workspaces/${source}/tasks`, { method: "POST", token: anna.token, body: { title: `Родитель ${marker}`, projectId: project.data.id } });
    const child = await request<{ id: string }>(`/workspaces/${source}/tasks`, { method: "POST", token: anna.token, body: { title: `Подзадача ${marker}`, parentId: parent.data.id } });
    expect(child.status).toBe(201);
    ids.parent = parent.data.id;
    ids.child = child.data.id;
    const note = await request<{ id: string }>(`/workspaces/${source}/notes`, { method: "POST", token: anna.token, body: { title: `Заметка ${marker}`, body: "текст" } });
    ids.note = note.data.id;
    const link = await request(`/workspaces/${source}/links`, { method: "POST", token: anna.token, body: { sourceType: "note", sourceId: note.data.id, targetType: "task", targetId: parent.data.id } });
    expect(link.status).toBe(201);
    const account = await request<{ id: string }>(`/workspaces/${source}/finance/accounts`, { method: "POST", token: anna.token, body: { name: `Личный ${marker}`, visibility: "private", startingBalance: 500 } });
    expect(account.status).toBe(201);
    ids.account = account.data.id;

    const form = new FormData();
    form.append("files", new Blob([`байты ${marker}`], { type: "text/plain" }), `файл-${marker}.txt`);
    const up = await request<Array<{ id: string }>>(`/workspaces/${source}/documents/upload`, { method: "POST", token: anna.token, form });
    expect(up.status).toBe(201);
    ids.doc = up.data[0]!.id;
    // Новая версия содержимого → строка DocumentVersion и архивные байты.
    const replace = new FormData();
    replace.append("file", new Blob([`байты v2 ${marker}`], { type: "text/plain" }), `файл-${marker}.txt`);
    await request(`/workspaces/${source}/documents/${ids.doc}/content`, { method: "POST", token: anna.token, form: replace });
  }, 120_000);

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
      });
    }
    await app?.close();
  }, 60_000);

  it("экспорт — только владелец; чужому и участнику файл не выдаётся", async () => {
    expect((await request(`/workspaces/${source}/export`, { method: "POST", token: boris.token, body: {} })).status).toBe(403);
    const bytes = await exportFile();
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.toString("utf8")).toContain(marker);
  });

  it("предпросмотр ничего не создаёт и честно показывает коллизии id и переписывание авторства", async () => {
    const file = await exportFile();
    const spacesBefore = (await request<unknown[]>("/workspaces/me", { token: boris.token })).data.length;
    // Импорт на ТОТ ЖЕ узел: все id из файла уже заняты.
    const preview = await importAs(boris, file, { dryRun: "true" });
    expect(preview.status).toBe(201);
    expect(preview.data.applied).toBe(false);
    expect(preview.data.workspaceId).toBeNull();
    expect(preview.data.idCollisions).toBeGreaterThan(5);
    expect(preview.data.incoming.tasks).toBe(2);
    expect(preview.data.files).toBeGreaterThanOrEqual(2); // файл + архивная версия
    expect(preview.data.reassignedToImporter).toBeGreaterThan(0);
    expect(preview.data.problems).toEqual([]);
    expect((await request<unknown[]>("/workspaces/me", { token: boris.token })).data.length).toBe(spacesBefore);
  });

  it("применение: новое пространство с новыми id; исходное нетронуто; чужие и старые данные не смешиваются", async () => {
    const file = await exportFile("пароль-переноса");
    expect(file.toString("utf8")).not.toContain(marker); // под паролем
    const before = await counts(source);
    const sourceTasksBefore = await prisma.asSystem((tx) => tx.task.findMany({ where: { workspaceId: source }, select: { id: true, parentId: true }, orderBy: { id: "asc" } }));

    // Без пароля и с неверным — отказ, ничего не создано.
    expect((await importAs(boris, file, { dryRun: "true" })).status).toBe(400);
    expect((await importAs(boris, file, { dryRun: "true", passphrase: "не тот" })).status).toBe(400);

    const preview = await importAs(boris, file, { dryRun: "true", passphrase: "пароль-переноса" });
    expect(preview.status).toBe(201);
    // Применение без хеша предпросмотра / с чужим хешем — отказ.
    expect((await importAs(boris, file, { dryRun: "false", passphrase: "пароль-переноса" })).status).toBe(400);
    expect((await importAs(boris, file, { dryRun: "false", passphrase: "пароль-переноса", expectedHash: "0".repeat(64) })).status).toBe(400);

    const applied = await importAs(boris, file, { dryRun: "false", passphrase: "пароль-переноса", expectedHash: preview.data.fileHash, name: `Перенесённое ${marker}` });
    expect(applied.status, applied.text).toBe(201);
    expect(applied.data.applied).toBe(true);
    const target: string = applied.data.workspaceId!;
    expect(target).not.toBe(source);

    // Борис — владелец нового пространства; Анна к нему доступа не получила.
    const spaces = await request<Array<{ id: string; name: string; role: string; isPersonal: boolean }>>("/workspaces/me", { token: boris.token });
    const created = spaces.data.find((w) => w.id === target)!;
    expect(created).toMatchObject({ name: `Перенесённое ${marker}`, role: "owner", isPersonal: false });
    expect((await request(`/workspaces/${target}/tasks`, { token: anna.token })).status).toBe(403);
    // Борис по-прежнему не видит исходное.
    expect((await request(`/workspaces/${source}/tasks`, { token: boris.token })).status).toBe(403);

    // Данные те же по количеству, id — все новые, связи целы.
    expect(await counts(target)).toEqual(before);
    const newTasks = await prisma.asSystem((tx) => tx.task.findMany({ where: { workspaceId: target } }));
    const oldIds = new Set(sourceTasksBefore.map((t) => t.id));
    expect(newTasks.every((t) => !oldIds.has(t.id))).toBe(true);
    const child = newTasks.find((t) => t.title.startsWith("Подзадача"))!;
    const parent = newTasks.find((t) => t.title.startsWith("Родитель"))!;
    expect(child.parentId).toBe(parent.id);
    const project = await prisma.asSystem((tx) => tx.project.findFirstOrThrow({ where: { workspaceId: target } }));
    expect(parent.projectId).toBe(project.id);
    const link = await prisma.asSystem((tx) => tx.entityLink.findFirstOrThrow({ where: { workspaceId: target } }));
    expect(link.targetId).toBe(parent.id);
    const newNote = await prisma.asSystem((tx) => tx.note.findFirstOrThrow({ where: { workspaceId: target } }));
    expect(link.sourceId).toBe(newNote.id);

    // Личный счёт теперь принадлежит импортировавшему и виден ему.
    const accounts = await request<Array<{ name: string; visibility: string; ownerId: string | null }>>(`/workspaces/${target}/finance/accounts`, { token: boris.token });
    const account = accounts.data.find((a) => a.name.startsWith("Личный"))!;
    expect(account).toMatchObject({ visibility: "private", ownerId: boris.userId });

    // Файл и его архивная версия приехали с теми же байтами.
    const doc = await prisma.asSystem((tx) => tx.document.findFirstOrThrow({ where: { workspaceId: target, kind: "file" } }));
    const content = await request(`/workspaces/${target}/documents/${doc.id}/content`, { token: boris.token });
    expect(content.text).toBe(`байты v2 ${marker}`);
    const versions = await request<Array<{ id: string }>>(`/workspaces/${target}/documents/${doc.id}/versions`, { token: boris.token });
    expect(versions.data.length).toBe(1);
    const oldVersion = await request(`/workspaces/${target}/documents/${doc.id}/versions/${versions.data[0]!.id}/content`, { token: boris.token });
    expect(oldVersion.text).toBe(`байты ${marker}`);

    // Исходное пространство — ровно как было.
    expect(await counts(source)).toEqual(before);
    const sourceTasksAfter = await prisma.asSystem((tx) => tx.task.findMany({ where: { workspaceId: source }, select: { id: true, parentId: true }, orderBy: { id: "asc" } }));
    expect(sourceTasksAfter).toEqual(sourceTasksBefore);
    const original = await request(`/workspaces/${source}/documents/${ids.doc}/content`, { token: anna.token });
    expect(original.text).toBe(`байты v2 ${marker}`);

    // Правка в копии не задевает оригинал.
    await request(`/workspaces/${target}/tasks/${parent.id}`, { method: "PATCH", token: boris.token, body: { title: "изменено в копии" } });
    expect((await prisma.asSystem((tx) => tx.task.findUniqueOrThrow({ where: { id: ids.parent! } }))).title).toBe(`Родитель ${marker}`);
  }, 60_000);

  it("повторный импорт того же файла — ещё одно пространство, а не затирание первого", async () => {
    const file = await exportFile();
    const preview = await importAs(boris, file, { dryRun: "true" });
    const first = await importAs(boris, file, { dryRun: "false", expectedHash: preview.data.fileHash });
    const second = await importAs(boris, file, { dryRun: "false", expectedHash: preview.data.fileHash });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.data.workspaceId).not.toBe(second.data.workspaceId);
    expect(await counts(first.data.workspaceId!)).toEqual(await counts(second.data.workspaceId!));
    expect(first.data.targetName).toContain("(перенос)");
    // Тот, кто сделал файл, тоже может импортировать его к себе: коллизия с собственными id.
    const own = await importAs(anna, file, { dryRun: "false", expectedHash: preview.data.fileHash, name: `Копия ${marker}` });
    expect(own.status).toBe(201);
    expect(await counts(source)).toEqual(await counts(own.data.workspaceId!));
  }, 60_000);

  it("обрыв посередине: ни пространства, ни файлов не остаётся, исходное нетронуто", async () => {
    const file = JSON.parse((await exportFile()).toString("utf8"));
    // Порча строки посередине вставки (после projects/notes, на tasks): БД отвергнет значение enum.
    file.snapshot.tables.tasks[0].priority = "не-приоритет";
    const broken = Buffer.from(JSON.stringify(file), "utf8");

    const spacesBefore = (await request<unknown[]>("/workspaces/me", { token: boris.token })).data.length;
    const rowsBefore = await prisma.asSystem((tx) => tx.project.count());
    const storageBefore = storageEntries();
    const preview = await importAs(boris, broken, { dryRun: "true" });
    const result = await importAs(boris, broken, { dryRun: "false", expectedHash: preview.data.fileHash });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect((await request<unknown[]>("/workspaces/me", { token: boris.token })).data.length).toBe(spacesBefore);
    expect(await prisma.asSystem((tx) => tx.project.count())).toBe(rowsBefore);
    expect(storageEntries()).toEqual(storageBefore);
    expect((await counts(source)).tasks).toBe(2);
  }, 60_000);

  it("повреждённый или чужой файл отклоняется до любых записей", async () => {
    const good = JSON.parse((await exportFile()).toString("utf8"));
    const spacesBefore = (await request<unknown[]>("/workspaces/me", { token: boris.token })).data.length;

    const tampered = structuredClone(good);
    tampered.blobs[0].data = Buffer.from("подмена").toString("base64");
    expect((await importAs(boris, Buffer.from(JSON.stringify(tampered)), { dryRun: "true" })).status).toBe(400);

    const notOurs = Buffer.from(JSON.stringify({ hello: "world" }));
    expect((await importAs(boris, notOurs, { dryRun: "true" })).status).toBe(400);
    expect((await importAs(boris, Buffer.from("не json"), { dryRun: "true" })).status).toBe(400);

    // Резервная копия узла (ORNC1) для переноса не годится — объяснение, а не 500.
    const nodeBackup = Buffer.concat([Buffer.from("ORNC1"), Buffer.alloc(80, 1)]);
    const refused = await importAs(boris, nodeBackup, { dryRun: "true" });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain("Экспорт для переноса");

    // Старый формат снапшота — отказ, не молчаливый апгрейд.
    const legacy = structuredClone(good);
    legacy.snapshot.version = 1;
    expect((await importAs(boris, Buffer.from(JSON.stringify(legacy)), { dryRun: "true" })).status).toBe(400);

    // Без файла.
    const empty = await request("/workspaces/import", { method: "POST", token: boris.token, form: new FormData() });
    expect(empty.status).toBe(400);
    expect((await request<unknown[]>("/workspaces/me", { token: boris.token })).data.length).toBe(spacesBefore);
    // Без входа — нельзя.
    expect((await request("/workspaces/import", { method: "POST", form: importForm(Buffer.from("{}"), {}) })).status).toBe(401);
  });

  it("выданные доступы (grants) из файла не переносятся", async () => {
    const good = JSON.parse((await exportFile()).toString("utf8"));
    good.snapshot.tables.crossWorkspaceGrants = [
      { id: "g1", workspaceId: source, granteeUserId: boris.userId, objectType: "note", objectId: ids.note, createdAt: new Date().toISOString(), revokedAt: null, expiresAt: null }
    ];
    const preview = await importAs(boris, Buffer.from(JSON.stringify(good)), { dryRun: "true" });
    expect(preview.status).toBe(201);
    expect(preview.data.skippedModels).toContain("CrossWorkspaceGrant");
    expect(preview.data.incoming.crossWorkspaceGrants).toBe(0);
  });

  it("обрыв между записью файлов и коммитом: каталог без пространства убирается при старте, живое — нет", async () => {
    const storage = app.get<StorageAdapter>(STORAGE_ADAPTER);
    const service = app.get(WorkspaceTransferService);
    const orphan = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`;
    // Имитация: журнал записан, файлы лежат, пространства нет — процесс умер до коммита.
    await storage.putFile(`${orphan}/осиротевший.txt`, Buffer.from("x"), { contentType: "text/plain" });
    await storage.putFile("_import-journal/pending.json", Buffer.from(JSON.stringify([orphan, source])), { contentType: "application/json" });
    expect(await storage.exists(orphan)).toBe(true);

    const removed = await service.recoverPendingImports();
    expect(removed).toBe(1);
    expect(await storage.exists(orphan)).toBe(false);
    // Пространство `source` существует — его файлы тронуть нельзя, из журнала запись просто стирается.
    expect(await storage.exists(source)).toBe(true);
    expect(await service.recoverPendingImports()).toBe(0);
  });
});
