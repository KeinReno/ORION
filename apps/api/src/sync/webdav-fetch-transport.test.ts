import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryHost } from "@orion/core/src/sync/memory-host";
import { ReplicaEngine } from "@orion/core/src/sync/replica-engine";
import { MemoryReplicaStorage } from "@orion/core/src/sync/replica-types";
import { generateLinkKey } from "@orion/core/src/link/packet-codec";
import { RelayIngress, RelayNodeTransport } from "@orion/core/src/link/relay";
import { WebdavFetchTransport } from "@orion/core/src/link/webdav-fetch-transport";

/** Минимальный настоящий WebDAV по HTTP: коллекции, PUT с If-None-Match, PROPFIND Depth:1, Basic-авторизация. */
function startDav() {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>(["/"]);
  const stats = { propfind: 0, mkcol: 0, unauthorized: 0 };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
      if (req.headers.authorization !== expected) {
        stats.unauthorized += 1;
        res.writeHead(401).end();
        return;
      }
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/\/+$/, "") || "/";
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      switch (req.method) {
        case "MKCOL":
          stats.mkcol += 1;
          if (dirs.has(path)) return void res.writeHead(405).end();
          if (!dirs.has(parent)) return void res.writeHead(409).end();
          dirs.add(path);
          return void res.writeHead(201).end();
        case "PUT":
          if (!dirs.has(parent)) return void res.writeHead(409).end();
          if (req.headers["if-none-match"] === "*" && files.has(path)) return void res.writeHead(412).end();
          files.set(path, Buffer.concat(chunks));
          return void res.writeHead(201).end();
        case "GET":
          return files.has(path) ? void res.writeHead(200).end(files.get(path)) : void res.writeHead(404).end();
        case "DELETE":
          files.delete(path);
          return void res.writeHead(204).end();
        case "PROPFIND": {
          stats.propfind += 1;
          if (!dirs.has(path)) return void res.writeHead(404).end();
          const prefix = path === "/" ? "/" : `${path}/`;
          const kids = new Set<string>();
          for (const f of files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) kids.add(f);
          for (const d of dirs) if (d !== path && d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) kids.add(`${d}/`);
          const entry = (href: string) => `<D:response><D:href>${encodeURI(href)}</D:href></D:response>`;
          const body = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${entry(`${path}/`)}${[...kids].map(entry).join("")}</D:multistatus>`;
          return void res.writeHead(207, { "Content-Type": "application/xml" }).end(body);
        }
        default:
          return void res.writeHead(405).end();
      }
    });
  });
  return new Promise<{ server: Server; url: string; files: Map<string, Buffer>; stats: typeof stats }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${port}`, files, stats });
    });
  });
}

describe("WebdavFetchTransport против настоящего HTTP-сервера", () => {
  let dav: Awaited<ReturnType<typeof startDav>>;
  beforeAll(async () => {
    dav = await startDav();
    dav.stats.mkcol = 0;
  });
  afterAll(() => void dav.server.close());

  const make = (password = "pass") => new WebdavFetchTransport({ url: dav.url, username: "user", password, baseDir: "/ORION" });

  it("создаёт каталоги по требованию, не перезаписывает, листает уровень, удаляет", async () => {
    const t = make();
    expect(await t.list("orion-link/v1/ws/1/up")).toEqual([]);
    expect(await t.put("orion-link/v1/ws/1/up/pc/000000000001.pkt", new Uint8Array([1, 2, 3]))).toBe(true);
    expect(await t.put("orion-link/v1/ws/1/up/pc/000000000001.pkt", new Uint8Array([9]))).toBe(false);
    expect([...(await t.get("orion-link/v1/ws/1/up/pc/000000000001.pkt"))!]).toEqual([1, 2, 3]);
    expect(await t.get("orion-link/v1/ws/1/up/pc/nope.pkt")).toBeNull();
    expect(await t.list("orion-link/v1/ws/1/up")).toEqual(["pc"]);
    expect(await t.list("orion-link/v1/ws/1/up/pc")).toEqual(["000000000001.pkt"]);
    await t.remove("orion-link/v1/ws/1/up/pc/000000000001.pkt");
    await t.remove("orion-link/v1/ws/1/up/pc/000000000001.pkt");
    expect(await t.list("orion-link/v1/ws/1/up/pc")).toEqual([]);
    expect((await t.probe()).ok).toBe(true);
  });

  it("неверный пароль: probe не ок, операции бросают", async () => {
    const t = make("wrong");
    expect((await t.probe()).ok).toBe(false);
    await expect(t.put("a/b.pkt", new Uint8Array([1]))).rejects.toThrow();
    expect(dav.stats.unauthorized).toBeGreaterThan(0);
  });

  it("два устройства сходятся через настоящий WebDAV по HTTP; сервер хранит только шифртекст", async () => {
    const host = new MemoryHost();
    const keys = [generateLinkKey("k1")];
    const ingress = new RelayIngress({ box: make(), workspaceId: "ws", epoch: 1, keys, host, chunkBytes: 4096 });
    let n = 0;
    const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const engine = (id: string) =>
      new ReplicaEngine({
        transport: new RelayNodeTransport({
          box: make(),
          workspaceId: "ws",
          epoch: 1,
          keys,
          deviceId: id,
          maxPolls: 3,
          wait: async () => void (await ingress.pollOnce())
        }),
        storage: new MemoryReplicaStorage(),
        userId: "u1",
        workspaceId: "ws",
        uuid,
        now: () => host.nowMs
      });
    const a = engine("pc");
    const b = engine("phone");
    await a.sync();
    await b.sync();
    const list = await a.enqueue({ entity: "list", kind: "create", fields: { name: "Тайный WebDAV" } });
    await a.enqueue({ entity: "listItem", kind: "create", parentId: list.entityId, fields: { label: "Сыр" } });
    await a.enqueue({ entity: "note", kind: "create", fields: { title: "Заметка", body: "Секрет-" + "x".repeat(6000) } });
    await a.sync();
    await b.sync();
    expect(b.lists().lists[0]?.items[0]?.label).toBe("Сыр");
    expect(b.notes()[0]?.body.startsWith("Секрет-")).toBe(true);
    expect(dav.files.size).toBeGreaterThan(0);
    for (const bytes of dav.files.values()) expect(bytes.toString("utf8")).not.toMatch(/Тайный|Сыр|Секрет/);
  });
});
