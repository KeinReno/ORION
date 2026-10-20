"use client";

import { useCore, useExtensions, useSession } from "@orion/core-react";
import type { ExtensionsState } from "@orion/shared-types";
import { useEffect, useState, useSyncExternalStore } from "react";
import { readNodeMark } from "../../node-mode";
import type { ApiClient } from "@orion/core";
import { createExtensionRuntime, type ExtensionLoadState, type ExtensionModule, type ExtensionServices } from "./loader";
import { installSdk } from "./sdk";

/** ApiClient of this window, set by `RuntimeExtensions` once the core is up (the runtime itself is created at import). */
let apiClient: ApiClient | null = null;

function servicesFor(extensionId: string): ExtensionServices {
  const api = (): ApiClient => {
    if (!apiClient) throw new Error("ORION ещё не готов");
    return apiClient;
  };
  return {
    storage: {
      list: (workspaceId, collection) => api().listExtensionRecords(workspaceId, extensionId, collection),
      get: async (workspaceId, collection, key) => (await api().listExtensionRecords(workspaceId, extensionId, collection)).find((record) => record.key === key),
      put: (workspaceId, collection, key, data) => api().putExtensionRecord(workspaceId, extensionId, collection, key, data),
      remove: (workspaceId, collection, key) => api().deleteExtensionRecord(workspaceId, extensionId, collection, key)
    },
    secrets: {
      status: () => api().getExtensionSecrets(extensionId),
      set: (name, value) => api().setExtensionSecret(extensionId, name, value),
      clear: (name) => api().clearExtensionSecret(extensionId, name)
    },
    fetch: (workspaceId, input) => api().extensionFetch(workspaceId, extensionId, input)
  };
}

/** Один на окно: загруженные расширения живут, пока живёт страница. */
export const extensionRuntime = createExtensionRuntime(
  // webpackIgnore: the URL is only known at run time and must be loaded by the browser as is, not bundled.
  (url) => import(/* webpackIgnore: true */ url) as Promise<ExtensionModule>,
  servicesFor
);

/** Пока у какого-то расширения включён режим разработчика — правка файла видна через ~2 с; иначе опрос редкий. */
function pollInterval(state: ExtensionsState | undefined): number {
  return state?.items.some((item) => item.devMode && item.status === "approved") ? 2_000 : 15_000;
}

/**
 * Загружает подтверждённые расширения из папки в это окно (ADR-0022, E2) и держит их в соответствии с сервером: новое —
 * загружает, выключенное или удалённое — снимает, изменившееся — перезагружает. В режиме клиента LAN не делает ничего
 * (решение владельца: расширения хоста на клиентах не загружаются). Ничего не рисует.
 */
export function RuntimeExtensions(): null {
  const { user } = useSession();
  const { api } = useCore();
  apiClient = api;
  const [clientMode] = useState(() => readNodeMark() !== null);
  const active = Boolean(user) && !clientMode;
  const extensions = useExtensions({ enabled: active, pollMs: pollInterval });
  const data = extensions.data;

  useEffect(() => {
    if (!active) {
      void extensionRuntime.sync([]);
      return;
    }
    if (!data) return;
    installSdk();
    const desired = data.available
      ? data.items.flatMap((item) => (item.status === "approved" && item.entryPath ? [{ id: item.id, url: api.extensionEntryUrl(item.entryPath) }] : []))
      : [];
    void extensionRuntime.sync(desired);
  }, [active, data, api]);

  return null;
}

/** Как загрузилось расширение в этом окне — для раздела «Расширения» в настройках. */
export function useExtensionLoadState(id: string): ExtensionLoadState | undefined {
  useSyncExternalStore(extensionRuntime.subscribe, extensionRuntime.version, extensionRuntime.version);
  return extensionRuntime.state(id);
}
