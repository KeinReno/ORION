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

const pad = (n: number) => String(n).padStart(12, "0");
const root = (ws: string, epoch: number) => `orion-link/v1/${ws}/${epoch}`;
const upDir = (ws: string, epoch: number, device: string) => `${root(ws, epoch)}/up/${device}`;
const downDir = (ws: string, epoch: number, device: string) => `${root(ws, epoch)}/down/${device}`;

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
    const bytes = await encryptPacket(header, { method, args } satisfies RequestBody, keys[0]!);
    await box.put(`${upDir(workspaceId, epoch, deviceId)}/${pad(seq)}.pkt`, bytes);

    const maxPolls = this.options.maxPolls ?? 20;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await this.options.wait?.(attempt);
      const answer = await box.get(`${downDir(workspaceId, epoch, deviceId)}/${pad(seq)}.pkt`);
      if (!answer) continue;
      try {
        const { header: h, body } = await decryptPacket<ResponseBody>(answer, this.context());
        if (h.kind !== "response" || h.seq !== seq) throw new PacketError("wrong_context", "Ответ на другой запрос");
        if (body.ok) return body.value as T;
        throw Object.assign(new Error(body.message), {
          status: body.status,
          details: body.code ? { code: body.code } : undefined
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
}

export interface RelayIngressOptions extends RelayConfig {
  /**
   * Авторитетный узел: ровно тот интерфейс, которым пользуется клиент по LAN. Функция выбирает узел по
   * Link-устройству (в API — привязка к пользователю); `null` = устройство не спарено/отозвано → 403.
   */
  host: SyncTransport | ((linkDeviceId: string) => Promise<SyncTransport | null>);
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
        if (await this.handle(device, name)) handled += 1;
      }
    }
    return handled;
  }

  private async handle(device: string, name: string): Promise<boolean> {
    const { box, workspaceId, epoch, keys, host } = this.options;
    const upPath = `${upDir(workspaceId, epoch, device)}/${name}`;
    const downPath = `${downDir(workspaceId, epoch, device)}/${name}`;
    // Ответ уже есть (узел упал между ответом и очисткой): запрос повторно не исполняем.
    if ((await box.list(downDir(workspaceId, epoch, device))).includes(name)) {
      await box.remove(upPath);
      return false;
    }
    const bytes = await box.get(upPath);
    if (!bytes) return false;
    let request: { header: PacketHeader; body: RequestBody };
    try {
      request = await decryptPacket<RequestBody>(bytes, { workspaceId, epoch, keys });
      if (request.header.kind !== "request" || request.header.sourceDeviceId !== device) {
        throw new PacketError("wrong_context", "Пакет не от этого устройства");
      }
    } catch (error) {
      if (!(error instanceof PacketError)) throw error;
      // Возможно, усечён при чтении — оставляем на месте, клиент/узел увидят целый файл позже.
      this.rejected.push(error);
      return false;
    }
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
      seq: request.header.seq,
      keyId: keys[0]!.keyId,
      createdAt: (this.options.now?.() ?? new Date()).toISOString()
    };
    await box.put(downPath, await encryptPacket(header, response, keys[0]!));
    await box.remove(upPath);
    return true;
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
