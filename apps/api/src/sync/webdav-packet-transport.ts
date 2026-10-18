import type { PacketTransport } from "@orion/core/src/link/packet-transport";

/** То, что нужно адаптеру от `WebdavRemote` (в тестах подставляется ящик в памяти). */
export interface LinkWebdavFiles {
  putFile(rel: string, data: Buffer): Promise<void>;
  getFile(rel: string): Promise<Buffer>;
  exists(rel: string): Promise<boolean>;
  deleteFile(rel: string): Promise<void>;
  listNames(rel: string): Promise<string[]>;
}

/**
 * ADR-0020: `PacketTransport` поверх WebDAV. Только PUT нового имени / GET / PROPFIND / DELETE — без ETag, lock и
 * MOVE, потому что у произвольного провайдера (Mail.ru и др. — кандидаты, не гарантии) их нет. «Создать новое
 * имя» не атомарно (exists→PUT), это безопасно лишь потому, что в каждый каталог пишет ровно один участник
 * (раскладка `up/<device>`, `down/<device>`); недописанный файл отсекает кодек пакета (GCM-тег), а не адаптер.
 */
export class WebdavPacketTransport implements PacketTransport {
  readonly kind = "webdav" as const;

  constructor(
    private readonly files: LinkWebdavFiles,
    private readonly now: () => number = Date.now
  ) {}

  async probe() {
    const started = this.now();
    try {
      await this.files.listNames("orion-link");
      return { ok: true, latencyMs: this.now() - started };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  async put(path: string, bytes: Uint8Array): Promise<boolean> {
    if (await this.files.exists(path)) return false;
    await this.files.putFile(path, Buffer.from(bytes));
    return true;
  }

  list(dir: string): Promise<string[]> {
    return this.files.listNames(dir);
  }

  async get(path: string): Promise<Uint8Array | null> {
    if (!(await this.files.exists(path))) return null;
    return new Uint8Array(await this.files.getFile(path));
  }

  remove(path: string): Promise<void> {
    return this.files.deleteFile(path);
  }
}
