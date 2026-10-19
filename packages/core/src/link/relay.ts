import {
  SYNC_PROTOCOL_VERSION,
  type PushSyncOpsInput,
  type PushSyncOpsResult,
  type RegisterSyncDeviceInput,
  type ReplicaPull,
  type ReplicaSnapshot
} from "@orion/shared-types";
import type { SyncTransport } from "../sync/replica-types";
import {
  LINK_VERSION,
  PacketError,
  decryptPacket,
  encryptPacket,
  type LinkKey,
  type PacketContext,
  type PacketHeader
} from "./packet-codec";
import type { PacketTransport } from "./packet-transport";

/**
 * ADR-0020 §1: мост «запрос–ответ поверх ящика». Клиентская сторона реализует тот же `SyncTransport`, что и
 * `apiSyncTransport`, поэтому `ReplicaEngine` не меняется; узловая сторона (`RelayIngress`) вызывает ТОТ ЖЕ
 * узел (в проде — `HybridSyncService`), так что слияние, права и идемпотентность не дублируются.
 *
 * Раскладка: `orion-link/v1/<ws>/<epoch>/up/<device>/<n>.pkt` — запрос; `.../down/<device>/<n>.pkt` — ответ с тем же n.
 * Если ответ не дождались, вызов падает сетевой ошибкой: движок оставит операции в очереди и повторит —
 * повтор безопасен (`opId`), узел вернёт `duplicate`.
 */

export type LinkMethod = "registerDevice" | "snapshot" | "pull" | "push";

interface RequestBody {
  method: LinkMethod;
  args: unknown;
}
type ResponseBody =
  | { ok: true; value: unknown }
  | { ok: false; status: number; code?: string; message: string };

/** Файл-манифест: тело не поместилось в один пакет, части `<n>.cNNNN.pkt` лежат рядом, манифест пишется последним. */
interface Manifest {
  chunked: { total: number; bytes: number; sha256: string };
}

/** Размер одной части (до шифрования). Снимок пространства и большие пачки операций режутся на такие части. */
export const DEFAULT_CHUNK_BYTES = 512 * 1024;
/** Сколько последних ответов клиент оставляет в ящике (по ним же восстанавливается следующий номер запроса). */
const KEEP_RESPONSES = 20;

const pad = (n: number) => String(n).padStart(12, "0");
const chunkName = (seq: number, i: number) => `${pad(seq)}.c${String(i).padStart(4, "0")}.pkt`;
const isChunkFile = (name: string) => /\.c\d{4}\.pkt$/.test(name);
const root = (ws: string, epoch: number) => `orion-link/v1/${ws}/${epoch}`;
const upDir = (ws: string, epoch: number, device: string) => `${root(ws, epoch)}/up/${device}`;
const downDir = (ws: string, epoch: number, device: string) => `${root(ws, epoch)}/down/${device}`;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as Parameters<typeof globalThis.crypto.subtle.digest>[1])
  );
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Пишет тело как один пакет или, если оно больше `chunkBytes`, как части + манифест последним. */
async function writeBody(
  box: PacketTransport,
  dir: string,
  header: PacketHeader,
  body: unknown,
  key: LinkKey,
  chunkBytes: number
): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(body));
  if (payload.length <= chunkBytes) {
    await box.put(`${dir}/${pad(header.seq)}.pkt`, await encryptPacket(header, body, key));
    return;
  }
  const total = Math.ceil(payload.length / chunkBytes);
  for (let i = 0; i < total; i += 1) {
    const part = payload.subarray(i * chunkBytes, (i + 1) * chunkBytes);
    await box.put(`${dir}/${chunkName(header.seq, i)}`, await encryptPacket(header, { i, data: toBase64(part) }, key));
  }
  const manifest: Manifest = { chunked: { total, bytes: payload.length, sha256: await sha256Hex(payload) } };
  await box.put(`${dir}/${pad(header.seq)}.pkt`, await encryptPacket(header, manifest, key));
}

/**
 * Читает тело, записанное `writeBody`. `null` — файла или каких-то частей ещё не видно (повторим позже);
 * `PacketError` — файл виден, но испорчен/чужой.
 */
async function readBody<T>(
  box: PacketTransport,
  dir: string,
  seq: number,
  context: PacketContext
): Promise<{ header: PacketHeader; body: T } | null> {
  const raw = await box.get(`${dir}/${pad(seq)}.pkt`);
  if (!raw) return null;
  const first = await decryptPacket<T | Manifest>(raw, context);
  if (first.header.seq !== seq) throw new PacketError("wrong_context", "Пакет не на своём месте");
  const meta = (first.body as Partial<Manifest> | null)?.chunked;
  if (!meta) return first as { header: PacketHeader; body: T };
  const parts: Uint8Array[] = [];
  for (let i = 0; i < meta.total; i += 1) {
    const part = await box.get(`${dir}/${chunkName(seq, i)}`);
    if (!part) return null;
    const { header, body } = await decryptPacket<{ i: number; data: string }>(part, context);
    if (header.seq !== seq || body.i !== i) throw new PacketError("wrong_context", "Часть не на своём месте");
    parts.push(fromBase64(body.data));
  }
  const joined = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let off = 0;
  for (const x of parts) {
    joined.set(x, off);
    off += x.length;
  }
  if (joined.length !== meta.bytes || (await sha256Hex(joined)) !== meta.sha256) {
    throw new PacketError("corrupt", "Собранное тело не совпало по размеру/хэшу");
  }
  return { header: first.header, body: JSON.parse(new TextDecoder().decode(joined)) as T };
}

export interface RelayConfig {
  box: PacketTransport;
  workspaceId: string;
  epoch: number;
  /** Первым идёт ключ, которым шифруем; остальные — только чтение (ротация). */
  keys: LinkKey[];
}

export interface RelayClientOptions extends RelayConfig {
  deviceId: string;
  /** Сколько раз проверить ответ, прежде чем сдаться. */
  maxPolls?: number;
  /** Порог разбиения запроса на части (по умолчанию `DEFAULT_CHUNK_BYTES`). */
  chunkBytes?: number;
  /** Пауза между проверками; в тестах — прогон `RelayIngress.pollOnce()`. */
  wait?: (attempt: number) => Promise<void>;
  now?: () => Date;
}

export class RelayNodeTransport implements SyncTransport {
  private nextSeq: number | null = null;
  /** Пакеты, отброшенные как повреждённые (диагностика для UI «Link»). */
  readonly rejected: PacketError[] = [];

  constructor(private readonly options: RelayClientOptions) {}

  registerDevice(input: RegisterSyncDeviceInput): Promise<void> {
    return this.call<void>("registerDevice", input);
  }
  snapshot(workspaceId: string): Promise<ReplicaSnapshot> {
    return this.call("snapshot", { workspaceId });
  }
  pull(workspaceId: string, cursor: string): Promise<ReplicaPull> {
    return this.call("pull", { workspaceId, cursor });
  }
  push(workspaceId: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult> {
    return this.call("push", { workspaceId, input });
  }

  private context(): PacketContext {
    return { workspaceId: this.options.workspaceId, epoch: this.options.epoch, keys: this.options.keys };
  }

  private async allocateSeq(): Promise<number> {
    if (this.nextSeq === null) {
      const { box, workspaceId, epoch, deviceId } = this.options;
      const names = await box.list(upDir(workspaceId, epoch, deviceId));
      const downs = await box.list(downDir(workspaceId, epoch, deviceId));
      const used = [...names, ...downs].map((n) => Number.parseInt(n, 10)).filter(Number.isFinite);
      this.nextSeq = (used.length ? Math.max(...used) : 0) + 1;
    }
    return this.nextSeq++;
  }

  private async call<T>(method: LinkMethod, args: unknown): Promise<T> {
    const { box, workspaceId, epoch, deviceId, keys } = this.options;
    const seq = await this.allocateSeq();
    const header: PacketHeader = {
      linkVersion: LINK_VERSION,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      workspaceId,
      epoch,
      sourceDeviceId: deviceId,
      kind: "request",
      seq,
      keyId: keys[0]!.keyId,
      createdAt: (this.options.now?.() ?? new Date()).toISOString()
    };
    await writeBody(
      box,
      upDir(workspaceId, epoch, deviceId),
      header,
      { method, args } satisfies RequestBody,
      keys[0]!,
      this.options.chunkBytes ?? DEFAULT_CHUNK_BYTES
    );

    const maxPolls = this.options.maxPolls ?? 20;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await this.options.wait?.(attempt);
      try {
        const answer = await readBody<ResponseBody>(box, downDir(workspaceId, epoch, deviceId), seq, this.context());
        if (!answer) continue;
        if (answer.header.kind !== "response") throw new PacketError("wrong_context", "Ответ на другой запрос");
        void this.prune(seq);
        if (answer.body.ok) return answer.body.value as T;
        throw Object.assign(new Error(answer.body.message), {
          status: answer.body.status,
          details: answer.body.code ? { code: answer.body.code } : undefined
        });
      } catch (error) {
        if (error instanceof PacketError) {
          // Усечённый/испорченный файл: не трогаем копию, ждём, что провайдер доотдаст целый.
          this.rejected.push(error);
          continue;
        }
        throw error;
      }
    }
    throw new TypeError("Узел не ответил через ящик Link");
  }

  /** Удаляет старые ответы (и их части), оставляя последние `KEEP_RESPONSES`. Сбой очистки не важен. */
  private async prune(seq: number): Promise<void> {
    const { box, workspaceId, epoch, deviceId } = this.options;
    const limit = seq - KEEP_RESPONSES;
    if (limit < 1) return;
    try {
      const dir = downDir(workspaceId, epoch, deviceId);
      for (const name of await box.list(dir)) {
        const n = Number.parseInt(name, 10);
        if (Number.isFinite(n) && n <= limit) await box.remove(`${dir}/${name}`);
      }
    } catch {
      /* ящик недоступен — уберём при следующем вызове */
    }
  }
}

export interface RelayIngressOptions extends RelayConfig {
  /**
   * Авторитетный узел: ровно тот интерфейс, которым пользуется клиент по LAN. Функция выбирает узел по
   * Link-устройству (в API — привязка к пользователю); `null` = устройство не спарено/отозвано → 403.
   */
  host: SyncTransport | ((linkDeviceId: string) => Promise<SyncTransport | null>);
  /** Порог разбиения ответа на части (по умолчанию `DEFAULT_CHUNK_BYTES`). */
  chunkBytes?: number;
  now?: () => Date;
}

export class RelayIngress {
  readonly rejected: PacketError[] = [];

  constructor(private readonly options: RelayIngressOptions) {}

  /** Обрабатывает все ожидающие запросы; возвращает число обработанных. */
  async pollOnce(): Promise<number> {
    const { box, workspaceId, epoch } = this.options;
    let handled = 0;
    for (const device of await box.list(`${root(workspaceId, epoch)}/up`)) {
      for (const name of await box.list(upDir(workspaceId, epoch, device))) {
        if (!isChunkFile(name) && (await this.handle(device, name))) handled += 1;
      }
    }
    return handled;
  }

  private async handle(device: string, name: string): Promise<boolean> {
    const { box, workspaceId, epoch, keys, host } = this.options;
    const dir = upDir(workspaceId, epoch, device);
    const seq = Number.parseInt(name, 10);
    if (!Number.isFinite(seq)) return false;
    // Ответ уже есть (узел упал между ответом и очисткой): запрос повторно не исполняем.
    if ((await box.list(downDir(workspaceId, epoch, device))).includes(name)) {
      await this.cleanup(dir, seq);
      return false;
    }
    let request: { header: PacketHeader; body: RequestBody } | null;
    try {
      request = await readBody<RequestBody>(box, dir, seq, { workspaceId, epoch, keys });
      if (request && (request.header.kind !== "request" || request.header.sourceDeviceId !== device)) {
        throw new PacketError("wrong_context", "Пакет не от этого устройства");
      }
    } catch (error) {
      if (!(error instanceof PacketError)) throw error;
      // Возможно, усечён при чтении — оставляем на месте, клиент/узел увидят целый файл позже.
      this.rejected.push(error);
      return false;
    }
    if (!request) return false;
    // Отвечаем ключом запроса: устройство со старым ключом (до ротации) иначе не прочитало бы ответ.
    const answerKey = keys.find((k) => k.keyId === request.header.keyId) ?? keys[0]!;
    const node = typeof host === "function" ? await host(device) : host;
    const response: ResponseBody = node
      ? await this.execute(request.body, node)
      : { ok: false, status: 403, code: "device_revoked", message: "Устройство Link не спарено или отозвано" };
    const header: PacketHeader = {
      linkVersion: LINK_VERSION,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      workspaceId,
      epoch,
      sourceDeviceId: "node",
      kind: "response",
      seq,
      keyId: answerKey.keyId,
      createdAt: (this.options.now?.() ?? new Date()).toISOString()
    };
    // Манифест/единственный файл пишется последним: пока его нет, клиент ответа не видит.
    await writeBody(box, downDir(workspaceId, epoch, device), header, response, answerKey, this.options.chunkBytes ?? DEFAULT_CHUNK_BYTES);
    await this.cleanup(dir, seq);
    return true;
  }

  /** Убирает запрос и его части. */
  private async cleanup(dir: string, seq: number): Promise<void> {
    const { box } = this.options;
    for (const file of await box.list(dir)) {
      if (Number.parseInt(file, 10) === seq) await box.remove(`${dir}/${file}`);
    }
  }

  private async execute(request: RequestBody, host: SyncTransport): Promise<ResponseBody> {
    try {
      const args = request.args as Record<string, never>;
      switch (request.method) {
        case "registerDevice":
          await host.registerDevice(request.args as RegisterSyncDeviceInput);
          return { ok: true, value: null };
        case "snapshot":
          return { ok: true, value: await host.snapshot(args.workspaceId as string) };
        case "pull":
          return { ok: true, value: await host.pull(args.workspaceId as string, args.cursor as string) };
        case "push":
          return { ok: true, value: await host.push(args.workspaceId as string, args.input as PushSyncOpsInput) };
        default:
          return { ok: false, status: 400, code: "unknown_method", message: "Неизвестный метод" };
      }
    } catch (error) {
      const e = error as { status?: number; details?: { code?: string }; message?: string };
      return {
        ok: false,
        status: typeof e.status === "number" ? e.status : 500,
        code: e.details?.code,
        message: e.message ?? "Ошибка узла"
      };
    }
  }
}
