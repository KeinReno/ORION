import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { PacketTransport } from "@orion/core/src/link/packet-transport";
import { RelayIngress } from "@orion/core/src/link/relay";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { PrismaService } from "../common/prisma.service";
import { hybridNodeTransport } from "./hybrid-node-transport";
import { HybridSyncService } from "./hybrid-sync.service";
import { LinkService } from "./link.service";
import { SyncService } from "./sync.service";
import { WebdavPacketTransport } from "./webdav-packet-transport";

/**
 * ADR-0020: узел принимает запросы Link-устройств из облачного ящика (WebDAV удалёнки пространства) и исполняет
 * их тем же `HybridSyncService`, что и REST. Ящик пространства — это его удалёнка бэкапа (`SyncRemote`), но в
 * отдельном каталоге `orion-link/`, снимки бэкапа лежат в `snapshots/` и не пересекаются.
 */
@Injectable()
export class LinkIngressService {
  private readonly logger = new Logger(LinkIngressService.name);

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly prisma: PrismaService,
    private readonly link: LinkService,
    private readonly hybrid: HybridSyncService,
    private readonly sync: SyncService
  ) {}

  @Cron("*/10 * * * * *")
  async tick(): Promise<void> {
    await this.jobs.runJob("core", "link-ingress", async () => {
      const rows = await this.prisma.asSystem((tx) =>
        tx.linkKey.findMany({ where: { retiredAt: null }, select: { workspaceId: true }, distinct: ["workspaceId"] })
      );
      for (const { workspaceId } of rows) {
        // Сбой одного пространства (облако недоступно, настройка пропала) не мешает остальным.
        try {
          const remote = await this.sync.systemRemoteFor(workspaceId);
          if (!remote) continue;
          await this.pollWorkspace(workspaceId, new WebdavPacketTransport(remote));
        } catch (error) {
          this.logger.warn(`link ${workspaceId}: ${(error as Error).message}`);
        }
      }
    });
  }

  /** Один проход по ящику пространства; возвращает число обработанных запросов. */
  async pollWorkspace(workspaceId: string, box: PacketTransport): Promise<number> {
    const keyring = await this.link.keysFor(workspaceId);
    if (!keyring) return 0;
    const ingress = new RelayIngress({
      box,
      workspaceId,
      epoch: keyring.epoch,
      keys: keyring.keys,
      host: async (linkDeviceId) => {
        const userId = await this.link.userForDevice(workspaceId, linkDeviceId);
        return userId ? hybridNodeTransport(this.hybrid, userId) : null;
      }
    });
    return ingress.pollOnce();
  }
}
