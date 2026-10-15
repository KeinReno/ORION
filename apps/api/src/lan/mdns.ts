import { Bonjour, type Service } from "bonjour-service";
import { LAN_PROTOCOL_VERSION, LAN_SERVICE_TYPE, type LanDiscoveredNode } from "@orion/shared-types";

export interface Advertisement {
  name: string;
  nodeId: string;
  fingerprint: string;
  port: number;
}

/**
 * DNS-SD `_orion._tcp`. В TXT — только версия протокола, имя узла, nodeId и отпечаток сертификата:
 * ни пользователей, ни названий пространств. Чисто-JS реализация (bonjour-service → multicast-dns), без нативных модулей.
 */
export class MdnsAdvertiser {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;

  start(ad: Advertisement): void {
    this.stop();
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name: ad.name,
      type: LAN_SERVICE_TYPE,
      protocol: "tcp",
      port: ad.port,
      txt: { v: String(LAN_PROTOCOL_VERSION), name: ad.name, id: ad.nodeId, fp: ad.fingerprint.replace(/:/g, "") }
    });
  }

  get active(): boolean {
    return this.service !== null;
  }

  stop(): void {
    try {
      this.service?.stop?.();
      this.bonjour?.destroy();
    } catch {
      // Остановка best-effort: сокет мог уже закрыться вместе с процессом.
    }
    this.service = null;
    this.bonjour = null;
  }
}

/** Разовый поиск узлов; мультикаст режется многими роутерами, поэтому ручной ввод адреса остаётся обязательным путём. */
export function discoverNodes(timeoutMs = 3000): Promise<LanDiscoveredNode[]> {
  return new Promise((resolve) => {
    const found = new Map<string, LanDiscoveredNode>();
    let bonjour: Bonjour;
    try {
      bonjour = new Bonjour();
    } catch {
      return resolve([]);
    }
    const browser = bonjour.find({ type: LAN_SERVICE_TYPE, protocol: "tcp" }, (service) => {
      const txt = (service.txt ?? {}) as Record<string, string>;
      const address = service.addresses?.find((item) => /^\d+\.\d+\.\d+\.\d+$/.test(item)) ?? service.referer?.address;
      if (!address || !txt.id || !txt.fp) return;
      const fingerprint = txt.fp.toUpperCase().match(/../g)?.join(":") ?? "";
      found.set(txt.id, { protocol: Number(txt.v) || 1, nodeId: txt.id, name: txt.name ?? service.name, fingerprint, address, port: service.port });
    });
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
