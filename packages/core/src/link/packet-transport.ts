/**
 * ADR-0020: асинхронный «почтовый ящик» под Orion Link. Адаптер знает только пути и байты — ничего
 * о списках/заметках/задачах. Требования намеренно минимальны (без ETag/lock/rename): единственная
 * сильная операция — создание нового имени, перезапись существующего не используется.
 */
export interface PacketTransport {
  readonly kind: "lan" | "webdav" | "s3" | "orion-server";
  probe(): Promise<{ ok: boolean; latencyMs?: number; reason?: string }>;
  /** Создать файл. Если имя занято — ничего не меняет и возвращает `false`. */
  put(path: string, bytes: Uint8Array): Promise<boolean>;
  /** Непосредственные дети каталога (имена, по возрастанию). Нет каталога — пустой список. */
  list(dir: string): Promise<string[]>;
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
}

/** Ящик в памяти для тестов; умеет ломаться и портить байты, как плохой провайдер. */
export class MemoryPacketTransport implements PacketTransport {
  readonly kind = "webdav" as const;
  readonly files = new Map<string, Uint8Array>();
  /** Следующие N вызовов любой операции бросают сетевую ошибку. */
  failNext = 0;
  /** Следующие N `get` отдают усечённые наполовину байты (недописанный файл). */
  truncateNextGets = 0;
  /** Следующие N `get` отдают байты с перевёрнутым битом. */
  corruptNextGets = 0;

  private guard(): void {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new TypeError("fetch failed");
    }
  }

  async probe() {
    try {
      this.guard();
      return { ok: true, latencyMs: 0 };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  async put(path: string, bytes: Uint8Array): Promise<boolean> {
    this.guard();
    if (this.files.has(path)) return false;
    this.files.set(path, bytes.slice());
    return true;
  }

  async list(dir: string): Promise<string[]> {
    this.guard();
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      names.add(path.slice(prefix.length).split("/")[0]!);
    }
    return [...names].sort();
  }

  async get(path: string): Promise<Uint8Array | null> {
    this.guard();
    const bytes = this.files.get(path);
    if (!bytes) return null;
    if (this.truncateNextGets > 0) {
      this.truncateNextGets -= 1;
      return bytes.slice(0, Math.floor(bytes.length / 2));
    }
    if (this.corruptNextGets > 0) {
      this.corruptNextGets -= 1;
      const copy = bytes.slice();
      copy[copy.length - 1] = copy[copy.length - 1]! ^ 1;
      return copy;
    }
    return bytes.slice();
  }

  async remove(path: string): Promise<void> {
    this.guard();
    this.files.delete(path);
  }
}
