import { Logger } from "@nestjs/common";
// webdav v4 — CommonJS-сборка, обычный импорт работает под ts-node-dev без
// ESM-плясок (тот же пакет уже используется в storage/webdav.storage.ts).
import { createClient, type FileStat, type WebDAVClient } from "webdav";
import { MAX_REMOTE_RESPONSE_BYTES, publicOnlyAgents } from "../common/remote-url-guard";

/**
 * S05 — redirect/size limits для WebDAV-транспорта (в отличие от `fetch()`,
 * которым идут ICS-календари в `calendar-connections.service.ts`).
 *
 * **Размер ответа — закрыт.** `webdav` (v4, `createClient`) прокидывает
 * `maxContentLength`/`maxBodyLength` прямо в свой internal axios-клиент
 * (`WebDAVClientOptions`, см. `node_modules/webdav/dist/node/types.d.ts`) —
 * это официальная публичная опция конструктора, не приватность реализации,
 * поэтому используем её напрямую ниже с тем же лимитом (`MAX_REMOTE_RESPONSE_BYTES`,
 * 5 МиБ), что и ICS-фиды.
 *
 * **Редирект — осознанно НЕ перехватывается на уровне транспорта.**
 * `webdav` не даёт `redirect: "manual"` через публичный API: единственный
 * способ заставить его internal axios не следовать 3xx — переписать функцию
 * `request` через `getPatcher()` (экспортируемый, но недокументированный
 * hot-patch хук самого пакета) и самим вызвать `axios(...)` с
 * `maxRedirects: 0`, для чего пришлось бы объявить `axios` прямой
 * зависимостью `apps/api` только ради обхода внутренностей чужого пакета —
 * не публичный контракт (`webdav` может сменить HTTP-клиент в любой мажорной
 * версии и тихо сломать патч), и патч глобален на процесс (задел бы заодно
 * `storage/webdav.storage.ts`, отдельный, admin-конфигурируемый клиент).
 * Решено оставить как есть, а не городить хрупкий патч ради обхода приватной
 * реализации, по трём причинам:
 *   1. WebDAV remote — не произвольный untrusted URL вроде ICS-фида: это
 *      адрес, который сам владелец пространства явно ввёл и сохранил как
 *      *свою* точку бэкапа (`putRemote`) — уровень доверия к этому URL выше,
 *      чем к чужому календарю, который может прислать кто угодно.
 *   2. Хостнейм проверяется дважды и по IP: `assertPublicRemoteUrl` при
 *      сохранении конфига (`putRemote`) **и** `assertResolvedHostIsPublic`
 *      заново прямо перед каждым сетевым вызовом (`remoteFor`, DNS-rebinding
 *      re-check) — редирект добавил бы третью зависимую от DNS проверку по
 *      тому же принципу, а не закрыл бы принципиально новую дыру.
 *   3. Практический ущерб от непойманного редиректа — WebDAV-запрос (PUT/GET
 *      бэкапа) уйдёт на другой адрес, выбранный *уже скомпрометированным*
 *      сервером, который пользователь сам настроил как доверенный — не
 *      слепой SSRF на произвольный внутренний адрес по вине атакующего
 *      извне, как в сценарии ICS.
 * Если это решение пересмотрят — интеграционный тест для WebDAV-редиректа
 * должен зеркалить `remote-url-guard-dns.integration.test.ts` (реальный
 * `node:http`-стаб с 302), не мокать `webdav`.
 */

/**
 * Тонкая обёртка над пакетом `webdav` под нужды модуля синхронизации.
 * Работает на стороне `apps/api` (Node) — поэтому, в отличие от Remotely
 * Save в webview Obsidian, никакого CORS и патча транспорта не нужно
 * (см. `docs/SYNC.md` §1.2).
 *
 * Все пути внутри — относительно `<baseDir>/<workspaceId>`; наружу отдаём
 * человекочитаемые ошибки, а не сырые исключения библиотеки.
 */
export interface WebdavRemoteConfig {
  url: string;
  username: string;
  password: string;
  /** Напр. `/ORION`. */
  baseDir: string;
  workspaceId: string;
  /** false → сервер без `Depth: infinity` (Mail.ru): листинг по уровням. */
  depthInfinity: boolean;
}

export class WebdavRemote {
  private readonly logger = new Logger(WebdavRemote.name);
  private readonly client: WebDAVClient;
  private readonly root: string;

  constructor(private readonly cfg: WebdavRemoteConfig) {
    this.client = createClient(cfg.url, {
      username: cfg.username,
      password: cfg.password,
      // S05: response-size cap, same limit as ICS feeds (see block comment
      // above) — official `WebDAVClientOptions` field, forwarded straight
      // into the internal axios client's `maxContentLength`.
      maxContentLength: MAX_REMOTE_RESPONSE_BYTES,
      // DNS pinned at connect time (see remote-url-guard `publicOnlyLookup`):
      // `remoteFor`'s pre-request re-check alone left a window in which a
      // rebinding resolver could answer differently for the real socket.
      ...publicOnlyAgents()
    });
    this.root = joinPath(cfg.baseDir, cfg.workspaceId);
  }

  private at(rel: string): string {
    return joinPath(this.root, rel);
  }

  /** PROPFIND корня рабочего пространства; создаёт его при первом обращении. */
  async connectAndCount(): Promise<number> {
    try {
      await this.ensureDir("");
      const items = await this.client.getDirectoryContents(this.root, { deep: false });
      return Array.isArray(items) ? items.length : (items as { data: unknown[] }).data.length;
    } catch (err) {
      throw new Error(describeWebdavError(err));
    }
  }

  /** Создаёт `<root>/<rel>` и недостающих родителей. No-op, если уже есть. */
  async ensureDir(rel: string): Promise<void> {
    const path = this.at(rel);
    try {
      if (!(await this.client.exists(path))) {
        await this.client.createDirectory(path, { recursive: true });
      }
    } catch (err) {
      // recursive:true не на всех серверах — добиваем поэлементно.
      await this.mkdirStepwise(path);
      void err;
    }
  }

  private async mkdirStepwise(absPath: string): Promise<void> {
    const parts = absPath.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur += `/${part}`;
      if (!(await this.client.exists(cur))) {
        await this.client.createDirectory(cur).catch(() => undefined);
      }
    }
  }

  async putFile(rel: string, data: Buffer): Promise<void> {
    const path = this.at(rel);
    await this.ensureDir(parentOf(rel));
    try {
      await this.client.putFileContents(path, data, { overwrite: true });
    } catch (err) {
      throw new Error(describeWebdavError(err));
    }
  }

  async getFile(rel: string): Promise<Buffer> {
    try {
      const out = await this.client.getFileContents(this.at(rel), { format: "binary" });
      return Buffer.from(out as ArrayBuffer);
    } catch (err) {
      throw new Error(describeWebdavError(err));
    }
  }

  async exists(rel: string): Promise<boolean> {
    return this.client.exists(this.at(rel));
  }

  async deleteFile(rel: string): Promise<void> {
    try {
      await this.client.deleteFile(this.at(rel));
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw new Error(describeWebdavError(err));
    }
  }

  /** Имена всех непосредственных детей папки (файлы и подпапки). Нет папки — пустой список. */
  async listNames(rel: string): Promise<string[]> {
    const path = this.at(rel);
    if (!(await this.client.exists(path))) return [];
    const raw = await this.client.getDirectoryContents(path, { deep: false });
    const items = (Array.isArray(raw) ? raw : (raw as { data: FileStat[] }).data) as FileStat[];
    return items.map((i) => i.basename).sort();
  }

  /** Плоский листинг одной папки: `[{ name, size, lastmod }]`. */
  async listDir(rel: string): Promise<Array<{ name: string; size: number; lastmod: string }>> {
    const path = this.at(rel);
    if (!(await this.client.exists(path))) return [];
    const raw = await this.client.getDirectoryContents(path, { deep: false });
    const items = (Array.isArray(raw) ? raw : (raw as { data: FileStat[] }).data) as FileStat[];
    return items
      .filter((i) => i.type === "file")
      .map((i) => ({ name: i.basename, size: i.size, lastmod: i.lastmod }));
  }
}

// --- вспомогательное ---------------------------------------------------------

function joinPath(...parts: string[]): string {
  return (
    "/" +
    parts
      .flatMap((p) => p.split("/"))
      .map((s) => s.trim())
      .filter(Boolean)
      .join("/")
  );
}

function parentOf(rel: string): string {
  const i = rel.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "" : rel.slice(0, i);
}

/** Сырое исключение `webdav`/сети → строка для пользователя (по-русски). */
export function describeWebdavError(err: unknown): string {
  const status = (err as { status?: number }).status;
  const code = (err as { code?: string }).code;
  if (status === 401 || status === 403) return "Неверный логин или пароль WebDAV (или нет прав на папку)";
  if (status === 404) return "Адрес WebDAV отвечает, но путь не найден — проверьте базовую папку";
  if (status === 405) return "Сервер не разрешил операцию (MKCOL/PUT) — проверьте права аккаунта";
  if (status === 507) return "На облаке кончилось место";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Не резолвится адрес WebDAV — проверьте URL";
  if (code === "ECONNREFUSED") return "Соединение отклонено — проверьте URL и порт";
  if (code === "ETIMEDOUT") return "Таймаут соединения с облаком";
  const msg = (err as Error).message ?? String(err);
  return `Ошибка WebDAV: ${msg}`;
}
