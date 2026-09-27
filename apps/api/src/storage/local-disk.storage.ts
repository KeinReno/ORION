import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import type { StorageAdapter } from "./storage-adapter";

/**
 * The default driver: files under a real directory on the API host, mirroring
 * the document tree one-to-one so the whole store is browsable in Explorer /
 * Finder and trivially backed up. Root is `STORAGE_DIR` (default
 * `<apps/api>/.data/documents`).
 *
 * Every public method resolves the incoming POSIX `key` against the root and
 * refuses to escape it (`..`), so a crafted key can't touch the rest of the
 * disk.
 */
@Injectable()
export class LocalDiskStorage implements StorageAdapter {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;

  constructor() {
    const configured = process.env.STORAGE_DIR?.trim();
    this.root = path.resolve(configured && configured.length > 0 ? configured : path.join(process.cwd(), ".data", "documents"));
    this.logger.log(`Local document storage at ${this.root}`);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key.replace(/^\/+/, ""));
    const rel = path.relative(this.root, full);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Storage key escapes the root: ${key}`);
    }
    return full;
  }

  async putFile(key: string, data: Buffer): Promise<void> {
    const dest = this.resolve(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
  }

  async mkdir(key: string): Promise<void> {
    await fs.mkdir(this.resolve(key), { recursive: true });
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const target = this.resolve(key);
    // Fail loudly here rather than handing back a stream that errors later.
    await fs.access(target);
    return range ? createReadStream(target, { start: range.start, end: range.end }) : createReadStream(target);
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { recursive: true, force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
