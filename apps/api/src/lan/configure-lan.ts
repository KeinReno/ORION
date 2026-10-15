import type { INestApplication } from "@nestjs/common";
import { createDeviceTrustMiddleware } from "./device-trust.middleware";
import { LanService } from "./lan.service";
import { createRemoteProxy } from "./remote-proxy";

/**
 * Подключает LAN-слои к HTTP-приложению. Вызывается из configureApp ПОСЛЕ CORS и ДО body-parser'ов:
 * прокси узла стримит тело как есть, а доверие устройств должно сработать раньше любого контроллера.
 */
export function configureLan(app: INestApplication): void {
  let lan: LanService;
  try {
    lan = app.get(LanService, { strict: false });
  } catch {
    return; // приложение собрано без LanModule (узкие тесты)
  }
  if (lan.active) app.use(createDeviceTrustMiddleware(lan.devices));
  app.use(
    createRemoteProxy({
      isClientMode: () => lan.isClientMode(),
      binding: () => lan.binding(),
      onResult: (state) => lan.noteLink(state)
    })
  );
}
