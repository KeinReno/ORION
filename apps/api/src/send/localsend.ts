import { randomBytes, randomUUID } from "node:crypto";
import dgram from "node:dgram";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SendFailure, hashFile, type SendSessions } from "./send-sessions";

const GROUP = "224.0.0.167";
const DISCOVERY_PORT = 53317;

export interface LocalSendHost {
  readonly compat: boolean;
  readonly port: number;
  readonly fingerprint: string;
  readonly name: string;
  readonly nodeId: string;
  readonly sessions: SendSessions;
  waitDecision(transferId: string, timeoutMs: number): Promise<boolean>;
}

export interface LocalSendSighting {
  nodeId: string;
  name: string;
  fingerprint: string;
  address: string;
  port: number;
  https: boolean;
}

export function startLocalSendUdp(
  onSighting: (device: LocalSendSighting) => void,
  ownFingerprint: string
): { announce: (name: string, port: number) => void; close: () => void; readonly listening: boolean } {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let listening = false;
  socket.on("error", () => {
    listening = false;
  });
  socket.on("message", (message, rinfo) => {
    let parsed: { alias?: string; fingerprint?: string; port?: number; protocol?: string; announce?: boolean };
    try {
      parsed = JSON.parse(message.toString("utf8")) as typeof parsed;
    } catch {
      return;
    }
    if (!parsed.announce || !parsed.fingerprint) return;
    if (parsed.fingerprint.replace(/:/g, "").toLowerCase() === ownFingerprint.replace(/:/g, "").toLowerCase()) return;
    const address = rinfo.address.startsWith("::ffff:") ? rinfo.address.slice(7) : rinfo.address;
    onSighting({
      nodeId: `localsend:${parsed.fingerprint}`,
      name: parsed.alias?.slice(0, 80) || "LocalSend",
      fingerprint: parsed.fingerprint,
      address,
      port: Number(parsed.port) || DISCOVERY_PORT,
      https: parsed.protocol !== "http"
    });
  });
  try {
    socket.bind(DISCOVERY_PORT, () => {
      listening = true;
      try {
        socket.addMembership(GROUP);
      } catch {
        /* мультикаст недоступен */
      }
    });
  } catch {
    listening = false;
  }
  return {
    announce(name: string, port: number) {
      const payload = Buffer.from(
        JSON.stringify({
          alias: name,
          version: "2.1",
          deviceModel: "KAIDEN Orion",
          deviceType: "desktop",
          fingerprint: ownFingerprint.replace(/:/g, "").toLowerCase(),
          port,
          protocol: "https",
          download: false,
          announce: true
        })
      );
      const sender = dgram.createSocket("udp4");
      sender.send(payload, DISCOVERY_PORT, GROUP, () => sender.close());
    },
    get listening() {
      return listening;
    },
    close() {
      try {
        socket.close();
      } catch {
        /* уже закрыт */
      }
    }
  };
}

function readJson(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new SendFailure(413, "too_large", "Слишком большой запрос"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new SendFailure(400, "bad_json", "Некорректный запрос"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** Совместимый приём LocalSend v2 на порту Orion Send. Исходники LocalSend не копируются. Ясный HTTP не обслуживается. */
export async function handleLocalSend(host: LocalSendHost, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "https://orion.local");
  if (!url.pathname.startsWith("/api/localsend/v2/")) return false;
  if (!host.compat) {
    send(res, 404, { message: "Совместимость с LocalSend выключена" });
    return true;
  }
  try {
    if (req.method === "GET" && url.pathname.endsWith("/info")) {
      send(res, 200, card(host));
      return true;
    }
    if (req.method === "POST" && url.pathname.endsWith("/register")) {
      send(res, 200, card(host));
      return true;
    }
    if (req.method === "POST" && url.pathname.endsWith("/prepare-upload")) {
      await prepare(host, req, res);
      return true;
    }
    if (req.method === "POST" && url.pathname.endsWith("/upload")) {
      await upload(host, req, res, url);
      return true;
    }
    if (req.method === "POST" && url.pathname.endsWith("/cancel")) {
      const id = url.searchParams.get("sessionId");
      if (id && host.sessions.get(id)?.status === "pending") host.sessions.reject(id);
      else if (id) await host.sessions.cancel(id).catch(() => undefined);
      res.writeHead(200);
      res.end();
      return true;
    }
    send(res, 404, { message: "Неизвестный метод LocalSend" });
  } catch (error) {
    const status = error instanceof SendFailure ? error.status : 500;
    if (!res.headersSent) send(res, status, { message: error instanceof Error ? error.message : "Ошибка" });
  }
  return true;
}

function card(host: LocalSendHost) {
  return {
    alias: host.name,
    version: "2.1",
    deviceModel: "KAIDEN Orion",
    deviceType: "desktop",
    fingerprint: host.fingerprint.replace(/:/g, "").toLowerCase(),
    port: host.port,
    protocol: "https",
    download: false
  };
}

async function prepare(host: LocalSendHost, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as {
    info?: { alias?: string };
    files?: Record<string, { id?: string; fileName?: string; size?: number; sha256?: string | null }>;
  };
  const entries = Object.values(body.files ?? {});
  if (entries.length === 0) throw new SendFailure(400, "no_files", "Нет файлов");
  const files = entries.map((file) => {
    const name = (file.fileName ?? "file").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "file";
    const declared = file.sha256 && /^[a-f0-9]{64}$/i.test(file.sha256) ? file.sha256.toLowerCase() : null;
    return {
      relativePath: name,
      size: file.size ?? 0,
      sha256: declared ?? ((file.size ?? 0) === 0 ? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" : "0".repeat(64))
    };
  });
  const transferId = randomUUID();
  const tokens = files.map(() => randomBytes(18).toString("base64url"));
  host.sessions.createIncoming({
    transferId,
    sourceDeviceId: `localsend:${body.info?.alias ?? "device"}`,
    targetDeviceId: host.nodeId,
    peerName: body.info?.alias?.slice(0, 80) || "LocalSend",
    channel: "localsend",
    files,
    fileTokens: tokens
  });
  const accepted = await host.waitDecision(transferId, 90_000);
  if (!accepted) {
    if (host.sessions.get(transferId)?.status === "pending") host.sessions.reject(transferId);
    send(res, 403, { message: "Rejected" });
    return;
  }
  const responseFiles: Record<string, string> = {};
  entries.forEach((file, index) => {
    responseFiles[file.id ?? String(index)] = tokens[index] ?? "";
  });
  send(res, 200, { sessionId: transferId, files: responseFiles });
}

async function upload(host: LocalSendHost, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const transferId = url.searchParams.get("sessionId") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const session = host.sessions.get(transferId);
  if (!session || session.channel !== "localsend") throw new SendFailure(403, "forbidden", "Сессия не найдена");
  const index = session.fileTokens.indexOf(token);
  if (index < 0) throw new SendFailure(403, "forbidden", "Неверный токен файла");
  const length = Number(req.headers["content-length"]);
  if (!Number.isInteger(length) || length < 0) throw new SendFailure(400, "bad_length", "Нужна длина файла");
  await host.sessions.writeStream(transferId, index, req, length);
  const file = session.files[index];
  if (file && file.sha256 === "0".repeat(64)) file.sha256 = await hashFile(host.sessions.partialFile(session, index), length);
  await host.sessions.finishFile(transferId, index);
  res.writeHead(200);
  res.end();
}
