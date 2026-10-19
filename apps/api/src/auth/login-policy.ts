import { loadNodeConfig } from "../lan/node-config";
import { resolveMode } from "../common/orion-mode";

/**
 * Политика входа (ADR-0015, дополнение). «Хост LAN» реализован как серверный режим, а серверные защиты рассчитаны на узел,
 * к которому может подключиться кто угодно: PIN, список аккаунтов и короткие пароли запрещены. Но у хоста LAN есть собственный
 * барьер — до экрана входа доходят только устройства, сопряжённые кодом из 6 цифр. Поэтому для дома есть «домашняя» политика:
 *
 * - `local`  — «Локальный» режим, всё как раньше (PIN, список аккаунтов);
 * - `home`   — хост LAN с домашней политикой: PIN и список аккаунтов разрешены (только сопряжённым устройствам), пароль от 8
 *              символов, взамен — блокировка аккаунта после серии неверных попыток;
 * - `strict` — серверный режим / хост LAN со строгой политикой: PIN и список запрещены, пароль не короче 12 или сложный.
 */
export type LoginPolicy = "local" | "home" | "strict";

export function resolveLoginPolicy(env: NodeJS.ProcessEnv = process.env): LoginPolicy {
  if (resolveMode() !== "server") return "local";
  if (env.ORION_LAN_HOST === "1" && loadNodeConfig().loginPolicy === "home") return "home";
  return "strict";
}

export const policyAllowsPin = (policy: LoginPolicy): boolean => policy !== "strict";
export const policyAllowsAccountList = (policy: LoginPolicy): boolean => policy !== "strict";

/** Минимальная оценка пароля (`passwordScore`) для регистрации и смены пароля. */
export function minPasswordScore(policy: LoginPolicy): number {
  return policy === "strict" ? 2 : policy === "home" ? 1 : 0;
}
