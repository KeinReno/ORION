import os from "node:os";
import { lanNodeCardSchema, type LanDiscoveredNode } from "@orion/shared-types";
import { observeCertificate, pinnedJson } from "./pinned-request";

/**
 * Поиск узлов перебором своей подсети — запасной путь к mDNS. Мультикаст на Windows часто не доходит: уходит не в тот
 * адаптер (Hyper-V, WSL, VPN), режется роутером, а ответы на UDP 5353 отбрасывает брандмауэр ищущего компьютера (правило
 * на 5353 ставится только на хосте). Перебор — обычные исходящие TCP-соединения на порт ORION, которые брандмауэр не режет.
 *
 * Узел засчитывается, только если визитка `GET /lan/info` пришла по TLS с тем самым сертификатом, отпечаток которого в
 * ней указан: чужой сервис на порту 4443 или подделка визитки не проходят. Дальше сопряжение всё равно закрепляет сертификат.
 */

/** Виртуальные машины и контейнеры: домашних устройств и телефона там нет. */
const HYPERVISOR_ADAPTER = /vethernet|hyper-v|wsl|virtualbox|vmware|vbox|docker|podman|br-|veth|npcap|loopback/i;

/**
 * Сети, которые сами по себе соединяют компьютеры: Tailscale, WireGuard, ZeroTier, Hamachi, Radmin.
 * Домашний Wi-Fi их не видит, зато телефон «в той же сети через VPN» сидит именно здесь.
 */
const OVERLAY_ADAPTER = /utun|tun|tap|zerotier|tailscale|wireguard|hamachi|radmin/i;

export interface LanInterface {
  name: string;
  address: string;
  netmask: string;
}

function interfacesMatching(
  pattern: RegExp | null,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>
): LanInterface[] {
  const result: LanInterface[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (HYPERVISOR_ADAPTER.test(name)) continue;
    if (pattern && !pattern.test(name)) continue;
    if (!pattern && OVERLAY_ADAPTER.test(name)) continue;
    for (const item of list ?? []) {
      if (item.family !== "IPv4" || item.internal || item.address.startsWith("169.254.")) continue;
      result.push({ name, address: item.address, netmask: item.netmask });
    }
  }
  return result;
}

/** Домашние IPv4-адаптеры (без loopback, link-local, гипервизоров и VPN). Через них объявляем узел в квартире. */
export function physicalInterfaces(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanInterface[] {
  return interfacesMatching(null, interfaces);
}

/** VPN и похожие сети, где телефон и компьютер могут видеть друг друга без общего Wi-Fi. */
export function overlayInterfaces(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanInterface[] {
  return interfacesMatching(OVERLAY_ADAPTER, interfaces);
}

/** Куда смотреть, когда ищем другой ORION: дом и VPN. */
export function discoveryInterfaces(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanInterface[] {
  return [...physicalInterfaces(interfaces), ...overlayInterfaces(interfaces)];
}

/** Основной домашний адрес: сначала 192.168.x.x, потом 10.x, потом 172.16–31.x — через него объявляем узел по mDNS. */
export function primaryLanAddress(interfaces: readonly LanInterface[] = physicalInterfaces()): string | null {
  const rank = (address: string): number =>
    address.startsWith("192.168.") ? 0 : address.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2 : 3;
  return [...interfaces].sort((a, b) => rank(a.address) - rank(b.address))[0]?.address ?? null;
}

const toInt = (address: string): number => address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
const toAddress = (value: number): string => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");

/**
 * Адреса для перебора: подсеть каждого адаптера, но не шире /24 вокруг своего адреса (домашняя сеть почти всегда /24;
 * перебирать /16 — минуты). Свои адреса, адрес сети и широковещательный исключены.
 */
export function subnetCandidates(interfaces: readonly LanInterface[] = physicalInterfaces()): string[] {
  const own = new Set(interfaces.map((item) => item.address));
  const result = new Set<string>();
  for (const item of interfaces) {
    const prefix = item.netmask.split(".").reduce((bits, part) => bits + (Number(part).toString(2).match(/1/g)?.length ?? 0), 0);
    const width = Math.max(prefix, 24);
    const mask = width === 32 ? 0xffffffff : (0xffffffff << (32 - width)) >>> 0;
    const network = (toInt(item.address) & mask) >>> 0;
    const size = 2 ** (32 - width);
    for (let offset = 1; offset < size - 1; offset++) {
      const address = toAddress(network + offset);
      if (!own.has(address)) result.add(address);
    }
  }
  return [...result];
}

export type CardProbe = (address: string, port: number, timeoutMs: number) => Promise<LanDiscoveredNode | null>;

/** Одна проба: сертификат узла → визитка по TLS с этим сертификатом → отпечатки совпадают. */
export const probeCard: CardProbe = async (address, port, timeoutMs) => {
  try {
    const observed = await observeCertificate(address, port, timeoutMs);
    const response = await pinnedJson(
      { address, port, certPem: observed.certPem },
      "GET",
      "/lan/info",
      { timeoutMs: timeoutMs * 2 }
    );
    const card = lanNodeCardSchema.safeParse(response.body);
    if (response.status !== 200 || !card.success || card.data.fingerprint !== observed.fingerprint) return null;
    return { ...card.data, address, port };
  } catch {
    return null;
  }
};

export async function scanSubnet(
  ports: readonly number[],
  options: { candidates?: string[]; probe?: CardProbe; concurrency?: number; timeoutMs?: number } = {}
): Promise<LanDiscoveredNode[]> {
  const candidates = options.candidates ?? subnetCandidates();
  const probe = options.probe ?? probeCard;
  const timeoutMs = options.timeoutMs ?? 700;
  const jobs = candidates.flatMap((address) => [...new Set(ports)].map((port) => ({ address, port })));
  const found = new Map<string, LanDiscoveredNode>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const node = await probe(job.address, job.port, timeoutMs);
      if (node && !found.has(node.nodeId)) found.set(node.nodeId, node);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 64, jobs.length) }, () => worker()));
  return [...found.values()];
}

/**
 * Адреса других устройств в Tailscale. У интерфейса часто маска /32, поэтому перебор подсети их не видит,
 * а multicast через Tailscale не ходит. `tailscale status --json`: у каждого Peer поле `TailscaleIPs`.
 */
export function tailscalePeerAddresses(status: unknown): string[] {
  if (!status || typeof status !== "object") return [];
  const peer = (status as { Peer?: unknown }).Peer;
  const peers = Array.isArray(peer) ? peer : peer && typeof peer === "object" ? Object.values(peer as Record<string, unknown>) : [];
  const ips: string[] = [];
  for (const item of peers) {
    if (!item || typeof item !== "object") continue;
    const row = item as { Online?: boolean; TailscaleIPs?: unknown };
    if (row.Online === false) continue;
    for (const ip of Array.isArray(row.TailscaleIPs) ? row.TailscaleIPs : []) {
      if (typeof ip === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ips.push(ip);
    }
  }
  return [...new Set(ips)];
}

/** mDNS-находки главнее (у них адрес, который узел объявил сам); перебор дополняет тем, что мультикаст не донёс. */
export function mergeDiscovered(mdns: readonly LanDiscoveredNode[], scanned: readonly LanDiscoveredNode[]): LanDiscoveredNode[] {
  const byId = new Map<string, LanDiscoveredNode>();
  for (const node of [...scanned, ...mdns]) byId.set(node.nodeId, node);
  return [...byId.values()];
}
