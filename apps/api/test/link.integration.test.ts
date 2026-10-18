import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { MemoryPacketTransport } from "@orion/core/src/link/packet-transport";
import { RelayNodeTransport } from "@orion/core/src/link/relay";
import { ReplicaEngine } from "@orion/core/src/sync/replica-engine";
import { MemoryReplicaStorage } from "@orion/core/src/sync/replica-types";
import { LinkIngressService } from "../src/sync/link-ingress.service";
import { LinkService } from "../src/sync/link.service";

interface Session {
  userId: string;
  workspaceId: string;
}

/** ADR-0020: спаривание Link-устройств, ключ K_ws и приём пакетов от имени пользователя под RLS. */
describe("Orion Link: устройства и ключи", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let link: LinkService;
  let ingress: LinkIngressService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `link-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    link = app.get(LinkService);
    ingress = app.get(LinkIngressService);
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

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const reg = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "integration-password-123", name })
    });
    expect(reg.status).toBe(201);
    const token = ((await reg.json()) as { accessToken: string }).accessToken;
    const ws = await fetch(`${baseUrl}/workspaces/me`, { headers: { Authorization: `Bearer ${token}` } });
    const workspaceId = ((await ws.json()) as Array<{ id: string }>)[0]!.id;
    const user = await prisma.asSystem((tx) => tx.user.findUniqueOrThrow({ where: { email } }));
    return { userId: user.id, workspaceId };
  }

  it("владелец создаёт ключ; участник получает тот же ключ; в БД ключ завёрнут", async () => {
    const owner = await register("owner");
    const member = await register("member");
    await prisma.asSystem((tx) =>
      tx.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: member.userId, role: "member" } })
    );

    const a = await link.pair(owner.userId, owner.workspaceId, "ПК");
    const b = await link.pair(member.userId, owner.workspaceId, "Телефон");
    expect(a.epoch).toBe(1);
    expect(b.keyId).toBe(a.keyId);
    expect(b.key).toBe(a.key);
    expect(Buffer.from(a.key, "base64")).toHaveLength(32);
    expect(a.linkDeviceId).not.toBe(b.linkDeviceId);

    const stored = await prisma.asSystem((tx) => tx.linkKey.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } }));
    expect(stored.keyEnc).not.toContain(a.key);

    const keys = await link.keysFor(owner.workspaceId);
    expect(keys?.epoch).toBe(1);
    expect(Buffer.from(keys!.keys[0]!.raw).toString("base64")).toBe(a.key);
  });

  it("первый ключ не может создать участник; чужое пространство закрыто", async () => {
    const owner = await register("o2");
    const member = await register("m2");
    const stranger = await register("s2");
    await prisma.asSystem((tx) =>
      tx.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: member.userId, role: "member" } })
    );
    await expect(link.pair(member.userId, owner.workspaceId, "Телефон")).rejects.toMatchObject({ status: 403 });
    await expect(link.pair(stranger.userId, owner.workspaceId, "Чужой")).rejects.toMatchObject({ status: 403 });
    expect(await link.keysFor(owner.workspaceId)).toBeNull();
  });

  it("список видит только свои устройства; отзыв и выход из пространства закрывают приём", async () => {
    const owner = await register("o3");
    const member = await register("m3");
    await prisma.asSystem((tx) =>
      tx.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: member.userId, role: "member" } })
    );
    const a = await link.pair(owner.userId, owner.workspaceId, "ПК");
    const b = await link.pair(member.userId, owner.workspaceId, "Телефон");

    expect((await link.list(owner.userId, owner.workspaceId)).map((d) => d.id)).toEqual([a.linkDeviceId]);
    expect((await link.list(member.userId, owner.workspaceId)).map((d) => d.id)).toEqual([b.linkDeviceId]);
    await expect(link.revoke(owner.userId, owner.workspaceId, b.linkDeviceId)).rejects.toMatchObject({ status: 404 });

    expect(await link.userForDevice(owner.workspaceId, a.linkDeviceId)).toBe(owner.userId);
    expect((await link.list(owner.userId, owner.workspaceId))[0]!.lastSeenAt).not.toBeNull();
    expect(await link.userForDevice(owner.workspaceId, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await link.userForDevice("other-workspace", a.linkDeviceId)).toBeNull();

    const revoked = await link.revoke(owner.userId, owner.workspaceId, a.linkDeviceId);
    expect(revoked.revokedAt).not.toBeNull();
    expect(await link.userForDevice(owner.workspaceId, a.linkDeviceId)).toBeNull();

    await prisma.asSystem((tx) =>
      tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: owner.workspaceId, userId: member.userId } } })
    );
    expect(await link.userForDevice(owner.workspaceId, b.linkDeviceId)).toBeNull();
  });

  it("сквозной: клиент пишет список офлайн-движком через зашифрованный ящик, узел применяет его в PostgreSQL", async () => {
    const owner = await register("e2e");
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: owner.workspaceId }, data: { syncMode: "hybrid" } }));
    const pairing = await link.pair(owner.userId, owner.workspaceId, "Телефон");
    const box = new MemoryPacketTransport();
    const key = { keyId: pairing.keyId, raw: new Uint8Array(Buffer.from(pairing.key, "base64")) };
    const engine = new ReplicaEngine({
      transport: new RelayNodeTransport({
        box,
        workspaceId: owner.workspaceId,
        epoch: pairing.epoch,
        keys: [key],
        deviceId: pairing.linkDeviceId,
        maxPolls: 3,
        wait: async () => void (await ingress.pollWorkspace(owner.workspaceId, box))
      }),
      storage: new MemoryReplicaStorage(),
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      uuid: () => crypto.randomUUID(),
      now: () => Date.now()
    });
    await engine.sync();
    await engine.enqueue({ entity: "list", kind: "create", fields: { name: "Через облако" } });
    await engine.sync();
    expect(engine.status().pending).toBe(0);

    const stored = await prisma.withUser(owner.userId, (tx) => tx.list.findMany({ where: { workspaceId: owner.workspaceId } }));
    expect(stored.map((l) => l.name)).toEqual(["Через облако"]);
    for (const bytes of box.files.values()) expect(Buffer.from(bytes).toString("utf8")).not.toContain("Через облако");

    // Отзыв: следующий запрос получает 403, копия помечается отозванной, новые данные на узле не появляются.
    await link.revoke(owner.userId, owner.workspaceId, pairing.linkDeviceId);
    await engine.enqueue({ entity: "list", kind: "create", fields: { name: "После отзыва" } });
    await engine.sync();
    expect(engine.status().phase).toBe("revoked");
    const after = await prisma.withUser(owner.userId, (tx) => tx.list.count({ where: { workspaceId: owner.workspaceId } }));
    expect(after).toBe(1);
  });
});
