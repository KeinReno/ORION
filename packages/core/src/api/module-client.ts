import type { z } from "zod";

/** Всё, что нужно клиенту модуля от `ApiClient`: типизированный запрос с ретраем по 401 (G5/G24). */
export interface ModuleRequester {
  extensionRequest<T>(method: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
}

/**
 * G24 — клиент модуля, подключённого манифестом. Модуль получает методы `get/post/patch/put/delete` с префиксом
 * своего маршрута и схемой ответа, поэтому ни `ApiClient`, ни `@orion/core-react` не растут методом на ресурс.
 * Ретрай по 401, разбор ошибок и проверка ответа схемой — те же, что у остальных методов `ApiClient`.
 */
export interface ModuleClient {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  patch<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  delete<T>(path: string, schema: z.ZodType<T>): Promise<T>;
}

export function createModuleClient(api: ModuleRequester, basePath: string): ModuleClient {
  const url = (path: string) => `${basePath}${path}`;
  return {
    get: (path, schema) => api.extensionRequest("GET", url(path), undefined, schema),
    post: (path, body, schema) => api.extensionRequest("POST", url(path), body, schema),
    put: (path, body, schema) => api.extensionRequest("PUT", url(path), body, schema),
    patch: (path, body, schema) => api.extensionRequest("PATCH", url(path), body, schema),
    delete: (path, schema) => api.extensionRequest("DELETE", url(path), undefined, schema)
  };
}

/** Корень маршрутов модуля внутри пространства: `/workspaces/:id/<модуль>`. */
export function workspaceModuleBase(workspaceId: string, moduleRoute: string): string {
  return `/workspaces/${workspaceId}/${moduleRoute}`;
}
