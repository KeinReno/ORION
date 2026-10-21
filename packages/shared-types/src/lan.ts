import { z } from "zod";

/**
 * ТЗ-04 — LAN Host/Client (docs/adr/ADR-0014-lan-host-client.md). Контракт «узла»: режим машины,
 * публичная визитка хоста (без данных), заявка на подключение и доверенные устройства.
 */
export const LAN_PROTOCOL_VERSION = 1;
export const LAN_SERVICE_TYPE = "orion";
export const LAN_DEFAULT_PORT = 4443;
export const LAN_DEVICE_TOKEN_HEADER = "x-orion-device";
export const LAN_PAIR_SECRET_HEADER = "x-orion-pair-secret";

export const lanModeSchema = z.enum(["local", "host", "client"]);
export type LanMode = z.infer<typeof lanModeSchema>;

/** Единственное, что узел показывает без авторизации. Никаких пользователей, пространств и данных. */
export const lanNodeCardSchema = z.object({
  protocol: z.number().int(),
  nodeId: z.string(),
  name: z.string(),
  fingerprint: z.string()
});
export type LanNodeCard = z.infer<typeof lanNodeCardSchema>;

export const lanDiscoveredNodeSchema = lanNodeCardSchema.extend({
  address: z.string(),
  port: z.number().int()
});
export type LanDiscoveredNode = z.infer<typeof lanDiscoveredNodeSchema>;

export const lanPairRequestInputSchema = z.object({
  deviceName: z.string().trim().min(1, "Назовите устройство").max(80),
  /** 16–32 случайных байта в base64url; хранится только у клиента, хост получает его же как секрет опроса. */
  clientNonce: z.string().min(16).max(64)
});
export type LanPairRequestInput = z.infer<typeof lanPairRequestInputSchema>;

export const lanPairRequestCreatedSchema = z.object({
  requestId: z.string(),
  serverNonce: z.string(),
  expiresAt: z.string()
});
export type LanPairRequestCreated = z.infer<typeof lanPairRequestCreatedSchema>;

export const lanPairStatusSchema = z.object({
  status: z.enum(["pending", "approved", "denied", "expired"]),
  /** Выдаётся ровно один раз, при первом опросе после подтверждения. */
  deviceToken: z.string().nullable()
});
export type LanPairStatus = z.infer<typeof lanPairStatusSchema>;

export const lanPendingPairSchema = z.object({
  id: z.string(),
  deviceName: z.string(),
  address: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  attemptsLeft: z.number().int()
});
export type LanPendingPair = z.infer<typeof lanPendingPairSchema>;

export const lanApprovePairInputSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Код — 6 цифр") });
export type LanApprovePairInput = z.infer<typeof lanApprovePairInputSchema>;

export const lanDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  lastAddress: z.string().nullable()
});
export type LanDevice = z.infer<typeof lanDeviceSchema>;

/** Политика входа узла (ADR-0015): `home` — PIN, список аккаунтов и пароли от 8 символов для сопряжённых устройств; `strict` — как у сервера. */
export const lanLoginPolicySchema = z.enum(["home", "strict"]);
export type LanLoginPolicy = z.infer<typeof lanLoginPolicySchema>;

export const lanHostStatusSchema = z.object({
  mode: lanModeSchema,
  nodeId: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  port: z.number().int(),
  addresses: z.array(z.string()),
  /** true — этот процесс API сейчас слушает LAN (режим применён), а не только записан в настройках. */
  active: z.boolean(),
  ownerUserId: z.string().nullable(),
  /** Процесс запущен лаунчером и сам перезапустится при смене режима. */
  supervised: z.boolean(),
  mdns: z.boolean(),
  firewall: z.enum(["unsupported", "missing", "present"]),
  loginPolicy: lanLoginPolicySchema,
  /**
   * Why the host is not working although it is switched on: the LAN port could not be opened (taken by another program)
   * or the API did not start in host mode and the launcher brought it back as «Локальный». `null` — no problem.
   */
  error: z.string().nullable()
});
export type LanHostStatus = z.infer<typeof lanHostStatusSchema>;

export const lanEnableHostInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** Начальные пароли для аккаунтов, которые входили по PIN: в LAN-режиме PIN отключён. userId → пароль. */
  passwords: z.record(z.string().min(1)).default({}),
  /** Владелец подтвердил, что понимает последствия (предупреждение показано). */
  acknowledged: z.literal(true),
  /** Политика входа; по умолчанию домашняя. При `strict` аккаунтам с PIN нужны пароли (`passwords`). */
  loginPolicy: lanLoginPolicySchema.default("home"),
  /** HTTPS-порт хоста в сети; не задан — прежний (по умолчанию 4443). Другой — если этот занят другой программой. */
  port: z.number().int().min(1024).max(65535).optional()
});
export type LanEnableHostInput = z.infer<typeof lanEnableHostInputSchema>;

export const lanPinAccountSchema = z.object({ userId: z.string(), name: z.string() });
export type LanPinAccount = z.infer<typeof lanPinAccountSchema>;

export const lanClientConnectInputSchema = z.object({
  address: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  deviceName: z.string().trim().min(1).max(80)
});
export type LanClientConnectInput = z.infer<typeof lanClientConnectInputSchema>;

export const lanClientPairingSchema = z.object({
  pairingId: z.string(),
  /** Тот же 6-значный код, который владелец хоста вводит у себя. Считается клиентом по реально увиденному сертификату. */
  code: z.string(),
  node: lanNodeCardSchema,
  status: z.enum(["pending", "approved", "denied", "expired", "error"]),
  message: z.string().nullable()
});
export type LanClientPairing = z.infer<typeof lanClientPairingSchema>;

export const lanClientStatusSchema = z.object({
  mode: lanModeSchema,
  paired: z.object({ nodeId: z.string(), name: z.string(), address: z.string(), port: z.number().int(), fingerprint: z.string() }).nullable(),
  /** Состояние связи с хостом (только в режиме client). */
  link: z.enum(["online", "offline", "revoked", "none"]),
  /** Базовый путь API для web-клиента; в режиме client — прокси локального API. */
  apiPath: z.string()
});
export type LanClientStatus = z.infer<typeof lanClientStatusSchema>;

export const LAN_REMOTE_PREFIX = "/_remote";

/** Шестизначный код сопоставления (SAS): оба конца считают его из одних и тех же величин, включая сертификат. */
export function lanPairingCodeInput(clientNonce: string, serverNonce: string, fingerprint: string): string {
  return `orion-pair/v1|${clientNonce}|${serverNonce}|${fingerprint.replace(/:/g, "").toLowerCase()}`;
}

export const lanSetLoginPolicyInputSchema = z.object({
  loginPolicy: lanLoginPolicySchema,
  /** При переходе на `strict`: пароли для аккаунтов с PIN (userId → пароль). */
  passwords: z.record(z.string().min(1)).default({})
});
export type LanSetLoginPolicyInput = z.infer<typeof lanSetLoginPolicyInputSchema>;
