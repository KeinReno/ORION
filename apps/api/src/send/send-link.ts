import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  SEND_CHUNK_BYTES,
  SEND_DEFAULT_PORT,
  SEND_PROTOCOL_VERSION,
  SEND_REQUEST_HEADER,
  SEND_SERVICE_TYPE,
  SEND_TOKEN_HEADER,
  SEND_VERSION_HEADER,
  sendInfoSchema,
  sendManifestSchema,
  type SendEnableInput,
  type SendPairing,
  type SendPeer,
  type SendPendingPair,
  type SendStatus,
  type SendStaged,
  type SendTransfer,
  safeRelativePath
} from "@orion/shared-types";
import { LAN_PAIR_SECRET_HEADER } from "@orion/shared-types";
import { codesEqual, computeSendPairingCode } from "../lan/pairing-code";
import { discoverNodes, MdnsAdvertiser } from "../lan/mdns";
import { overlayInterfaces, physicalInterfaces, scanSubnet, subnetCandidates, tailscalePeerAddresses, type CardProbe } from "../lan/lan-scan";
import { loadNodeConfig, nodeDir, writeJsonAtomic } from "../lan/node-config";
import { observeCertificate } from "../lan/pinned-request";
import { loadOrIssueHostCertificate } from "../lan/self-signed-cert";
import { openSendFirewall } from "../lan/firewall";
import { SendPeerStore, type SendPeerRecord } from "./send-peers";
import { collectPaths, collectTree, SendFailure, SendSessions, type SessionRecord } from "./send-sessions";
import { pinnedCall } from "./send-wire";
import { handleLocalSend, startLocalSendUdp, type LocalSendSighting } from "./localsend";

const PAIR_TTL_MS = 2 * 60_000;
const MAX_PENDING = 5;

interface SendConfig {
  enabled: boolean;
  port: number;
  downloadDir: string;
  maxParallel: number;
  localSendCompat: boolean;
}

interface PairRequest {
  id: string;
  deviceName: string;
  address: string;
  clientNonce: string;
  serverNonce: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
  state: "pending" | "approved" | "denied";
  token: string | null;
  tokenHash: string | null;
  remoteNodeId: string;
  claimedFingerprint: string;
  listenPort: number;
}

interface IssuedPair {
  tokenHash: string;
  address: string;
  remoteNodeId: string;
  claimedFingerprint: string;
  listenPort: number;
  deviceName: string;
  expiresAt: number;
}

interface OutPair {
  clientNonce: string;
  address: string;
  port: number;
  certPem: string;
  fingerprint: string;
  nodeId: string;
  name: string;
}

interface SeenNode {
  nodeId: string;
  name: string;
  fingerprint: string;
  address: string;
  port: number;
  protocol: number;
}

export interface SendLinkOptions {
  dir?: string;
  bindHost?: string;
  advertise?: boolean;
  chunkBytes?: number;
  freeBytes?: (directory: string) => Promise<number | null>;
}

/**
 * Слушатель Orion Send. Поднимается только когда передача включена и не публикует API пространств.
 * Два узла в режиме «Локальный» находят друг друга этим портом, не становясь хостом и клиентом.
 */
export class SendLink {
  readonly peers: SendPeerStore;
  readonly sessions: SendSessions;
  private readonly dir: string;
  private readonly bindHost: string;
  private readonly advertise: boolean;
  private readonly chunkBytes: number;
  private config: SendConfig;
  private server: https.Server | null = null;
  private advertiser: MdnsAdvertiser | null = null;
  private udp: ReturnType<typeof startLocalSendUdp> | null = null;
  private boundPort = 0;
  private listening = false;
  private error: string | null = null;
  private sockets = 0;
  private epoch = 0;
  private readonly requests = new Map<string, PairRequest>();
  private readonly issued = new Map<string, IssuedPair>();
  private readonly outgoingPairs = new Map<string, OutPair>();
  private readonly seen = new Map<string, SeenNode>();
  private readonly recentIds = new Map<string, number>();
  private readonly recentByAddress = new Map<string, number[]>();
  private readonly decisions = new Map<string, (ok: boolean) => void>();
  private readonly running = new Set<string>();
  private readonly localsend = new Map<string, LocalSendSighting>();
  /** Тестовый тормоз между блоками, чтобы проверить паузу и продолжение. */
  chunkDelay: (() => Promise<void>) | null = null;
  private certPem = "";
  private keyPem = "";
  fingerprint = "";
  nodeId = "";
  name = "";

  constructor(options: SendLinkOptions = {}) {
    this.dir = options.dir ?? nodeDir();
    this.bindHost = options.bindHost ?? "0.0.0.0";
    this.advertise = options.advertise !== false;
    this.chunkBytes = options.chunkBytes ?? SEND_CHUNK_BYTES;
    fs.mkdirSync(this.dir, { recursive: true });
    const node = loadNodeConfig(this.dir);
    this.nodeId = node.nodeId;
    this.name = node.name;
    this.peers = new SendPeerStore(this.dir);
    this.sessions = new SendSessions(this.dir, options.freeBytes);
    this.config = this.readConfig();
    this.loadCert();
  }

  private readConfig(): SendConfig {
    const file = path.join(this.dir, "send-config.json");
    let stored: Partial<SendConfig> = {};
    try {
      stored = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SendConfig>;
    } catch {
      stored = {};
    }
    const downloadDir = stored.downloadDir && path.isAbsolute(stored.downloadDir) ? stored.downloadDir : path.join(this.dir, "send-incoming");
    return {
      enabled: stored.enabled === true,
      port: Number.isInteger(stored.port) ? (stored.port as number) : SEND_DEFAULT_PORT,
      downloadDir,
      maxParallel: stored.maxParallel === 1 || stored.maxParallel === 3 || stored.maxParallel === 4 ? stored.maxParallel : 2,
      localSendCompat: stored.localSendCompat === true
    };
  }

  private saveConfig(): void {
    writeJsonAtomic(path.join(this.dir, "send-config.json"), this.config);
  }

  private loadCert(): void {
    const issued = loadOrIssueHostCertificate(path.join(this.dir, "lan-tls"), this.name, []);
    this.certPem = issued.certPem;
    this.keyPem = issued.keyPem;
    this.fingerprint = issued.fingerprint;
  }

  status(): SendStatus {
    return {
      enabled: this.config.enabled,
      listening: this.listening,
      port: this.boundPort || this.config.port,
      nodeId: this.nodeId,
      name: this.name,
      fingerprint: this.fingerprint,
      downloadDir: this.config.downloadDir,
      maxParallel: this.config.maxParallel,
      localSendCompat: this.config.localSendCompat,
      localSendListen: this.udp?.listening ?? false,
      error: this.error
    };
  }

  async enable(input: SendEnableInput): Promise<SendStatus> {
    if (input.downloadDir) {
      const resolved = path.resolve(input.downloadDir);
      await fs.promises.mkdir(resolved, { recursive: true });
      this.config.downloadDir = resolved;
    } else await fs.promises.mkdir(this.config.downloadDir, { recursive: true });
    if (input.port !== undefined && input.port !== 0) this.config.port = input.port;
    if (input.maxParallel) this.config.maxParallel = input.maxParallel;
    if (input.localSendCompat !== undefined) this.config.localSendCompat = input.localSendCompat;
    this.config.enabled = input.enabled;
    this.saveConfig();
    await this.stop();
    if (this.config.enabled) await this.listen(input.port === 0 ? 0 : this.config.port);
    return this.status();
  }

  async openFirewall(): Promise<boolean> {
    return openSendFirewall(this.boundPort || this.config.port);
  }

  private async listen(port: number): Promise<void> {
    this.loadCert();
    const server = https.createServer({ key: this.keyPem, cert: this.certPem }, (req, res) => {
      void this.onRequest(req, res);
    });
    server.on("connection", (socket) => {
      this.sockets += 1;
      if (this.sockets > 8) socket.destroy();
      socket.on("close", () => {
        this.sockets = Math.max(0, this.sockets - 1);
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, this.bindHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      this.listening = false;
      this.error = error instanceof Error ? `Порт передачи не открылся: ${error.message}` : "Порт передачи не открылся";
      return;
    }
    this.server = server;
    const address = server.address();
    this.boundPort = typeof address === "object" && address ? address.port : port;
    this.listening = true;
    this.error = null;
    if (this.advertise) {
      this.advertiser = new MdnsAdvertiser();
      this.advertiser.start({ name: this.name, nodeId: this.nodeId, fingerprint: this.fingerprint, port: this.boundPort }, SEND_SERVICE_TYPE);
    }
    if (this.config.localSendCompat) {
      this.udp = startLocalSendUdp((device) => this.localsend.set(device.nodeId, device), this.fingerprint);
      this.udp.announce(this.name, this.boundPort);
    }
  }

  async stop(): Promise<void> {
    this.epoch += 1;
    this.advertiser?.stop();
    this.advertiser = null;
    this.udp?.close();
    this.udp = null;
    const server = this.server;
    this.server = null;
    this.listening = false;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private infoBody() {
    return { protocol: SEND_PROTOCOL_VERSION, nodeId: this.nodeId, name: this.name, fingerprint: this.fingerprint, features: ["files", "resume"] };
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (await handleLocalSend(this.localHost(), req, res)) return;
      const url = new URL(req.url ?? "/", "https://orion.local");
      if (req.method === "GET" && url.pathname === "/send/v1/info") return json(res, 200, this.infoBody());
      const version = header(req, SEND_VERSION_HEADER);
      if (version && version !== String(SEND_PROTOCOL_VERSION)) return json(res, 400, { code: "protocol_mismatch", message: "Версия протокола не поддерживается" });
      if (!version && req.method !== "GET") return json(res, 400, { code: "protocol_mismatch", message: "Нет версии протокола" });
      if (req.method === "POST" && url.pathname === "/send/v1/pair/request") return this.pairRequest(req, res);
      if (req.method === "GET" && url.pathname.startsWith("/send/v1/pair/status/")) return this.pairStatus(req, res, url.pathname.split("/").pop() ?? "");
      if (req.method === "POST" && url.pathname === "/send/v1/pair/reciprocate") return this.reciprocate(req, res);
      if (req.method !== "GET" && !this.takeRequestId(header(req, SEND_REQUEST_HEADER))) {
        return json(res, 409, { code: "replay", message: "Повтор запроса отклонён" });
      }
      const peer = this.peers.check(header(req, SEND_TOKEN_HEADER));
      if (!peer) return json(res, 401, { code: "unauthorized", message: "Устройство не доверено" });
      await this.authed(peer, req, res, url);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof SendFailure) return json(res, error.status, { code: error.code, message: error.message });
      json(res, 500, { code: "internal", message: "Ошибка передачи" });
    }
  }

  private localHost() {
    return {
      compat: this.config.localSendCompat,
      port: this.boundPort,
      fingerprint: this.fingerprint,
      name: this.name,
      nodeId: this.nodeId,
      sessions: this.sessions,
      waitDecision: (id: string, timeoutMs: number) => this.waitDecision(id, timeoutMs)
    };
  }

  waitDecision(id: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.decisions.delete(id);
        resolve(false);
      }, timeoutMs);
      this.decisions.set(id, (ok) => {
        clearTimeout(timer);
        this.decisions.delete(id);
        resolve(ok);
      });
    });
  }

  private resolveDecision(id: string, ok: boolean): void {
    this.decisions.get(id)?.(ok);
  }

  private takeRequestId(id: string | undefined): boolean {
    if (!id || id.length > 80) return false;
    const now = Date.now();
    for (const [key, at] of this.recentIds) if (now - at > 10 * 60_000) this.recentIds.delete(key);
    if (this.recentIds.has(id)) return false;
    this.recentIds.set(id, now);
    return true;
  }

  private async pairRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.takeRequestId(header(req, SEND_REQUEST_HEADER))) return json(res, 409, { code: "replay", message: "Повтор запроса отклонён" });
    const body = (await readJson(req)) as { deviceName?: string; clientNonce?: string; nodeId?: string; fingerprint?: string; listenPort?: number };
    if (!body.deviceName || !body.clientNonce || body.clientNonce.length < 16 || !body.nodeId || !body.fingerprint) {
      return json(res, 400, { code: "bad_request", message: "Неполная заявка" });
    }
    if (body.nodeId === this.nodeId) return json(res, 400, { code: "self", message: "Нельзя сопрячься с собой" });
    const address = remoteAddress(req);
    const now = Date.now();
    const recent = (this.recentByAddress.get(address) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= 3) return json(res, 429, { code: "pair_rate_limited", message: "Слишком много заявок. Подождите минуту." });
    const pending = [...this.requests.values()].filter((item) => item.state === "pending" && now <= item.expiresAt);
    if (pending.length >= MAX_PENDING) return json(res, 429, { code: "pair_queue_full", message: "Уже есть несколько заявок" });
    recent.push(now);
    this.recentByAddress.set(address, recent);
    const serverNonce = randomBytes(16).toString("base64url");
    const request: PairRequest = {
      id: randomUUID(),
      deviceName: body.deviceName.slice(0, 80),
      address,
      clientNonce: body.clientNonce,
      serverNonce,
      code: computeSendPairingCode(body.clientNonce, serverNonce, this.fingerprint),
      createdAt: now,
      expiresAt: now + PAIR_TTL_MS,
      attemptsLeft: 3,
      state: "pending",
      token: null,
      tokenHash: null,
      remoteNodeId: body.nodeId,
      claimedFingerprint: body.fingerprint,
      listenPort: Number(body.listenPort) || 0
    };
    this.requests.set(request.id, request);
    json(res, 200, { requestId: request.id, serverNonce, expiresAt: new Date(request.expiresAt).toISOString() });
  }

  private pairStatus(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
    const request = this.requests.get(id);
    const secret = header(req, LAN_PAIR_SECRET_HEADER);
    if (!request || !secret || !codesEqual(request.clientNonce, secret)) return json(res, 200, { status: "expired", deviceToken: null });
    if (request.state === "approved" && request.token && request.tokenHash) {
      this.issued.set(request.tokenHash, {
        tokenHash: request.tokenHash,
        address: request.address,
        remoteNodeId: request.remoteNodeId,
        claimedFingerprint: request.claimedFingerprint,
        listenPort: request.listenPort,
        deviceName: request.deviceName,
        expiresAt: Date.now() + PAIR_TTL_MS
      });
      const token = request.token;
      request.token = null;
      return json(res, 200, { status: "approved", deviceToken: token });
    }
    if (request.state === "approved") return json(res, 200, { status: "approved", deviceToken: null });
    if (request.state === "denied") return json(res, 200, { status: "denied", deviceToken: null });
    if (Date.now() > request.expiresAt) return json(res, 200, { status: "expired", deviceToken: null });
    json(res, 200, { status: "pending", deviceToken: null });
  }

  private async reciprocate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const token = header(req, SEND_TOKEN_HEADER);
    const record = token ? this.issued.get(SendPeerStore.hash(token)) : undefined;
    if (!record || record.expiresAt < Date.now()) return json(res, 401, { code: "unauthorized", message: "Заявка не подтверждена" });
    const body = (await readJson(req)) as { nodeId?: string; fingerprint?: string; listenPort?: number; peerToken?: string };
    if (!body.peerToken || body.nodeId !== record.remoteNodeId || body.fingerprint !== record.claimedFingerprint) {
      return json(res, 400, { code: "bad_request", message: "Ответ сопряжения не совпал с заявкой" });
    }
    const port = Number(body.listenPort) || record.listenPort;
    if (port < 1024 || port > 65535) return json(res, 400, { code: "bad_port", message: "Порт передачи не подходит" });
    let observed;
    try {
      observed = await observeCertificate(record.address, port, 4000);
    } catch {
      return json(res, 409, { code: "peer_unreachable", message: "Не удалось проверить сертификат устройства" });
    }
    if (observed.fingerprint !== record.claimedFingerprint) return json(res, 401, { code: "cert_mismatch", message: "Сертификат устройства не совпал" });
    this.peers.upsert({
      nodeId: record.remoteNodeId,
      name: record.deviceName,
      fingerprint: observed.fingerprint,
      certPem: observed.certPem,
      address: record.address,
      port,
      tokenHash: record.tokenHash,
      ourToken: body.peerToken,
      mutual: true
    });
    this.issued.delete(record.tokenHash);
    json(res, 200, { ok: true });
  }

  listPending(): SendPendingPair[] {
    const now = Date.now();
    return [...this.requests.values()]
      .filter((request) => request.state === "pending" && now <= request.expiresAt)
      .map((request) => ({
        id: request.id,
        deviceName: request.deviceName,
        address: request.address,
        createdAt: new Date(request.createdAt).toISOString(),
        expiresAt: new Date(request.expiresAt).toISOString(),
        attemptsLeft: request.attemptsLeft
      }));
  }

  approve(id: string, code: string): void {
    const request = this.requests.get(id);
    if (!request || request.state !== "pending" || Date.now() > request.expiresAt) throw new SendFailure(404, "pair_not_found", "Заявка не найдена или истекла");
    if (!codesEqual(request.code, code)) {
      request.attemptsLeft -= 1;
      if (request.attemptsLeft <= 0) {
        request.state = "denied";
        throw new SendFailure(409, "pair_locked", "Код не совпал трижды — заявка закрыта");
      }
      throw new SendFailure(400, "pair_code_mismatch", `Код не совпал. Осталось попыток: ${request.attemptsLeft}`);
    }
    const minted = this.peers.mintToken();
    request.state = "approved";
    request.token = minted.token;
    request.tokenHash = minted.tokenHash;
  }

  deny(id: string): void {
    const request = this.requests.get(id);
    if (!request || request.state !== "pending") throw new SendFailure(404, "pair_not_found", "Заявка не найдена");
    request.state = "denied";
    this.resolveDecision(id, false);
  }

  async beginPair(input: { address: string; port: number; deviceName: string }): Promise<SendPairing> {
    const observed = await observeCertificate(input.address, input.port);
    const infoResponse = await pinnedCall({ address: input.address, port: input.port, certPem: observed.certPem }, "GET", "/send/v1/info");
    const info = sendInfoSchema.safeParse(infoResponse.json);
    if (infoResponse.status !== 200 || !info.success || info.data.fingerprint !== observed.fingerprint) {
      return { requestId: "", code: "", status: "error", message: "Узел не ответил визиткой Orion Send", peerId: null };
    }
    if (info.data.protocol !== SEND_PROTOCOL_VERSION) {
      return { requestId: "", code: "", status: "error", message: "Другая версия протокола", peerId: null };
    }
    if (info.data.nodeId === this.nodeId) return { requestId: "", code: "", status: "error", message: "Это же устройство", peerId: null };
    const clientNonce = randomBytes(16).toString("base64url");
    const created = await pinnedCall(
      { address: input.address, port: input.port, certPem: observed.certPem },
      "POST",
      "/send/v1/pair/request",
      {
        json: { deviceName: input.deviceName, clientNonce, nodeId: this.nodeId, fingerprint: this.fingerprint, listenPort: this.boundPort },
        headers: this.publicHeaders()
      }
    );
    const body = created.json as { requestId?: string; serverNonce?: string };
    if (created.status !== 200 || !body.requestId || !body.serverNonce) {
      return { requestId: "", code: "", status: "error", message: "Заявка отклонена", peerId: null };
    }
    const code = computeSendPairingCode(clientNonce, body.serverNonce, observed.fingerprint);
    this.outgoingPairs.set(body.requestId, {
      clientNonce,
      address: input.address,
      port: input.port,
      certPem: observed.certPem,
      fingerprint: observed.fingerprint,
      nodeId: info.data.nodeId,
      name: info.data.name
    });
    return { requestId: body.requestId, code, status: "pending", message: null, peerId: null };
  }

  async refreshPair(requestId: string): Promise<SendPairing> {
    const local = this.outgoingPairs.get(requestId);
    if (!local) return { requestId, code: "", status: "error", message: "Заявка не найдена на этом устройстве", peerId: null };
    const response = await pinnedCall({ address: local.address, port: local.port, certPem: local.certPem }, "GET", `/send/v1/pair/status/${requestId}`, {
      headers: { [LAN_PAIR_SECRET_HEADER]: local.clientNonce, [SEND_VERSION_HEADER]: String(SEND_PROTOCOL_VERSION) }
    });
    const body = response.json as { status?: string; deviceToken?: string | null };
    if (body.status === "pending") return { requestId, code: "", status: "pending", message: null, peerId: null };
    if (body.status !== "approved" || !body.deviceToken) {
      return { requestId, code: "", status: body.status === "denied" ? "denied" : "expired", message: null, peerId: null };
    }
    const minted = this.peers.mintToken();
    const peer = this.peers.upsert({
      nodeId: local.nodeId,
      name: local.name,
      fingerprint: local.fingerprint,
      certPem: local.certPem,
      address: local.address,
      port: local.port,
      tokenHash: minted.tokenHash,
      ourToken: body.deviceToken,
      mutual: true
    });
    try {
      const back = await pinnedCall({ address: local.address, port: local.port, certPem: local.certPem }, "POST", "/send/v1/pair/reciprocate", {
        json: { nodeId: this.nodeId, fingerprint: this.fingerprint, listenPort: this.boundPort, peerToken: minted.token },
        headers: { ...this.publicHeaders(), [SEND_TOKEN_HEADER]: body.deviceToken }
      });
      if (back.status !== 200) throw new SendFailure(back.status, "reciprocate_failed", "Обратное доверие не подтвердилось");
    } catch (error) {
      this.peers.revoke(peer.id);
      return { requestId, code: "", status: "error", message: error instanceof Error ? error.message : "Обратное доверие не подтвердилось", peerId: null };
    }
    this.outgoingPairs.delete(requestId);
    return { requestId, code: "", status: "approved", message: null, peerId: peer.id };
  }

  revoke(id: string): boolean {
    return this.peers.revoke(id);
  }

  peersView(): SendPeer[] {
    const rows: SendPeer[] = [];
    for (const peer of this.peers.list()) {
      const live = this.seen.get(peer.nodeId);
      if (live && !peer.revokedAt && live.fingerprint === peer.fingerprint) this.peers.noteSeen(peer.nodeId, live.address, live.port);
      rows.push(this.peerRow(peer, live));
    }
    for (const live of this.seen.values()) {
      if (rows.some((row) => row.nodeId === live.nodeId)) continue;
      rows.push({
        id: live.nodeId,
        nodeId: live.nodeId,
        name: live.name,
        fingerprint: live.fingerprint,
        address: live.address,
        port: live.port,
        online: true,
        trusted: false,
        mutual: false,
        revoked: false,
        channel: "orion",
        compatible: live.protocol === SEND_PROTOCOL_VERSION
      });
    }
    for (const device of this.localsend.values()) {
      rows.push({
        id: device.nodeId,
        nodeId: device.nodeId,
        name: device.name,
        fingerprint: device.fingerprint,
        address: device.address,
        port: device.port,
        online: true,
        trusted: false,
        mutual: false,
        revoked: false,
        channel: "localsend",
        compatible: device.https
      });
    }
    return rows;
  }

  private peerRow(peer: SendPeerRecord, live: SeenNode | undefined): SendPeer {
    const changed = Boolean(live && live.fingerprint !== peer.fingerprint);
    return {
      id: peer.id,
      nodeId: peer.nodeId,
      name: peer.name,
      fingerprint: peer.fingerprint,
      address: live?.address ?? peer.address,
      port: live?.port ?? peer.port,
      online: Boolean(live) && !changed,
      trusted: !peer.revokedAt,
      mutual: peer.mutual && !peer.revokedAt,
      revoked: Boolean(peer.revokedAt),
      channel: "orion",
      compatible: !changed && (!live || live.protocol === SEND_PROTOCOL_VERSION)
    };
  }

  async discover(scan: boolean): Promise<SendPeer[]> {
    if (this.advertise) {
      const found = await discoverNodes(2500, SEND_SERVICE_TYPE).catch(() => []);
      for (const node of found) {
        if (node.nodeId === this.nodeId) continue;
        const probed = await this.probe(node.address, node.port);
        if (probed) this.seen.set(probed.nodeId, probed);
      }
    }
    const extra = await tailscalePeers();
    const addresses = scan ? [...subnetCandidates(physicalInterfaces()), ...subnetCandidates(overlayInterfaces()), ...extra] : extra;
    if (addresses.length > 0) {
      const probe: CardProbe = async (address, port, timeoutMs) => {
        const node = await this.probe(address, port, timeoutMs);
        if (!node) return null;
        return { protocol: node.protocol, nodeId: node.nodeId, name: node.name, fingerprint: node.fingerprint, address, port };
      };
      const scanned = await scanSubnet([this.boundPort || this.config.port], { candidates: [...new Set(addresses)], probe, concurrency: scan ? 48 : 8, timeoutMs: 500 });
      for (const node of scanned) if (node.nodeId !== this.nodeId) this.seen.set(node.nodeId, { ...node, protocol: node.protocol });
    }
    if (this.udp) this.udp.announce(this.name, this.boundPort);
    return this.peersView();
  }

  async probeManual(address: string, port = this.config.port): Promise<SendPeer[]> {
    const node = await this.probe(address, port);
    if (!node) throw new SendFailure(404, "not_found", "На этом адресе нет Orion Send");
    if (node.nodeId !== this.nodeId) this.seen.set(node.nodeId, node);
    return this.peersView();
  }

  private async probe(address: string, port: number, timeoutMs = 1500): Promise<SeenNode | null> {
    try {
      const observed = await observeCertificate(address, port, timeoutMs);
      const response = await pinnedCall({ address, port, certPem: observed.certPem }, "GET", "/send/v1/info", { timeoutMs: timeoutMs * 2 });
      const info = sendInfoSchema.safeParse(response.json);
      if (response.status !== 200 || !info.success || info.data.fingerprint !== observed.fingerprint) return null;
      return { nodeId: info.data.nodeId, name: info.data.name, fingerprint: info.data.fingerprint, address, port, protocol: info.data.protocol };
    } catch {
      return null;
    }
  }

  transfers(): SendTransfer[] {
    return this.sessions.list().map((session) => this.sessions.toDto(session)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async accept(id: string, directory?: string): Promise<SendTransfer> {
    const session = await this.sessions.accept(id, directory || this.config.downloadDir);
    this.resolveDecision(id, true);
    return this.sessions.toDto(session);
  }

  reject(id: string): SendTransfer {
    const session = this.sessions.reject(id);
    this.resolveDecision(id, false);
    return this.sessions.toDto(session);
  }

  pause(id: string): SendTransfer {
    return this.sessions.toDto(this.sessions.pause(id));
  }

  resume(id: string): SendTransfer {
    const session = this.sessions.resume(id);
    if (session.direction === "outgoing") void this.pump(session.transferId, this.epoch);
    return this.sessions.toDto(session);
  }

  async cancel(id: string): Promise<SendTransfer> {
    const session = this.sessions.get(id);
    if (session?.direction === "outgoing") {
      const peer = this.peers.findByNode(session.targetDeviceId);
      if (peer?.ourToken && peer.address && peer.port) {
        await pinnedCall(targetOf(peer), "POST", `/send/v1/transfers/${id}/cancel`, { headers: this.authHeaders(peer.ourToken) }).catch(() => undefined);
      }
    }
    return this.sessions.toDto(await this.sessions.cancel(id));
  }

  async stage(relativePath: string, source: AsyncIterable<Buffer>, batchId?: string): Promise<SendStaged> {
    const safe = safeRelativePath(relativePath.replace(/\\/g, "/"));
    if (!safe) throw new SendFailure(400, "path_rejected", "Имя файла отклонено");
    const id = batchId && /^[0-9a-f-]{36}$/i.test(batchId) ? batchId : randomUUID();
    const root = path.join(this.dir, "send-outbox", id);
    const destination = path.resolve(root, ...safe.split("/"));
    const rel = path.relative(path.resolve(root), destination);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new SendFailure(400, "path_rejected", "Имя файла отклонено");
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await pipeline(asNodeStream(source), fs.createWriteStream(destination));
    const files = await collectTree(root);
    return { batchId: id, files: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0) };
  }

  async offerBatch(peerId: string, batchId: string): Promise<SendTransfer> {
    const files = await collectTree(path.join(this.dir, "send-outbox", batchId));
    return this.offer(peerId, files);
  }

  async offerPaths(peerId: string, paths: string[]): Promise<SendTransfer> {
    return this.offer(peerId, await collectPaths(paths));
  }

  async offerCopy(peerId: string, title: string, envelope: unknown): Promise<SendTransfer> {
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 80) || "копия";
    const staged = await this.stage(`Копия ${safeTitle}.orion-copy.json`, bufferStream(Buffer.from(JSON.stringify(envelope))), undefined);
    return this.offerBatch(peerId, staged.batchId);
  }

  private offer(peerId: string, files: Array<{ absolute: string; relativePath: string; size: number; sha256: string }>): SendTransfer {
    const peer = this.requirePeer(peerId);
    const session = this.sessions.createOutgoing({
      sourceDeviceId: this.nodeId,
      targetDeviceId: peer.nodeId,
      peerName: peer.name,
      files: files.map((file) => ({ relativePath: file.relativePath, size: file.size, sha256: file.sha256, receivedBytes: 0, state: "pending" })),
      sources: files.map((file) => file.absolute)
    });
    void this.pump(session.transferId, this.epoch);
    return this.sessions.toDto(session);
  }

  private requirePeer(peerId: string): SendPeerRecord {
    const peer = this.peers.findById(peerId);
    if (!peer || peer.revokedAt || !peer.mutual || !peer.ourToken || !peer.address || !peer.port) {
      throw new SendFailure(409, "not_trusted", "Устройство не доверено для передачи");
    }
    const live = this.seen.get(peer.nodeId);
    if (live && live.fingerprint !== peer.fingerprint) throw new SendFailure(401, "cert_mismatch", "Сертификат устройства изменился");
    return peer;
  }

  private async pump(transferId: string, epoch: number): Promise<void> {
    if (this.running.has(transferId)) return;
    this.running.add(transferId);
    try {
      const session = this.sessions.get(transferId);
      if (!session || session.direction !== "outgoing") return;
      const peer = this.peers.findByNode(session.targetDeviceId);
      if (!peer?.ourToken || !peer.address || !peer.port || peer.revokedAt) {
        this.sessions.mark(transferId, "failed", "Устройство больше не доверено");
        return;
      }
      const target = targetOf(peer);
      const manifest = {
        protocol: SEND_PROTOCOL_VERSION,
        transferId,
        files: session.files.map((file) => ({ relativePath: file.relativePath, size: file.size, sha256: file.sha256 }))
      };
      const created = await pinnedCall(target, "POST", "/send/v1/transfers", { json: manifest, headers: this.authHeaders(peer.ourToken) });
      if (created.status === 401 || created.status === 403) {
        this.sessions.mark(transferId, "failed", "Получатель отклонил доверие");
        return;
      }
      if (created.status !== 200 && created.status !== 202) throw new Error("manifest");
      const decision = await this.waitRemote(target, peer.ourToken, transferId, epoch);
      if (decision === "rejected") {
        this.sessions.mark(transferId, "rejected", "Получатель отклонил передачу");
        return;
      }
      if (decision !== "go") return;
      await this.sendAll(session, target, peer.ourToken, epoch);
      if (this.epoch !== epoch) return;
      const current = this.sessions.get(transferId);
      if (current && !current.paused && current.status !== "cancelled" && current.status !== "failed") this.sessions.mark(transferId, "completed");
    } catch (error) {
      const current = this.sessions.get(transferId);
      if (!current || ["completed", "rejected", "cancelled", "failed"].includes(current.status)) return;
      const text = (error instanceof Error ? error.message : "Ошибка передачи").slice(0, 240);
      const replaced = /certificate|сертификат/i.test(text);
      const network = !replaced && /timeout|ECONN|socket|abort/i.test(text);
      this.sessions.mark(transferId, network ? "paused" : "failed", network ? "Соединение прервалось. Можно продолжить." : text);
    } finally {
      this.running.delete(transferId);
    }
  }

  private async waitRemote(target: { address: string; port: number; certPem: string }, token: string, transferId: string, epoch: number): Promise<"go" | "rejected" | "stop"> {
    const started = Date.now();
    while (Date.now() - started < 10 * 60_000) {
      if (this.epoch !== epoch) return "stop";
      const session = this.sessions.get(transferId);
      if (!session || session.status === "cancelled") return "stop";
      if (session.paused) {
        await sleep(300);
        continue;
      }
      const response = await pinnedCall(target, "GET", `/send/v1/transfers/${transferId}`, { headers: this.authHeaders(token) });
      const body = response.json as { status?: string };
      if (body.status === "rejected") return "rejected";
      if (body.status === "accepted" || body.status === "transferring" || body.status === "paused") return "go";
      if (body.status === "cancelled" || body.status === "failed") return "stop";
      await sleep(400);
    }
    throw new Error("timeout");
  }

  private async sendAll(session: SessionRecord, target: { address: string; port: number; certPem: string }, token: string, epoch: number): Promise<void> {
    let cursor = 0;
    const worker = async () => {
      while (cursor < session.files.length) {
        const index = cursor;
        cursor += 1;
        await this.sendOne(session, index, target, token, epoch);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.config.maxParallel, session.files.length) }, () => worker()));
  }

  private async sendOne(
    session: SessionRecord,
    index: number,
    target: { address: string; port: number; certPem: string },
    token: string,
    epoch: number
  ): Promise<void> {
    const file = session.files[index];
    const source = session.sources[index];
    if (!file || !source) throw new Error("missing source");
    let offset = file.receivedBytes;
    const remote = await pinnedCall(target, "GET", `/send/v1/transfers/${session.transferId}/files/${index}`, { headers: this.authHeaders(token) });
    const known = remote.json as { receivedBytes?: number };
    if (typeof known.receivedBytes === "number") offset = known.receivedBytes;
    while (offset < file.size) {
      while (this.sessions.get(session.transferId)?.paused) {
        if (this.epoch !== epoch || this.sessions.get(session.transferId)?.status === "cancelled") return;
        await sleep(200);
      }
      if (this.epoch !== epoch) return;
      const end = Math.min(file.size, offset + this.chunkBytes);
      const response = await pinnedCall(target, "PUT", `/send/v1/transfers/${session.transferId}/files/${index}`, {
        stream: fs.createReadStream(source, { start: offset, end: end - 1 }),
        contentLength: end - offset,
        headers: { ...this.authHeaders(token), "x-orion-offset": String(offset) },
        timeoutMs: 60_000
      });
      const body = response.json as { receivedBytes?: number; code?: string };
      if (response.status === 409 && body.code === "paused") {
        await sleep(300);
        continue;
      }
      if (response.status === 409 && typeof body.receivedBytes === "number") {
        offset = body.receivedBytes;
        continue;
      }
      if (response.status !== 200 || typeof body.receivedBytes !== "number") throw new Error(`chunk ${response.status}`);
      offset = body.receivedBytes;
      this.sessions.noteOutgoing(session.transferId, index, offset);
      if (this.chunkDelay) await this.chunkDelay();
    }
    const finished = await pinnedCall(target, "POST", `/send/v1/transfers/${session.transferId}/files/${index}/finish`, { headers: this.authHeaders(token) });
    if (finished.status === 422) throw new SendFailure(422, "checksum_mismatch", "Контрольная сумма не совпала");
    if (finished.status !== 200) throw new Error("finish");
    this.sessions.noteOutgoing(session.transferId, index, file.size);
  }

  private async authed(peer: SendPeerRecord, req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "POST" && url.pathname === "/send/v1/transfers") {
      const body = sendManifestSchema.safeParse(await readJson(req));
      if (!body.success) return json(res, 400, { code: "bad_manifest", message: "Манифест отклонён" });
      const session = this.sessions.createIncoming({
        transferId: body.data.transferId,
        sourceDeviceId: peer.nodeId,
        targetDeviceId: this.nodeId,
        peerName: peer.name,
        channel: "orion",
        files: body.data.files
      });
      return json(res, session.status === "pending" ? 202 : 200, this.sessions.toDto(session));
    }
    if (parts[0] === "send" && parts[1] === "v1" && parts[2] === "transfers" && parts[3]) {
      const id = parts[3];
      const session = this.sessions.get(id);
      if (!session || session.sourceDeviceId !== peer.nodeId) return json(res, 404, { code: "not_found", message: "Передача не найдена" });
      if (req.method === "GET" && parts.length === 4) {
        return json(res, 200, { status: session.status, paused: session.paused, files: session.files.map((file) => ({ receivedBytes: file.receivedBytes, size: file.size })) });
      }
      if (req.method === "GET" && parts[4] === "files" && parts[5]) {
        const file = session.files[Number(parts[5])];
        if (!file) return json(res, 404, { code: "no_file", message: "Файл не найден" });
        return json(res, 200, { receivedBytes: file.receivedBytes, size: file.size });
      }
      if (req.method === "PUT" && parts[4] === "files" && parts[5] && parts.length === 6) {
        const index = Number(parts[5]);
        const offset = Number(header(req, "x-orion-offset"));
        const length = Number(req.headers["content-length"]);
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0 || length > this.chunkBytes) {
          return json(res, 400, { code: "bad_chunk", message: "Некорректный блок" });
        }
        const bytes = await readRaw(req, length);
        try {
          const receivedBytes = await this.sessions.commitChunk(id, index, offset, bytes);
          return json(res, 200, { receivedBytes });
        } catch (error) {
          if (error instanceof SendFailure && error.code === "bad_offset") {
            const file = this.sessions.get(id)?.files[index];
            return json(res, 409, { code: error.code, message: error.message, receivedBytes: file?.receivedBytes ?? 0 });
          }
          throw error;
        }
      }
      if (req.method === "POST" && parts[4] === "files" && parts[6] === "finish") {
        const updated = await this.sessions.finishFile(id, Number(parts[5]));
        return json(res, 200, this.sessions.toDto(updated));
      }
      if (req.method === "POST" && parts[4] === "cancel") return json(res, 200, this.sessions.toDto(await this.sessions.cancel(id)));
    }
    json(res, 404, { code: "not_found", message: "Маршрут не найден" });
  }

  private publicHeaders(): Record<string, string> {
    return { [SEND_VERSION_HEADER]: String(SEND_PROTOCOL_VERSION), [SEND_REQUEST_HEADER]: randomUUID() };
  }

  private authHeaders(token: string): Record<string, string> {
    return { ...this.publicHeaders(), [SEND_TOKEN_HEADER]: token };
  }
}

function targetOf(peer: SendPeerRecord): { address: string; port: number; certPem: string } {
  return { address: peer.address ?? "127.0.0.1", port: peer.port ?? SEND_DEFAULT_PORT, certPem: peer.certPem };
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function remoteAddress(req: http.IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? "unknown";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  res.end(payload);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return readRaw(req, 1_000_000).then((bytes) => {
    try {
      return JSON.parse(bytes.toString("utf8") || "null") as unknown;
    } catch {
      throw new SendFailure(400, "bad_json", "Некорректный запрос");
    }
  });
}

function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
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
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailscalePeers(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("tailscale", ["status", "--json"], { timeout: 1500, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error || !stdout) return resolve([]);
      try {
        resolve(tailscalePeerAddresses(JSON.parse(stdout)));
      } catch {
        resolve([]);
      }
    });
  });
}

function bufferStream(body: Buffer): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      yield body;
    }
  };
}

function asNodeStream(source: AsyncIterable<Buffer>): Readable {
  return Readable.from(source);
}
