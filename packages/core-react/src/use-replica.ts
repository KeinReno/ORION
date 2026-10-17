"use client";

import {
  ReplicaEngine,
  apiSyncTransport,
  type ReplicaStatus,
  type ReplicaStorage
} from "@orion/core";
import type { SyncEntityType, SyncMode, SyncState } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCore } from "./provider";
import { useSession } from "./use-auth";

/** Как часто гибридная копия опрашивает узел, пока приложение открыто (мс). */
export const REPLICA_POLL_MS = 15_000;

let storage: ReplicaStorage | null = null;

/** Подключает хранилище копии (веб/десктоп — IndexedDB). Без него гибридный режим для клиента просто не включается. */
export function setReplicaStorage(next: ReplicaStorage | null): void {
  storage = next;
}

const engines = new Map<string, ReplicaEngine>();
const opening = new WeakMap<ReplicaEngine, Promise<boolean>>();
const drivers = new Map<ReplicaEngine, { count: number; stop: () => void }>();

/** Копия читается с диска один раз на движок — повторный `open()` перезаписал бы живое состояние. */
function ensureOpen(engine: ReplicaEngine): Promise<boolean> {
  let promise = opening.get(engine);
  if (!promise) {
    promise = engine.open();
    opening.set(engine, promise);
  }
  return promise;
}

/** Один опрос узла на движок, сколько бы компонентов ни пользовалось копией; последний ушедший его останавливает. */
function acquireDriver(engine: ReplicaEngine): () => void {
  let driver = drivers.get(engine);
  if (!driver) {
    const run = (): void => void engine.sync();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") run();
    };
    run();
    const timer = setInterval(run, REPLICA_POLL_MS);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    driver = {
      count: 0,
      stop: () => {
        clearInterval(timer);
        window.removeEventListener("online", run);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
    drivers.set(engine, driver);
  }
  driver.count += 1;
  return () => {
    const current = drivers.get(engine);
    if (!current) return;
    current.count -= 1;
    if (current.count <= 0) {
      current.stop();
      drivers.delete(engine);
    }
  };
}
/** Активные движки по пространству: строкам списка нужен доступ без запросов и без userId. */
const activeByWorkspace = new Map<string, ReplicaEngine>();

function engineFor(userId: string, workspaceId: string, userName: string | null, api: ReturnType<typeof useCore>["api"]): ReplicaEngine | null {
  if (!storage) return null;
  const key = `${userId}:${workspaceId}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = new ReplicaEngine({
      transport: apiSyncTransport(api),
      storage,
      userId,
      workspaceId,
      userName,
      deviceName: typeof navigator !== "undefined" ? `Браузер (${navigator.platform || "устройство"})` : "Устройство"
    });
    engines.set(key, engine);
  }
  return engine;
}

const IDLE_STATUS: ReplicaStatus = { hasCopy: false, phase: "idle", asOf: null, pending: 0, conflicts: 0, message: null };

export interface HybridReplica {
  engine: ReplicaEngine;
  /** Копия работает: пространство в гибридном режиме либо копия уже есть на устройстве. */
  active: boolean;
  status: ReplicaStatus;
  mode: SyncMode | undefined;
}

/** Режим синхронизации пространства (кэшируется; офлайн остаётся последнее известное значение). */
export function useSyncMode(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["sync-mode", workspaceId],
    queryFn: () => api.getSyncMode(workspaceId as string),
    enabled: Boolean(workspaceId),
    retry: false,
    staleTime: 60_000
  });
}

/**
 * Локальная копия пространства (ТЗ-06). Возвращает `null`, пока режим не гибридный и копии нет — тогда
 * все хуки модулей работают как раньше (онлайн-запись на узле). Сам запускает синхронизацию: при
 * открытии, по таймеру, при возврате сети и при возвращении на вкладку.
 */
export function useHybridReplica(workspaceId: string | undefined): HybridReplica | null {
  const { api } = useCore();
  const session = useSession();
  const user = session.user ?? session.previousUser ?? null;
  const userId = user?.id;
  const engine = userId && workspaceId ? engineFor(userId, workspaceId, user?.name ?? null, api) : null;
  const modeQuery = useSyncMode(workspaceId);
  const mode = modeQuery.data?.mode;

  const [opened, setOpened] = useState(false);
  useEffect(() => {
    setOpened(false);
    if (!engine) return;
    let cancelled = false;
    void ensureOpen(engine).then(() => {
      if (!cancelled) setOpened(true);
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  const version = useSyncExternalStore(
    (listener) => (engine ? engine.subscribe(listener) : () => undefined),
    () => (engine ? engine.snapshotVersion() : 0),
    () => 0
  );
  void version;

  const hasCopy = Boolean(engine?.hasCopy());
  // Режим выключили на узле — копия больше не нужна.
  useEffect(() => {
    if (engine && opened && mode !== undefined && mode !== "hybrid" && engine.hasCopy()) void engine.wipe();
  }, [engine, opened, mode]);

  const active = Boolean(engine && opened && (mode === "hybrid" || (mode === undefined && hasCopy)));

  useEffect(() => {
    if (!engine || !active || !workspaceId) return;
    activeByWorkspace.set(workspaceId, engine);
    const release = acquireDriver(engine);
    return () => {
      release();
      if (activeByWorkspace.get(workspaceId) === engine) activeByWorkspace.delete(workspaceId);
    };
  }, [engine, active, workspaceId]);

  if (!engine) return null;
  if (!active) return null;
  return { engine, active, status: engine ? engine.status() : IDLE_STATUS, mode };
}

/** Состояние одной записи (`local`/`queued`/`synced`/`conflict`); без копии — `synced`. */
export function useReplicaEntityState(workspaceId: string | undefined, entity: SyncEntityType, id: string): SyncState {
  const engine = workspaceId ? activeByWorkspace.get(workspaceId) ?? null : null;
  useSyncExternalStore(
    (listener) => (engine ? engine.subscribe(listener) : () => undefined),
    () => (engine ? engine.snapshotVersion() : 0),
    () => 0
  );
  return engine ? engine.syncStateOf(entity, id) : "synced";
}

/** Владелец переключает режим пространства; включение гибрида — осознанное действие (ADR-0016 §0). */
export function useSetSyncMode(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: SyncMode) => api.setSyncMode(workspaceId as string, mode),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sync-mode", workspaceId] })
  });
}

export function useSyncDevices(enabled = true) {
  const { api } = useCore();
  return useQuery({ queryKey: ["sync-devices"], queryFn: () => api.listSyncDevices(), enabled, retry: false });
}

export function useRevokeSyncDevice() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => api.revokeSyncDevice(deviceId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sync-devices"] })
  });
}

/**
 * Гибридное пространство (ТЗ-06): данные берутся из локальной копии с очередью поверх неё, а не из
 * запроса к узлу — поэтому работают и офлайн. Форма результата та же, что у `useQuery`.
 */
export function fromReplica<T>(query: UseQueryResult<T>, replica: HybridReplica, data: T): UseQueryResult<T> {
  return {
    ...query,
    data,
    isLoading: !replica.engine.hasCopy(),
    isPending: !replica.engine.hasCopy(),
    isError: false,
    error: null,
    status: "success",
    isSuccess: true,
    refetch: async () => {
      await replica.engine.sync();
      return { ...query, data } as never;
    }
  } as UseQueryResult<T>;
}
