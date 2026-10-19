import { PassThrough, type Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
// webdav v4 ships a CommonJS build, so a plain require-style import works
// under ts-node-dev without ESM interop headaches.
import { createClient, type WebDAVClient } from "webdav";
import type { StorageAdapter } from "./storage-adapter";

/**
 * Stores documents on a WebDAV share (Nextcloud, `rclone serve webdav`, a NAS,
 * …). Selected with `STORAGE_DRIVER=webdav`; needs `WEBDAV_URL` and, usually,
 * `WEBDAV_USERNAME` / `WEBDAV_PASSWORD`. Like the local driver it mirrors the
 * document tree as real collections and files on the share.
 */
@Injectable()
export class WebdavStorage implements StorageAdapter {
  private readonly logger = new Logger(WebdavStorage.name);
  private readonly client: WebDAVClient;
  /** Subdirectory on the share everything lives under, so we never touch the share root. */
  private readonly base = "/orion-documents";

  constructor() {
    const url = process.env.WEBDAV_URL?.trim();
    if (!url) {
      throw new Error("STORAGE_DRIVER=webdav requires WEBDAV_URL to be set");
    }
    this.client = createClient(url, {
      username: process.env.WEBDAV_USERNAME ?? "",
      password: process.env.WEBDAV_PASSWORD ?? ""
    });
    this.logger.log(`WebDAV document storage at ${url}${this.base}`);
  }

  private full(key: string): string {
    return `${this.base}/${key.replace(/^\/+/, "")}`;
  }

  private async ensureParent(remotePath: string): Promise<void> {
    const parent = remotePath.slice(0, remotePath.lastIndexOf("/")) || "/";
    if (parent !== "/" && !(await this.client.exists(parent))) {
      await this.client.createDirectory(parent, { recursive: true });
    }
  }

  async putFile(key: string, data: Buffer): Promise<void> {
    const remote = this.full(key);
    await this.ensureParent(remote);
    await this.client.putFileContents(remote, data, { overwrite: true });
  }

  async mkdir(key: string): Promise<void> {
    await this.client.createDirectory(this.full(key), { recursive: true });
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const to = this.full(toKey);
    await this.ensureParent(to);
    await this.client.moveFile(this.full(fromKey), to);
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const to = this.full(toKey);
    await this.ensureParent(to);
    await this.client.copyFile(this.full(fromKey), to);
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const source = this.client.createReadStream(this.full(key), range ? { range } : undefined) as unknown as Readable;
    // `webdav` соединяет внутренний поток с выходным через `pipe()`, а он ошибки не передаёт: оборвалось соединение
    // посреди тела — выходной поток не завершается и не падает, скачивание и бэкап висят вечно (fault-injection, G26).
    // Поэтому сторожим простой: нет данных дольше `WEBDAV_IDLE_TIMEOUT_MS` (по умолчанию 30 с) — поток падает с ошибкой.
    const idleMs = Number(process.env.WEBDAV_IDLE_TIMEOUT_MS) > 0 ? Number(process.env.WEBDAV_IDLE_TIMEOUT_MS) : 30_000;
    const out = new PassThrough();
    let timer: NodeJS.Timeout | undefined;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => out.destroy(new Error(`WebDAV: нет данных ${idleMs} мс — соединение оборвано (${key})`)), idleMs);
    };
    arm();
    source.on("data", arm);
    source.on("error", (error) => out.destroy(error));
    out.on("close", () => {
      clearTimeout(timer);
      source.destroy();
    });
    source.pipe(out);
    return out;
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.deleteFile(this.full(key));
    } catch (err) {
      // Treat "already gone" as success, like the local driver's force:true.
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.client.exists(this.full(key));
  }
}
