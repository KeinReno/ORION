import { Logger } from "@nestjs/common";
import { Bonjour, type Service } from "bonjour-service";
import { LAN_PROTOCOL_VERSION, LAN_SERVICE_TYPE, type LanDiscoveredNode } from "@orion/shared-types";
import { discoveryInterfaces, overlayInterfaces, primaryLanAddress } from "./lan-scan";

export interface Advertisement {
  name: string;
  nodeId: string;
  fingerprint: string;
  port: number;
}

const log = new Logger("LanMdns");

/**
 * Сокет mDNS на конкретном адаптере. Без `interface` multicast-dns шлёт через «интерфейс по умолчанию» — на Windows
 * это часто адаптер Hyper-V/WSL/VPN, и объявление не доходит до домашней сети. Принимаем на всех адресах (`bind`
 * 0.0.0.0, с reuseAddr — порт 5353 делится с системной службой). Ошибки сокета (порт занят, адаптер пропал) — в журнал:
 * по умолчанию библиотека бросает их и может уронить процесс.
 */
function bonjourOn(address: string | null): Bonjour {
  // bonjour-service passes these straight to multicast-dns, but types its constructor as a service config.
  const options = (address ? { interface: address, bind: "0.0.0.0" } : {}) as unknown as ConstructorParameters<typeof Bonjour>[0];
  return new Bonjour(options, (error: unknown) => log.warn(`mDNS${address ? ` (${address})` : ""}: ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * DNS-SD `_orion._tcp`. В TXT — только версия протокола, имя узла, nodeId и отпечаток сертификата:
 * ни пользователей, ни названий пространств. Чисто-JS реализация (bonjour-service → multicast-dns), без нативных модулей.
 * Объявление идёт через основной домашний адаптер (один экземпляр: два объявления одного имени конфликтовали бы друг с другом).
 */
export class MdnsAdvertiser {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;

  start(ad: Advertisement): void {
    this.stop();
    // Сначала дом. Если домашнего адаптера нет (компьютер только в VPN) — объявляем в VPN.
    this.bonjour = bonjourOn(primaryLanAddress() ?? primaryLanAddress(overlayInterfaces()));
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

/**
 * Разовый поиск узлов: запрос уходит через КАЖДЫЙ реальный адаптер (не только через «по умолчанию»). Мультикаст режется
 * многими роутерами и брандмауэром, поэтому рядом всегда работает перебор подсети (`lan-scan.ts`) и ручной ввод адреса.
 */
export function discoverNodes(timeoutMs = 3000): Promise<LanDiscoveredNode[]> {
  return new Promise((resolve) => {
    const found = new Map<string, LanDiscoveredNode>();
    const addresses = discoveryInterfaces().map((item) => item.address);
    const instances: Bonjour[] = [];
    for (const address of addresses.length > 0 ? addresses : [null]) {
      try {
        instances.push(bonjourOn(address));
      } catch (error) {
        log.warn(`mDNS-поиск на ${address ?? "адаптере по умолчанию"} не запущен: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const browsers = instances.map((bonjour) =>
      bonjour.find({ type: LAN_SERVICE_TYPE, protocol: "tcp" }, (service) => {
        const txt = (service.txt ?? {}) as Record<string, string>;
        const address = service.addresses?.find((item) => /^\d+\.\d+\.\d+\.\d+$/.test(item)) ?? service.referer?.address;
        if (!address || !txt.id || !txt.fp) return;
        const fingerprint = txt.fp.toUpperCase().match(/../g)?.join(":") ?? "";
        found.set(txt.id, { protocol: Number(txt.v) || 1, nodeId: txt.id, name: txt.name ?? service.name, fingerprint, address, port: service.port });
      })
    );
    setTimeout(() => {
      for (const browser of browsers) browser.stop();
      for (const bonjour of instances) {
        try {
          bonjour.destroy();
        } catch {
          /* best-effort */
        }
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
