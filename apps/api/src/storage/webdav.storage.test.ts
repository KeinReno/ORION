import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebdavStorage } from "./webdav.storage";

/**
 * Fault injection для WebDAV-драйвера (G26): настоящий драйвер (`webdav` v4) против крошечного WebDAV-сервера в памяти,
 * который по команде отвечает 5xx, рвёт соединение посреди тела или «применяет операцию и роняет ответ».
 * Проверяем, что ошибки сервера не превращаются в успех, а «уже нет» (404) — превращается там, где так задумано.
 */
type Fault = (req: IncomingMessage, res: ServerResponse) => boolean;

let server: Server;
let files: Map<string, Buffer>;
let dirs: Set<string>;
let fault: Fault | null;

const pathOf = (url: string): string => decodeURIComponent(new URL(url, "http://x").pathname).replace(/\/+$/, "") || "/";

function handler(req: IncomingMessage, res: ServerResponse): void {
  if (fault?.(req, res)) return;
  const path = pathOf(req.url ?? "/");
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const method = req.method ?? "GET";
    if (method === "PUT") {
      files.set(path, Buffer.concat(chunks));
      res.writeHead(201).end();
    } else if (method === "MKCOL") {
      dirs.add(path);
      res.writeHead(201).end();
    } else if (method === "GET") {
      const body = files.get(path);
      if (!body) return void res.writeHead(404).end();
      const range = /bytes=(\d+)-(\d+)?/.exec(String(req.headers.range ?? ""));
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : body.length - 1;
        res
          .writeHead(206, { "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": end - start + 1 })
          .end(body.subarray(start, end + 1));
      } else res.writeHead(200, { "Content-Length": body.length }).end(body);
    } else if (method === "DELETE") {
      if (files.delete(path) || dirs.delete(path)) res.writeHead(204).end();
      else res.writeHead(404).end();
    } else if (method === "MOVE" || method === "COPY") {
      const to = pathOf(String(req.headers.destination));
      const body = files.get(path);
      if (!body) return void res.writeHead(404).end();
      files.set(to, body);
      if (method === "MOVE") files.delete(path);
      res.writeHead(201).end();
    } else if (method === "PROPFIND") {
      if (!files.has(path) && !dirs.has(path) && path !== "/") return void res.writeHead(404).end();
      const isFile = files.has(path);
      res.writeHead(207, { "Content-Type": "application/xml" }).end(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href><d:propstat><d:prop>` +
          `<d:resourcetype>${isFile ? "" : "<d:collection/>"}</d:resourcetype><d:getcontentlength>${files.get(path)?.length ?? 0}</d:getcontentlength>` +
          `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
      );
    } else res.writeHead(405).end();
  });
}

let storage: WebdavStorage;

beforeEach(async () => {
  files = new Map();
  dirs = new Set(["/orion-documents"]);
  fault = null;
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.WEBDAV_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  storage = new WebdavStorage();
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.WEBDAV_URL;
});

async function read(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

const on =
  (method: string, respond: (res: ServerResponse) => void): Fault =>
  (req, res) => {
    if (req.method !== method) return false;
    respond(res);
    return true;
  };

describe("WebdavStorage против настоящего WebDAV-сервера", () => {
  it("записывает, читает (в том числе по диапазону), копирует, переносит и удаляет", async () => {
    await storage.putFile("w1/a.txt", Buffer.from("0123456789"));
    expect(await storage.exists("w1/a.txt")).toBe(true);
    expect((await read(await storage.getStream("w1/a.txt"))).toString()).toBe("0123456789");
    expect((await read(await storage.getStream("w1/a.txt", { start: 2, end: 4 }))).toString()).toBe("234");
    await storage.copy("w1/a.txt", "w1/b.txt");
    await storage.move("w1/a.txt", "w1/c.txt");
    expect(await storage.exists("w1/a.txt")).toBe(false);
    expect((await read(await storage.getStream("w1/c.txt"))).toString()).toBe("0123456789");
    await storage.remove("w1/c.txt");
    expect(await storage.exists("w1/c.txt")).toBe(false);
  });

  it("сервер ответил 500 на запись — это ошибка, а не молчаливый успех, и файла нет", async () => {
    fault = on("PUT", (res) => void res.writeHead(500).end());
    await expect(storage.putFile("w1/x.txt", Buffer.from("x"))).rejects.toThrow();
    expect(files.has("/orion-documents/w1/x.txt")).toBe(false);
  });

  it("запись применена, а ответ оборван — клиент видит ошибку (вызывающий код обязан откатить свою часть)", async () => {
    fault = (req, res) => {
      if (req.method !== "PUT") return false;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        files.set("/orion-documents/w1/landed.txt", Buffer.concat(chunks));
        res.destroy();
      });
      return true;
    };
    await expect(storage.putFile("w1/landed.txt", Buffer.from("data"))).rejects.toThrow();
    // Именно этот разрыв «серверная операция применилась, клиент получил ошибку» разбирают тесты документов с откатом.
    expect(files.get("/orion-documents/w1/landed.txt")?.toString()).toBe("data");
  });

  it("удаление: «уже нет» (404) — успех, 500 — ошибка", async () => {
    await expect(storage.remove("w1/missing.txt")).resolves.toBeUndefined();
    fault = on("DELETE", (res) => void res.writeHead(500).end());
    await expect(storage.remove("w1/missing.txt")).rejects.toThrow();
  });

  it("exists: 404 — false, 500 — ошибка, а не «файла нет»", async () => {
    expect(await storage.exists("w1/none.txt")).toBe(false);
    fault = on("PROPFIND", (res) => void res.writeHead(500).end());
    await expect(storage.exists("w1/none.txt")).rejects.toThrow();
  });

  it("перенос и копирование: 5xx не оставляет вид успешной операции, источник цел", async () => {
    await storage.putFile("w1/a.txt", Buffer.from("1"));
    fault = on("MOVE", (res) => void res.writeHead(500).end());
    await expect(storage.move("w1/a.txt", "w1/b.txt")).rejects.toThrow();
    fault = on("COPY", (res) => void res.writeHead(507).end());
    await expect(storage.copy("w1/a.txt", "w1/c.txt")).rejects.toThrow();
    fault = null;
    expect(await storage.exists("w1/a.txt")).toBe(true);
  });

  it("чтение: 404 даёт ошибку потока", async () => {
    await expect(read(await storage.getStream("w1/none.txt"))).rejects.toThrow();
  });

  it("чтение: обрыв посреди тела даёт ошибку потока, а не вечное зависание", async () => {
    process.env.WEBDAV_IDLE_TIMEOUT_MS = "300";
    await storage.putFile("w1/big.bin", Buffer.alloc(1000, 7));
    fault = (req, res) => {
      if (req.method !== "GET") return false;
      res.writeHead(200, { "Content-Length": 1000 });
      res.write(Buffer.alloc(100, 7));
      setTimeout(() => res.destroy(), 10);
      return true;
    };
    try {
      await expect(read(await storage.getStream("w1/big.bin"))).rejects.toThrow();
    } finally {
      delete process.env.WEBDAV_IDLE_TIMEOUT_MS;
    }
  });
});
