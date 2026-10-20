import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  ExtensionFetchInput,
  ExtensionFetchResult,
  ExtensionManifest,
  ExtensionRecord,
  ExtensionSecretStatus
} from "@orion/shared-types";
import { extensionFetchInputSchema } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { assertPublicRemoteUrl, requestPublic } from "../common/remote-url-guard";
import { openSecret, sealSecret } from "../sync/sync-crypto";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ExtensionsService } from "./extensions.service";

/** JSON одной записи — больше почти наверняка ошибка (в хранилище кладут файл или весь ответ API). */
export const MAX_RECORD_BYTES = 64 * 1024;
/** Записей одного расширения в одном пространстве. */
export const MAX_RECORDS_PER_EXTENSION = 5_000;
/** Ответ внешнего API, который сервер вернёт расширению. */
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const SECRET_REF = /\{\{secret:([a-z][a-z0-9_]{0,39})\}\}/g;
/** Заголовки ответа, которые есть смысл отдавать коду расширения (без cookies и служебных). */
/** Заголовки запроса, которые задаёт сам сервер: подменённый Host увёл бы запрос на другой сайт того же адреса. */
const FORBIDDEN_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "trailer", "keep-alive", "proxy-authorization"]);
const RESPONSE_HEADERS = ["content-type", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "date", "etag"];

/**
 * Данные, секреты и сеть расширений из папки (ADR-0022, E3). Всё — только для работающего расширения
 * (`ExtensionsService.requireActive`) и только в пределах того, что оно объявило в манифесте:
 * `permissions.storage` — хранилище, `permissions.secrets` — имена секретов, `permissions.network` — хосты.
 */
@Injectable()
export class ExtensionDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly extensions: ExtensionsService
  ) {}

  // ---- storage: per workspace, visible to its members (RLS) ----

  async list(userId: string, workspaceId: string, extensionId: string, collection: string): Promise<ExtensionRecord[]> {
    this.requireStorage(extensionId, workspaceId);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.extensionRecord.findMany({ where: { workspaceId, extensionId, collection }, orderBy: { key: "asc" }, take: MAX_RECORDS_PER_EXTENSION });
      return rows.map(toRecord);
    });
  }

  async put(userId: string, workspaceId: string, extensionId: string, collection: string, key: string, data: unknown): Promise<ExtensionRecord> {
    this.requireStorage(extensionId, workspaceId);
    if (data === undefined) throw new BadRequestException("data обязательно");
    const size = Buffer.byteLength(JSON.stringify(data), "utf8");
    if (size > MAX_RECORD_BYTES) throw new BadRequestException(`Запись больше ${MAX_RECORD_BYTES / 1024} КБ — храните в ней только нужное`);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const exists = await tx.extensionRecord.findUnique({ where: { workspaceId_extensionId_collection_key: { workspaceId, extensionId, collection, key } }, select: { id: true } });
      if (!exists && (await tx.extensionRecord.count({ where: { workspaceId, extensionId } })) >= MAX_RECORDS_PER_EXTENSION) {
        throw new ConflictException({ code: "extension_storage_full", message: `У расширения уже ${MAX_RECORDS_PER_EXTENSION} записей в этом пространстве` });
      }
      const json = data as Prisma.InputJsonValue;
      const row = await tx.extensionRecord.upsert({
        where: { workspaceId_extensionId_collection_key: { workspaceId, extensionId, collection, key } },
        create: { workspaceId, extensionId, collection, key, data: json },
        update: { data: json }
      });
      return toRecord(row);
    });
  }

  async remove(userId: string, workspaceId: string, extensionId: string, collection: string, key: string): Promise<void> {
    this.requireStorage(extensionId, workspaceId);
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await tx.extensionRecord.deleteMany({ where: { workspaceId, extensionId, collection, key } });
    });
  }

  // ---- secrets: per user, never returned ----

  async secrets(userId: string, extensionId: string): Promise<ExtensionSecretStatus[]> {
    const manifest = this.extensions.requireActive(extensionId);
    const rows = await this.prisma.withUser(userId, (tx) =>
      tx.extensionSecret.findMany({ where: { userId, extensionId }, select: { name: true, updatedAt: true } })
    );
    return manifest.permissions.secrets.map((name) => {
      const row = rows.find((item) => item.name === name);
      return { name, set: Boolean(row), updatedAt: row ? row.updatedAt.toISOString() : null };
    });
  }

  async setSecret(userId: string, extensionId: string, name: string, value: string): Promise<ExtensionSecretStatus> {
    this.requireSecretName(extensionId, name);
    const valueEnc = sealSecret(value);
    const row = await this.prisma.withUser(userId, (tx) =>
      tx.extensionSecret.upsert({
        where: { userId_extensionId_name: { userId, extensionId, name } },
        create: { userId, extensionId, name, valueEnc },
        update: { valueEnc }
      })
    );
    return { name, set: true, updatedAt: row.updatedAt.toISOString() };
  }

  async clearSecret(userId: string, extensionId: string, name: string): Promise<void> {
    this.requireSecretName(extensionId, name);
    await this.prisma.withUser(userId, (tx) => tx.extensionSecret.deleteMany({ where: { userId, extensionId, name } }));
  }

  // ---- network: https to declared hosts, secrets substituted here ----

  async fetch(userId: string, workspaceId: string, extensionId: string, raw: ExtensionFetchInput): Promise<ExtensionFetchResult> {
    const manifest = this.extensions.requireActive(extensionId, workspaceId);
    const input = extensionFetchInputSchema.parse(raw);
    await this.workspaces.assertMember(userId, workspaceId);
    const url = new URL(input.url);
    if (url.protocol !== "https:") throw new BadRequestException("Расширение может обращаться только по https");
    if (url.username || url.password) throw new BadRequestException("Логин и пароль в адресе не допускаются — используйте секрет в заголовке");
    if (!manifest.permissions.network.includes(url.hostname.toLowerCase())) {
      throw new ForbiddenException({ code: "extension_host_not_allowed", message: `Хост ${url.hostname} не объявлен в permissions.network расширения` });
    }

    const used = new Set<string>();
    for (const value of Object.values(input.headers)) for (const match of value.matchAll(SECRET_REF)) used.add(match[1]);
    const values = new Map<string, string>();
    if (used.size > 0) {
      for (const name of used) {
        if (!manifest.permissions.secrets.includes(name)) throw new ForbiddenException({ code: "extension_secret_not_declared", message: `Секрет ${name} не объявлен в манифесте` });
      }
      const rows = await this.prisma.withUser(userId, (tx) => tx.extensionSecret.findMany({ where: { userId, extensionId, name: { in: [...used] } } }));
      for (const row of rows) values.set(row.name, openSecret(row.valueEnc));
      const missing = [...used].filter((name) => !values.has(name));
      if (missing.length > 0) throw new ConflictException({ code: "extension_secret_missing", message: `Не задан секрет: ${missing.join(", ")}` });
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers)) {
      if (FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())) throw new BadRequestException(`Заголовок ${name} задаёт сервер`);
      headers[name] = value.replace(SECRET_REF, (_all, secret: string) => values.get(secret) ?? "");
    }

    // Network last: every check above is local, so a refusal never depends on DNS.
    await assertPublicRemoteUrl(url.toString(), "Адрес расширения");
    let response;
    try {
      response = await requestPublic(url.toString(), { method: input.method, headers, body: input.body, maxBytes: MAX_FETCH_BYTES, label: url.hostname });
    } catch (error) {
      throw new ConflictException({ code: "extension_fetch_failed", message: (error as Error).message });
    }
    const safeHeaders: Record<string, string> = {};
    for (const name of RESPONSE_HEADERS) if (response.headers[name] !== undefined) safeHeaders[name] = response.headers[name];
    return { status: response.status, headers: safeHeaders, body: response.body };
  }

  private requireStorage(extensionId: string, workspaceId: string): ExtensionManifest {
    const manifest = this.extensions.requireActive(extensionId, workspaceId);
    if (!manifest.permissions.storage) throw new ForbiddenException({ code: "extension_storage_not_declared", message: "Расширение не объявило permissions.storage" });
    return manifest;
  }

  private requireSecretName(extensionId: string, name: string): void {
    const manifest = this.extensions.requireActive(extensionId);
    if (!manifest.permissions.secrets.includes(name)) throw new NotFoundException(`Секрет ${name} не объявлен в манифесте расширения`);
  }
}

function toRecord(row: { collection: string; key: string; data: Prisma.JsonValue; createdAt: Date; updatedAt: Date }): ExtensionRecord {
  return { collection: row.collection, key: row.key, data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
