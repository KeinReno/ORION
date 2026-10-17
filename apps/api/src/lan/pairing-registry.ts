import { randomBytes, randomUUID } from "node:crypto";
import type { LanPairStatus, LanPendingPair } from "@orion/shared-types";
import type { DeviceStore } from "./device-store";
import { codesEqual, computePairingCode } from "./pairing-code";

export const PAIR_TTL_MS = 2 * 60_000;
export const PAIR_MAX_ATTEMPTS = 3;
const MAX_PENDING = 5;
const MAX_PER_ADDRESS_PER_MINUTE = 3;

interface PairRequest {
  id: string;
  deviceName: string;
  address: string;
  clientNonce: string;
  serverNonce: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
  state: "pending" | "approved" | "denied";
  /** Токен хранится лишь до первого опроса клиентом. */
  token: string | null;
}

export class PairingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

/**
 * Заявки на подключение живут только в памяти: срок 2 минуты, перезапуск хоста их отменяет, и в БД
 * не остаётся ни кодов, ни имён неподтверждённых устройств. До подтверждения заявка не даёт доступа ни к чему.
 */
export class PairingRegistry {
  private readonly requests = new Map<string, PairRequest>();
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly devices: DeviceStore,
    private readonly fingerprint: () => string,
    private readonly now: () => number = Date.now
  ) {}

  private sweep(): void {
    const t = this.now();
    for (const [id, request] of this.requests) {
      // Подтверждённую заявку с невыданным токеном держим чуть дольше TTL: клиент мог не успеть опросить.
      if (t > request.expiresAt + 60_000) this.requests.delete(id);
    }
  }

  create(input: { deviceName: string; clientNonce: string; address: string }): { requestId: string; serverNonce: string; expiresAt: string } {
    this.sweep();
    const t = this.now();
    const recent = (this.recent.get(input.address) ?? []).filter((at) => t - at < 60_000);
    if (recent.length >= MAX_PER_ADDRESS_PER_MINUTE) throw new PairingError(429, "Слишком много заявок с этого устройства. Подождите минуту.", "pair_rate_limited");
    const pending = [...this.requests.values()].filter((request) => request.state === "pending" && t <= request.expiresAt);
    if (pending.length >= MAX_PENDING) throw new PairingError(429, "На узле уже ждут подтверждения несколько заявок. Попробуйте позже.", "pair_queue_full");
    recent.push(t);
    this.recent.set(input.address, recent);

    const serverNonce = randomBytes(16).toString("base64url");
    const request: PairRequest = {
      id: randomUUID(),
      deviceName: input.deviceName,
      address: input.address,
      clientNonce: input.clientNonce,
      serverNonce,
      code: computePairingCode(input.clientNonce, serverNonce, this.fingerprint()),
      createdAt: t,
      expiresAt: t + PAIR_TTL_MS,
      attemptsLeft: PAIR_MAX_ATTEMPTS,
      state: "pending",
      token: null
    };
    this.requests.set(request.id, request);
    return { requestId: request.id, serverNonce, expiresAt: new Date(request.expiresAt).toISOString() };
  }

  /** Опрос клиентом. Секрет опроса — его же clientNonce: чужой, знающий лишь requestId, токен не получит. */
  poll(id: string, clientNonce: string | undefined): LanPairStatus {
    const request = this.requests.get(id);
    if (!request || !clientNonce || !codesEqual(request.clientNonce, clientNonce)) return { status: "expired", deviceToken: null };
    if (request.state === "approved" && request.token) {
      const token = request.token;
      this.requests.delete(id);
      return { status: "approved", deviceToken: token };
    }
    if (request.state === "denied") {
      this.requests.delete(id);
      return { status: "denied", deviceToken: null };
    }
    if (this.now() > request.expiresAt) {
      this.requests.delete(id);
      return { status: "expired", deviceToken: null };
    }
    return { status: "pending", deviceToken: null };
  }

  listPending(): LanPendingPair[] {
    this.sweep();
    const t = this.now();
    return [...this.requests.values()]
      .filter((request) => request.state === "pending" && t <= request.expiresAt)
      .map((request) => ({
        id: request.id,
        deviceName: request.deviceName,
        address: request.address,
        createdAt: new Date(request.createdAt).toISOString(),
        expiresAt: new Date(request.expiresAt).toISOString(),
        attemptsLeft: request.attemptsLeft
      }));
  }

  /** Владелец вводит код с экрана клиента. Три неверных ввода — заявка закрывается, клиенту придётся начать заново. */
  approve(id: string, code: string): void {
    const request = this.requests.get(id);
    if (!request || request.state !== "pending" || this.now() > request.expiresAt) {
      throw new PairingError(404, "Заявка не найдена или истекла", "pair_not_found");
    }
    if (!codesEqual(request.code, code)) {
      request.attemptsLeft -= 1;
      if (request.attemptsLeft <= 0) {
        request.state = "denied";
        throw new PairingError(409, "Код не совпал трижды — заявка закрыта. Если вы не ожидали её, возможно, в сети посторонний.", "pair_locked");
      }
      throw new PairingError(400, `Код не совпал. Осталось попыток: ${request.attemptsLeft}`, "pair_code_mismatch");
    }
    const created = this.devices.create(request.deviceName, request.address);
    request.state = "approved";
    request.token = created.token;
  }

  deny(id: string): void {
    const request = this.requests.get(id);
    if (!request || request.state !== "pending") throw new PairingError(404, "Заявка не найдена", "pair_not_found");
    request.state = "denied";
  }
}
