"use client";

import { useCompassEngine } from "@orion/core-react";
import { Button, EmptyState, Skeleton } from "@orion/ui";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { CandlestickChart, Play } from "lucide-react";
import { useCompassBinding } from "../../lib/compass/use-compass";

/**
 * Вкладки «Рынков», которым нужен движок Compass (журнал, счета, сигналы, проверка, прогноз, график): пока движок не
 * запущен для этого пространства — предлагают его запустить. Когда работает, подключает типизированный клиент к прокси ORION.
 */
export function EngineGate({ workspaceId, children }: { workspaceId: string | undefined; children: React.ReactNode }): React.ReactElement {
  const { status, run } = useCompassEngine(workspaceId);
  const running = status.data?.state === "running";
  useCompassBinding(running ? workspaceId : undefined);

  if (status.isLoading || !status.data) return <Skeleton className="h-40" />;
  if (!running) {
    const data = status.data;
    return (
      <EmptyState
        icon={CandlestickChart}
        title={data.state === "starting" || run.isPending ? "Запускаю Compass…" : data.state === "unavailable" ? "Compass недоступен" : "Compass не запущен"}
        description={data.message ?? "Эти разделы работают на движке Compass, который запускается на этом компьютере."}
        action={
          data.state === "unavailable" || data.state === "starting" || run.isPending ? undefined : (
            <Button size="sm" onClick={() => run.mutate("start")}>
              <Play className="h-4 w-4" /> Запустить Compass
            </Button>
          )
        }
      />
    );
  }
  // Ключ по пространству: при смене пространства дочерние запросы не показывают чужие данные.
  return <div key={workspaceId}>{children}</div>;
}

/** Запрос к движку: ключ включает пространство, чтобы кэш не смешивал данные разных пространств. */
export function useCompassQuery<T>(workspaceId: string | undefined, key: QueryKey, fn: () => Promise<T>, options: { enabled?: boolean; refetchMs?: number } = {}) {
  return useQuery<T>({
    queryKey: ["compass", workspaceId, ...key],
    queryFn: fn,
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    refetchInterval: options.refetchMs,
    retry: false
  });
}

export function useInvalidateCompass(workspaceId: string | undefined): (...prefix: QueryKey) => Promise<void> {
  const queryClient = useQueryClient();
  return (...prefix) => queryClient.invalidateQueries({ queryKey: ["compass", workspaceId, ...prefix] });
}
