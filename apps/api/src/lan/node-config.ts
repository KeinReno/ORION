import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { physicalInterfaces } from "./lan-scan";
import { LAN_DEFAULT_PORT, type LanLoginPolicy, type LanMode } from "@orion/shared-types";

/**
 * ТЗ-04: настройки узла живут в файлах рядом с данными установки, а не в БД. Режим решает,
 * как запускается процесс (bind, TLS), поэтому его читает и лаунчер до старта API; а доверие
 * устройств — свойство машины, и восстановление БД из бэкапа не должно воскрешать чужие токены.
 *
 * `lan-node.json`    — режим, имя, nodeId, порт, владелец. Без секретов.
 * `lan-devices.json` — доверенные устройства (sha256 токена).
 * `lan-client.json`  — привязка к удалённому хосту, включая device-токен (0600).
 * `lan-tls/`         — самоподписанный сертификат хоста и приватный ключ.
 */
export interface LanNodeConfig {
  nodeId: string;
  name: string;
  mode: LanMode;
  port: number;
  ownerUserId: string | null;
  /** Политика входа хоста; нет в файле (старые узлы) — домашняя. */
  loginPolicy: LanLoginPolicy;
}

export interface LanClientBinding {
  nodeId: string;
  name: string;
  address: string;
  port: number;
  fingerprint: string;
  /** PEM закреплённого сертификата хоста. */
  certPem: string;
  deviceToken: string;
  pairedAt: string;
}

export function nodeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.ORION_NODE_DIR?.trim() || path.join(process.cwd(), ".data", "node"));
}

export function defaultNodeName(): string {
  return `ORION-${os.hostname()}`;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Атомарная запись: временный файл + rename, чтобы обрыв не оставил полуфайл. */
export function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode });
  fs.renameSync(tmp, file);
}

export function loadNodeConfig(dir = nodeDir()): LanNodeConfig {
  const file = path.join(dir, "lan-node.json");
  const stored = readJson<Partial<LanNodeConfig>>(file);
  const config: LanNodeConfig = {
    nodeId: stored?.nodeId ?? randomUUID(),
    name: stored?.name?.trim() || defaultNodeName(),
    mode: stored?.mode === "host" || stored?.mode === "client" ? stored.mode : "local",
    port: Number.isInteger(stored?.port) ? (stored!.port as number) : LAN_DEFAULT_PORT,
    ownerUserId: stored?.ownerUserId ?? null,
    loginPolicy: stored?.loginPolicy === "strict" ? "strict" : "home"
  };
  if (!stored?.nodeId) writeJsonAtomic(file, config);
  return config;
}

export function saveNodeConfig(config: LanNodeConfig, dir = nodeDir()): void {
  writeJsonAtomic(path.join(dir, "lan-node.json"), config);
}

export function loadClientBinding(dir = nodeDir()): LanClientBinding | null {
  return readJson<LanClientBinding>(path.join(dir, "lan-client.json"));
}

export function saveClientBinding(binding: LanClientBinding, dir = nodeDir()): void {
  writeJsonAtomic(path.join(dir, "lan-client.json"), binding);
}

export function clearClientBinding(dir = nodeDir()): void {
  fs.rmSync(path.join(dir, "lan-client.json"), { force: true });
}

/** Не-loopback IPv4-адреса машины (для объявления и PUBLIC_API_URL). */
/** IPv4 addresses of this computer, home adapters first (what the user should type on another device). */
export function lanAddresses(): string[] {
  const home = physicalInterfaces().map((item) => item.address);
  const result: string[] = [...home];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254.") && !result.includes(item.address)) result.push(item.address);
    }
  }
  return result;
}
