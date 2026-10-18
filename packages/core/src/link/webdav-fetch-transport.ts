import type { PacketTransport } from "./packet-transport";

export interface WebdavFetchOptions {
  /** Адрес сервера, напр. `https://webdav.cloud.mail.ru`. */
  url: string;
  username: string;
  password: string;
  /** Папка Orion в облаке, напр. `/ORION`; ящик Link лежит внутри неё. */
  baseDir: string;
  fetch?: typeof fetch;
}

const encoder = new TextEncoder();

function basicAuth(user: string, password: string): string {
  const bytes = encoder.encode(`${user}:${password}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, "");

/** Размер ответа PROPFIND ограничен: листинг каталога ящика не должен тянуть мегабайты. */
const MAX_PROPFIND_BYTES = 2 * 1024 * 1024;

/**
 * ADR-0020: `PacketTransport` для самого устройства (Android/десктоп) — прямой WebDAV поверх `fetch`, без
 * зависимостей. Нужны только PUT / GET / PROPFIND(Depth:1) / MKCOL / DELETE; перезапись защищена
 * `If-None-Match: *` там, где сервер её понимает (412 → «имя занято»), а у остальных страхует схема
 * «один писатель на каталог». Из браузера прямой вызов упирается в CORS провайдера — это ограничение платформы,
 * а не транспорта.
 */
export class WebdavFetchTransport implements PacketTransport {
  readonly kind = "webdav" as const;
  private readonly doFetch: typeof fetch;
  private readonly auth: string;
  private readonly root: string;
  private readonly knownDirs = new Set<string>();

  constructor(private readonly options: WebdavFetchOptions) {
    this.doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.auth = basicAuth(options.username, options.password);
    this.root = trimSlashes(options.baseDir);
  }

  /** Адрес по пути от корня сервера (включая `baseDir`). */
  private absUrl(serverPath: string): string {
    return `${this.options.url.replace(/\/+$/, "")}/${trimSlashes(serverPath).split("/").map(encodeURIComponent).join("/")}`;
  }

  private urlFor(path: string): string {
    return this.absUrl([this.root, trimSlashes(path)].filter(Boolean).join("/"));
  }

  private request(method: string, path: string, init: { headers?: Record<string, string>; body?: Uint8Array | string } = {}): Promise<Response> {
    return this.doFetch(this.urlFor(path), {
      method,
      headers: { Authorization: this.auth, ...init.headers },
      body: init.body as RequestInit["body"],
      redirect: "error"
    });
  }

  async probe() {
    const started = Date.now();
    try {
      const res = await this.request("PROPFIND", "", { headers: { Depth: "0" } });
      if (res.status === 207 || res.status === 200 || res.status === 404) {
        return { ok: true, latencyMs: Date.now() - started };
      }
      return { ok: false, reason: `WebDAV ответил ${res.status}` };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  /** Создаёт недостающие каталоги от корня сервера: сначала `baseDir`, затем родители файла. */
  private async ensureDirs(path: string): Promise<void> {
    const parts = [...this.root.split("/").filter(Boolean), ...trimSlashes(path).split("/").slice(0, -1)];
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (this.knownDirs.has(cur)) continue;
      const res = await this.doFetch(this.absUrl(cur), { method: "MKCOL", headers: { Authorization: this.auth }, redirect: "error" });
      // 201 создана, 405 уже есть; остальное — настоящая ошибка
      if (res.status !== 201 && res.status !== 405 && res.status !== 200) {
        throw new Error(`WebDAV не создал каталог ${cur}: ${res.status}`);
      }
      this.knownDirs.add(cur);
    }
  }

  async put(path: string, bytes: Uint8Array): Promise<boolean> {
    const send = () =>
      this.request("PUT", path, { headers: { "If-None-Match": "*", "Content-Type": "application/octet-stream" }, body: bytes });
    let res = await send();
    if (res.status === 409 || res.status === 404) {
      // нет родительского каталога
      await this.ensureDirs(path);
      res = await send();
    }
    if (res.status === 412) return false;
    if (res.status === 201 || res.status === 200 || res.status === 204) return true;
    throw new Error(`WebDAV PUT ${path}: ${res.status}`);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const res = await this.request("GET", path);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`WebDAV GET ${path}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async list(dir: string): Promise<string[]> {
    const res = await this.request("PROPFIND", dir, {
      headers: { Depth: "1", "Content-Type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
    });
    if (res.status === 404) return [];
    if (res.status !== 207) throw new Error(`WebDAV PROPFIND ${dir}: ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_PROPFIND_BYTES) throw new Error("Ответ PROPFIND слишком большой");
    const self = trimSlashes(decodeURIComponent(new URL(this.urlFor(dir)).pathname));
    const names = new Set<string>();
    for (const match of text.matchAll(/<(?:[A-Za-z0-9]+:)?href>([^<]*)<\/(?:[A-Za-z0-9]+:)?href>/g)) {
      let href = match[1]!.trim();
      try {
        href = decodeURIComponent(href.startsWith("http") ? new URL(href).pathname : href);
      } catch {
        continue;
      }
      const clean = trimSlashes(href);
      if (clean === self || !clean.startsWith(`${self}/`)) continue;
      names.add(clean.slice(self.length + 1).split("/")[0]!);
    }
    return [...names].sort();
  }

  async remove(path: string): Promise<void> {
    const res = await this.request("DELETE", path);
    if (res.status === 404 || res.ok) return;
    throw new Error(`WebDAV DELETE ${path}: ${res.status}`);
  }
}
