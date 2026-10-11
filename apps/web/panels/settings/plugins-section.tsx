"use client";

import { useSetWorkspacePlugin, useWorkspacePlugins } from "@orion/core-react";
import type { WorkspacePluginState } from "@orion/shared-types";
import { MODULE_CATALOG } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Skeleton, useToast } from "@orion/ui";
import { AlertCircle, Search } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/** `moduleId` narrows the list to the plugins of one module (the per-module settings sheet). */
export function PluginsSettings({ moduleId }: { moduleId?: string } = {}): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const plugins = useWorkspacePlugins(workspace?.id);
  const setPlugin = useSetWorkspacePlugin(workspace?.id);
  const { toast } = useToast();
  const [pending, setPending] = useState<WorkspacePluginState | null>(null);
  const [query, setQuery] = useState("");
  const isOwner = workspace?.role === "owner";

  async function apply(item: WorkspacePluginState, enabled: boolean): Promise<void> {
    setPending(null);
    try {
      await setPlugin.mutateAsync({ pluginId: item.id, enabled });
      toast({
        title: enabled ? `Плагин «${item.label}» включён` : `Плагин «${item.label}» выключен`,
        description: enabled ? undefined : "Данные сохранены и вернутся при повторном включении.",
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось изменить плагин", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (plugins.isLoading) return <Skeleton className="h-32" />;
  if (plugins.isError || !plugins.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        tone="danger"
        title="Не удалось загрузить список плагинов"
        action={
          <Button size="sm" variant="outline" onClick={() => void plugins.refetch()}>
            Повторить
          </Button>
        }
      />
    );
  }

  const search = query.trim().toLocaleLowerCase("ru");
  const visiblePlugins = plugins.data.filter((item) => {
    if (moduleId !== undefined && item.extendsModuleId !== moduleId) return false;
    const hostLabel = MODULE_CATALOG.find((module) => module.id === item.extendsModuleId)?.label ?? item.extendsModuleId;
    return `${item.label} ${item.summary} ${hostLabel}`.toLocaleLowerCase("ru").includes(search);
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Плагин дополняет один конкретный модуль (не оболочку). Выключение модуля-хозяина отключает плагин
        автоматически, даже если сам переключатель плагина остаётся включённым.
      </p>
      {!isOwner ? (
        <p className="text-xs text-muted-foreground">Состав плагинов может менять только владелец пространства.</p>
      ) : null}

      {moduleId === undefined ? (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти плагин или модуль"
            aria-label="Найти плагин или модуль"
            className="pl-9"
          />
        </div>
      ) : null}

      <div className="space-y-2">
        {visiblePlugins.map((item) => {
          const hostLabel = MODULE_CATALOG.find((m) => m.id === item.extendsModuleId)?.label ?? item.extendsModuleId;
          return (
            <Card key={item.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {item.label}
                    <Badge tone={item.enabled ? "success" : "neutral"}>{item.enabled ? "Включён" : "Выключен"}</Badge>
                    <Badge tone="neutral">дополняет «{hostLabel}»</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.summary}</p>
                </div>
                {item.enabled ? (
                  <Button size="sm" variant="outline" disabled={!isOwner || setPlugin.isPending} onClick={() => setPending(item)}>
                    Выключить
                  </Button>
                ) : (
                  <Button size="sm" disabled={!isOwner || setPlugin.isPending} onClick={() => void apply(item, true)}>
                    Включить
                  </Button>
                )}
              </div>
              <details className="text-2xs text-muted-foreground">
                <summary className="w-fit cursor-pointer rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label={`Подробнее о плагине «${item.label}»`}>
                  Подробнее о плагине
                </summary>
              <dl className="mt-3 grid gap-2 text-2xs text-subtle-foreground">
                <div>
                  <dt className="font-medium text-muted-foreground">Даёт</dt>
                  <dd>{item.provides.join(" · ")}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">При выключении</dt>
                  <dd>{item.disableBehavior}</dd>
                </div>
              </dl>
              </details>
            </Card>
          );
          })}
        {moduleId !== undefined && !plugins.data.some((item) => item.extendsModuleId === moduleId) ? (
          <p className="text-xs text-muted-foreground">У этого модуля пока нет плагинов.</p>
        ) : null}
        {moduleId === undefined && visiblePlugins.length === 0 ? (
          <EmptyState icon={Search} title="Плагин не найден" description="Попробуйте другое название." action={<Button size="sm" variant="outline" onClick={() => setQuery("")}>Сбросить поиск</Button>} />
        ) : null}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `Выключить «${pending.label}»?` : "Выключить плагин"}
        description={pending ? `${pending.disableBehavior} Действие относится только к текущему пространству.` : undefined}
        confirmLabel="Выключить"
        danger={false}
        onConfirm={() => {
          if (pending) void apply(pending, false);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
