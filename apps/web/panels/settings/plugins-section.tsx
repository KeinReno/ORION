"use client";

import { useSetWorkspacePlugin, useWorkspacePlugins } from "@orion/core-react";
import type { WorkspacePluginState } from "@orion/shared-types";
import { MODULE_CATALOG } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Skeleton, useToast } from "@orion/ui";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

export function PluginsSettings(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const plugins = useWorkspacePlugins(workspace?.id);
  const setPlugin = useSetWorkspacePlugin(workspace?.id);
  const { toast } = useToast();
  const [pending, setPending] = useState<WorkspacePluginState | null>(null);
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

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Плагин дополняет один конкретный модуль (не оболочку). Выключение модуля-хозяина отключает плагин
        автоматически, даже если сам переключатель плагина остаётся включённым.
      </p>
      {!isOwner ? (
        <p className="text-xs text-muted-foreground">Состав плагинов может менять только владелец пространства.</p>
      ) : null}

      <div className="space-y-2">
        {plugins.data.map((item) => {
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
              <dl className="grid gap-2 text-2xs text-subtle-foreground">
                <div>
                  <dt className="font-medium text-muted-foreground">Даёт</dt>
                  <dd>{item.provides.join(" · ")}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">При выключении</dt>
                  <dd>{item.disableBehavior}</dd>
                </div>
              </dl>
            </Card>
          );
        })}
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
