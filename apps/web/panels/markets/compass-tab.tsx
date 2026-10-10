"use client";

import { useCompassEngine } from "@orion/core-react";
import { Button, EmptyState, Skeleton } from "@orion/ui";
import { CandlestickChart, Play, Square } from "lucide-react";

/**
 * Весь Compass внутри «Рынков»: движок (Python, `apps/compass-engine`) запускает сам ORION, окно Compass показывается
 * во вкладке. Движок стартует по кнопке.
 * Окно — песочный фрейм на локальный адрес движка; токен сессии в адресе ORION получает от своего API.
 */
export function CompassTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { status, run } = useCompassEngine(workspaceId);
  const data = status.data;

  // Остановленный движок не стартует молча (процесс Python и запросы к биржам) — только по кнопке.

  if (status.isLoading || !data) return <Skeleton className="m-4 h-40" />;

  if (data.state === "running" && data.url) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-3 py-1">
          <span className="mr-auto text-xs text-muted-foreground">Compass работает на этом компьютере</span>
          <Button size="sm" variant="outline" onClick={() => window.open(data.url ?? "", "_blank", "noopener")}>
            В отдельном окне
          </Button>
          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate("stop")}>
            <Square className="h-4 w-4" /> Остановить
          </Button>
        </div>
        <iframe
          title="Compass"
          src={data.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      </div>
    );
  }

  if (data.state === "starting" || run.isPending) {
    return <EmptyState icon={CandlestickChart} title="Запускаю Compass…" description="Первый запуск занимает несколько секунд." />;
  }

  return (
    <EmptyState
      icon={CandlestickChart}
      title={data.state === "unavailable" ? "Compass недоступен" : "Compass не запущен"}
      description={
        data.message ??
        "Графики МосБиржи и крипты, сигналы, бэктесты, лаборатория, прогноз, журнал и симулятор фьючерсов — прямо в ORION. Движок запускается на этом компьютере."
      }
      action={
        data.state === "unavailable" ? undefined : (
          <Button size="sm" onClick={() => run.mutate("start")}>
            <Play className="h-4 w-4" /> {data.state === "failed" ? "Запустить снова" : "Запустить Compass"}
          </Button>
        )
      }
    />
  );
}
