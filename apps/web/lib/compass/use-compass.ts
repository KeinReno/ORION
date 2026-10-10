"use client";

import { useCore } from "@orion/core-react";
import { useEffect, useMemo } from "react";
import { clearCompassTransport, setCompassTransport } from "./api";

/**
 * Подключает типизированный клиент Compass (`api` из ./api) к прокси ORION для активного пространства.
 * Подключение выполняется прямо при рендере, а не в эффекте: эффекты дочерних компонентов (первые запросы) срабатывают
 * раньше эффекта родителя и иначе застали бы клиент неподключённым. Отключение — только своё: при переключении вкладок
 * новый шлюз подключается раньше, чем размонтируется старый. Запросы идут через авторизованный ApiClient
 * (обновление токена, членство, модуль).
 */
export function useCompassBinding(workspaceId: string | undefined): void {
  const { api } = useCore();
  const transport = useMemo(
    () => (workspaceId ? (method: string, path: string, body: unknown) => api.compassRequest(workspaceId, method, path, body) : null),
    [api, workspaceId]
  );
  if (transport) setCompassTransport(transport);
  useEffect(() => {
    if (!transport) return;
    // Повторно: в режиме разработки React сразу после монтирования прогоняет очистку и эффект ещё раз.
    setCompassTransport(transport);
    return () => clearCompassTransport(transport);
  }, [transport]);
}
