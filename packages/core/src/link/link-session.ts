import type { LinkPairing } from "@orion/shared-types";
import { RelayNodeTransport } from "./relay";
import { WebdavFetchTransport, type WebdavFetchOptions } from "./webdav-fetch-transport";

export interface LinkSessionOptions {
  /** Ответ `POST workspaces/:id/link/devices` — хранить его платформа должна в защищённом хранилище устройства. */
  pairing: LinkPairing;
  webdav: WebdavFetchOptions;
  /** Пауза между опросами ответа, мс (по умолчанию 2000). */
  pollMs?: number;
  /** Сколько опросов ждать ответ узла, прежде чем считать его офлайн (по умолчанию 15 ≈ 30 с). */
  maxPolls?: number;
}

/**
 * ADR-0020: транспорт `ReplicaEngine` для устройства, у которого нет прямого пути до узла. Собирается из ответа
 * спаривания и настроек WebDAV; дальше устройство работает с движком так же, как по LAN.
 */
export function createLinkTransport(options: LinkSessionOptions): RelayNodeTransport {
  const { pairing, webdav } = options;
  const pollMs = options.pollMs ?? 2000;
  const bytes = Uint8Array.from(atob(pairing.key), (c) => c.charCodeAt(0));
  return new RelayNodeTransport({
    box: new WebdavFetchTransport(webdav),
    workspaceId: pairing.workspaceId,
    epoch: pairing.epoch,
    keys: [{ keyId: pairing.keyId, raw: bytes }],
    deviceId: pairing.linkDeviceId,
    maxPolls: options.maxPolls ?? 15,
    wait: (attempt) => (attempt === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, pollMs)))
  });
}
