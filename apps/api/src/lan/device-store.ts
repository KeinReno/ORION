import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LanDevice } from "@orion/shared-types";
import { writeJsonAtomic } from "./node-config";

interface StoredDevice {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastAddress: string | null;
  revokedAt: string | null;
}

export type DeviceCheck = { ok: true; device: StoredDevice } | { ok: false; reason: "unknown" | "revoked" };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const SEEN_FLUSH_MS = 60_000;

/**
 * Доверенные устройства хоста. Токен — 32 случайных байта, на диске только sha256. Проверка идёт по
 * словарю в памяти этого же процесса, поэтому отзыв действует со следующего запроса (требование ТЗ ≤ 5 с),
 * а не по истечении какого-то кэша. Отозванные записи остаются в файле, чтобы отличать «отозван» от «неизвестен».
 */
export class DeviceStore {
  private readonly file: string;
  private devices: StoredDevice[];
  private byHash = new Map<string, StoredDevice>();
  private lastFlush = 0;

  constructor(dir: string, private readonly now: () => number = Date.now) {
    this.file = path.join(dir, "lan-devices.json");
    this.devices = this.read();
    this.reindex();
  }

  private read(): StoredDevice[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as { devices?: StoredDevice[] };
      return Array.isArray(parsed.devices) ? parsed.devices : [];
    } catch {
      return [];
    }
  }

  private reindex(): void {
    this.byHash = new Map(this.devices.map((device) => [device.tokenHash, device]));
  }

  private flush(): void {
    writeJsonAtomic(this.file, { devices: this.devices });
    this.lastFlush = this.now();
  }

  create(name: string, address: string | null): { device: LanDevice; token: string } {
    const token = `orion_dev_${randomBytes(32).toString("base64url")}`;
    const stored: StoredDevice = {
      id: randomUUID(),
      name,
      tokenHash: hashToken(token),
      createdAt: new Date(this.now()).toISOString(),
      lastSeenAt: null,
      lastAddress: address,
      revokedAt: null
    };
    this.devices.push(stored);
    this.byHash.set(stored.tokenHash, stored);
    this.flush();
    return { device: toDto(stored), token };
  }

  check(token: string | undefined, address: string | null): DeviceCheck {
    if (!token) return { ok: false, reason: "unknown" };
    const device = this.byHash.get(hashToken(token));
    if (!device) return { ok: false, reason: "unknown" };
    if (device.revokedAt) return { ok: false, reason: "revoked" };
    device.lastSeenAt = new Date(this.now()).toISOString();
    device.lastAddress = address ?? device.lastAddress;
    if (this.now() - this.lastFlush > SEEN_FLUSH_MS) this.flush();
    return { ok: true, device };
  }

  list(): LanDevice[] {
    return this.devices.filter((device) => !device.revokedAt).map(toDto);
  }

  revoke(id: string): boolean {
    const device = this.devices.find((item) => item.id === id && !item.revokedAt);
    if (!device) return false;
    device.revokedAt = new Date(this.now()).toISOString();
    this.flush();
    return true;
  }
}

function toDto(device: StoredDevice): LanDevice {
  return { id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, lastAddress: device.lastAddress };
}
