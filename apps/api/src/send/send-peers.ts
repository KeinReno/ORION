import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../lan/node-config";

export interface SendPeerRecord {
  id: string;
  nodeId: string;
  name: string;
  fingerprint: string;
  certPem: string;
  address: string | null;
  port: number | null;
  tokenHash: string | null;
  ourToken: string | null;
  mutual: boolean;
  createdAt: string;
  revokedAt: string | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Доверие канала Send хранится отдельно от `lan-devices.json`.
 * Токен хоста открывает API пространств, токен Send — только порт передачи.
 */
export class SendPeerStore {
  private readonly file: string;
  private peers: SendPeerRecord[];

  constructor(dir: string) {
    this.file = path.join(dir, "send-peers.json");
    this.peers = this.read();
  }

  private read(): SendPeerRecord[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as { peers?: SendPeerRecord[] };
      return Array.isArray(parsed.peers) ? parsed.peers : [];
    } catch {
      return [];
    }
  }

  private flush(): void {
    writeJsonAtomic(this.file, { peers: this.peers });
  }

  list(): SendPeerRecord[] {
    return this.peers.map((peer) => ({ ...peer }));
  }

  findById(id: string): SendPeerRecord | undefined {
    return this.peers.find((peer) => peer.id === id);
  }

  findByNode(nodeId: string): SendPeerRecord | undefined {
    return this.peers.find((peer) => peer.nodeId === nodeId && !peer.revokedAt);
  }

  mintToken(): { token: string; tokenHash: string } {
    const token = `orion_send_${randomBytes(32).toString("base64url")}`;
    return { token, tokenHash: hashToken(token) };
  }

  static hash(token: string): string {
    return hashToken(token);
  }

  upsert(input: Omit<SendPeerRecord, "id" | "createdAt" | "revokedAt">): SendPeerRecord {
    const existing = this.peers.find((peer) => peer.nodeId === input.nodeId && !peer.revokedAt);
    if (existing) {
      Object.assign(existing, input, { id: existing.id, createdAt: existing.createdAt, revokedAt: null });
      this.flush();
      return { ...existing };
    }
    const created: SendPeerRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), revokedAt: null };
    this.peers.push(created);
    this.flush();
    return { ...created };
  }

  check(token: string | undefined): SendPeerRecord | null {
    if (!token) return null;
    const hash = hashToken(token);
    const peer = this.peers.find((item) => item.tokenHash === hash);
    if (!peer || peer.revokedAt || !peer.mutual) return null;
    return peer;
  }

  revoke(id: string): boolean {
    const peer = this.peers.find((item) => item.id === id && !item.revokedAt);
    if (!peer) return false;
    peer.revokedAt = new Date().toISOString();
    peer.ourToken = null;
    peer.tokenHash = null;
    this.flush();
    return true;
  }

  noteSeen(nodeId: string, address: string, port: number): void {
    const peer = this.peers.find((item) => item.nodeId === nodeId && !item.revokedAt);
    if (!peer || (peer.address === address && peer.port === port)) return;
    peer.address = address;
    peer.port = port;
    this.flush();
  }
}
