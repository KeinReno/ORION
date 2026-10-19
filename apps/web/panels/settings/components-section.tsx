"use client";

import { useBackgroundJobs, useComponentData } from "@orion/core-react";
import { buildComponentDiagnostics, COMPONENT_MANIFESTS, PLATFORM_API_VERSION, type ComponentDiagnosticsRow } from "@orion/shared-types";
import { Badge, Card, EmptyState, Skeleton } from "@orion/ui";
import { CheckCircle2 } from "lucide-react";
import { useMemo } from "react";

const DATA_LABEL: Record<ComponentDiagnosticsRow["data"], string | null> = {
  none: null,
  ok: "Данные актуальны",
  pending: "Миграции не применены",
  failed: "Миграция не завершена",
  unknown: "Состояние данных неизвестно"
};

/**
 * G16 — менеджер компонентов (диагностика): версия, совместимость с платформой, граф жёстких зависимостей, состояние
 * миграций (G11) и сбои фоновых задач (G9). Установки и обновления здесь нет: компоненты ставятся сборкой, а не из API.
 */
export function ComponentsDiagnostics(): React.ReactElement {
  const data = useComponentData();
  const jobs = useBackgroundJobs();
  const rows = useMemo(
    () => buildComponentDiagnostics(COMPONENT_MANIFESTS, data.data ?? [], jobs.data ?? []),
    [data.data, jobs.data]
  );
  const problems = rows.filter((row) => row.problems.length > 0);

  if (data.isLoading || jobs.isLoading) return <Skeleton className="h-48" />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Версия платформы {PLATFORM_API_VERSION}. Здесь видно, что требует внимания: не применённые миграции, сбои фоновых
        задач и несовместимые версии. Компоненты ставятся вместе со сборкой приложения.
        {data.isError || jobs.isError ? " Часть данных диагностики загрузить не удалось." : ""}
      </p>
      {problems.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Проблем с компонентами нет" description={`Проверено компонентов: ${rows.length}.`} />
      ) : (
        <ul className="space-y-2" aria-label="Компоненты с проблемами">
          {problems.map((row) => (
            <ComponentRow key={row.id} row={row} />
          ))}
        </ul>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Все компоненты ({rows.length})</summary>
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <ComponentRow key={row.id} row={row} />
          ))}
        </ul>
      </details>
    </div>
  );
}

function ComponentRow({ row }: { row: ComponentDiagnosticsRow }): React.ReactElement {
  const dataLabel = DATA_LABEL[row.data];
  return (
    <li>
      <Card className="space-y-1 py-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {row.title}
          <Badge tone="neutral">{row.kind === "module" ? "Модуль" : "Плагин"}</Badge>
          <span className="text-xs font-normal text-muted-foreground">v{row.version}</span>
          {row.compatible ? null : <Badge tone="danger">Несовместим</Badge>}
          {dataLabel ? <Badge tone={row.data === "ok" ? "success" : "danger"}>{dataLabel}</Badge> : null}
        </p>
        {row.requires.length > 0 ? <p className="text-xs text-muted-foreground">Нужны: {row.requires.join(", ")}</p> : null}
        {row.dependents.length > 0 ? <p className="text-xs text-muted-foreground">Зависят: {row.dependents.join(", ")}</p> : null}
        {row.problems.map((problem) => (
          <p key={problem} className="text-xs text-danger">
            {problem}
          </p>
        ))}
      </Card>
    </li>
  );
}
