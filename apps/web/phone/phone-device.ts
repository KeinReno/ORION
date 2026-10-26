import { isLoopbackHost } from "../lib/api-base";

/** Токен, который хост выдал этому телефону после кода из 6 цифр. Живёт на адресе узла, не на localhost. */
export const PHONE_DEVICE_TOKEN_KEY = "orion.phone.deviceToken";

export function readPhoneDeviceToken(): string | null {
  try {
    return localStorage.getItem(PHONE_DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writePhoneDeviceToken(token: string): void {
  localStorage.setItem(PHONE_DEVICE_TOKEN_KEY, token);
}

/** Страница открыта с чужого адреса и ещё не подтверждена на компьютере. */
export function phoneNeedsPairing(): boolean {
  if (typeof window === "undefined") return false;
  return !isLoopbackHost(window.location.hostname) && !readPhoneDeviceToken();
}
