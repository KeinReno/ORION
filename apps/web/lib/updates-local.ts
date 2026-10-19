import type { AppUpdateConfig, AppUpdateStatus, SetAppUpdateConfigInput } from "@orion/shared-types";
import { LOCAL_API_BASE_URL } from "./api-base";

/**
 * Обновления программы: запросы к ЛОКАЛЬНОМУ API этой машины (loopback-only на сервере), мимо ApiClient — как `lan-local.ts`.
 * В режиме клиента LAN базовый адрес ApiClient указывает на прокси узла, а обновлять нужно именно этот компьютер.
 * Изменяющие запросы идут как `application/json`: такой запрос из чужой страницы браузер не отправит без проверки CORS.
 */
async function local<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${LOCAL_API_BASE_URL}${path}`, {
    method,
    ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { message?: string }) : undefined;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`);
  return payload as T;
}

export const fetchUpdateStatus = () => local<AppUpdateStatus>("GET", "/updates/status");
export const fetchUpdateConfig = () => local<AppUpdateConfig>("GET", "/updates/config");
export const saveUpdateConfig = (input: SetAppUpdateConfigInput) => local<AppUpdateConfig>("PUT", "/updates/config", input);
export const checkForUpdate = () => local<AppUpdateStatus>("POST", "/updates/check");
export const downloadUpdate = () => local<AppUpdateStatus>("POST", "/updates/download");
export const applyUpdate = () => local<{ started: true }>("POST", "/updates/apply");
