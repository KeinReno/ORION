import type { LanClientStatus } from "@orion/shared-types";
import { LOCAL_API_BASE_URL } from "./api-base";

/**
 * Запросы к ЛОКАЛЬНОМУ API этой машины без входа (loopback-only на сервере): состояние клиента и возврат в «Локальный».
 * Идут мимо ApiClient намеренно — в режиме клиента его базовый адрес указывает на прокси чужого узла,
 * а возврат домой не должен зависеть от того, жив ли узел.
 */
async function local<T>(method: "GET" | "POST" | "DELETE", path: string): Promise<T> {
  const response = await fetch(`${LOCAL_API_BASE_URL}${path}`, { method });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const fetchClientStatus = () => local<LanClientStatus>("GET", "/lan/client/status");
export const deactivateClient = () => local<void>("POST", "/lan/client/deactivate");
export const forgetNodeBinding = () => local<void>("DELETE", "/lan/client/binding");
