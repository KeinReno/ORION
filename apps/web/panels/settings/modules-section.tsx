"use client";

import { useSetWorkspaceModule, useSetWorkspaceModuleRestriction, useWorkspaceModules } from "@orion/core-react";
import type { ModuleKind, WorkspaceModuleState } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Skeleton, useToast } from "@orion/ui";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

const KIND_LABEL: Record<ModuleKind, string> = {
  base: "Базовые",
  additional: "Дополнительные"
};

export function ModulesSettings(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const modules = useWorkspaceModules(workspace?.id);
  const setModule = useSetWorkspaceModule(workspace?.id);
  const setRestriction = useSetWorkspaceModuleRestriction(workspace?.id);
  const { toast } = useToast();
  const [pending, setPending] = useState<WorkspaceModuleState | null>(null);
  const isOwner = workspace?.role === "owner";

  async function apply(item: WorkspaceModuleState, enabled: boolean): Promise<void> {
    setPending(null);
    try {
      await setModule.mutateAsync({ moduleId: item.id, enabled });
      toast({
        title: enabled ? `Модуль «${item.label}» включён` : `Модуль «${item.label}» выключен`,
        description: enabled ? undefined : "Данные сохранены и вернутся при повторном включении.",
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось изменить модуль", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function applyRestriction(item: WorkspaceModuleState, restricted: boolean): Promise<void> {
    try {
      await setRestriction.mutateAsync({ moduleId: item.id, restricted });
      toast({
        title: restricted
          ? `«${item.label}» теперь только для владельца и тимлида`
          : `«${item.label}» снова доступен всем участникам`,
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось изменить доступ", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (modules.isLoading) return <Skeleton className="h-48" />;
  if (modules.isError || !modules.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        tone="danger"
        title="Не удалось загрузить список модулей"
        action={
          <Button size="sm" variant="outline" onClick={() => void modules.refetch()}>
            Повторить
          </Button>
        }
      />
    );
  }

  const groups: ModuleKind[] = ["base", "additional"];

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Выключение скрывает панель и API, но не удаляет данные. Оболочка — дашборд, инбокс, настройки и
        резервные копии — всегда доступна. «Ограничить» оставляет модуль включённым, но скрывает его от
        обычных участников — владелец и тимлид продолжают видеть его как обычно.
      </p>
      {!isOwner ? (
        <p className="text-xs text-muted-foreground">Состав модулей может менять только владелец пространства.</p>
      ) : null}

      {groups.map((kind) => {
        const items = modules.data?.filter((item) => item.kind === kind) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={kind} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">{KIND_LABEL[kind]}</h3>
            <div className="space-y-2">
              {items.map((item) => (
                <Card key={item.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {item.label}
                        <Badge tone={item.enabled ? "success" : "neutral"}>{item.enabled ? "Включён" : "Выключен"}</Badge>
                        {item.restricted ? <Badge tone="neutral">Только владелец и тимлид</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.summary}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isOwner || setRestriction.isPending}
                        onClick={() => void applyRestriction(item, !item.restricted)}
                      >
                        {item.restricted ? "Открыть всем" : "Ограничить"}
                      </Button>
                      {item.enabled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isOwner || setModule.isPending}
                          onClick={() => setPending(item)}
                        >
                          Выключить
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!isOwner || setModule.isPending}
                          onClick={() => void apply(item, true)}
                        >
                          Включить
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="grid gap-2 text-2xs text-subtle-foreground [@container(min-width:576px)]:grid-cols-2">
                    <div>
                      <dt className="font-medium text-muted-foreground">Отвечает за</dt>
                      <dd>{item.owns}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-muted-foreground">Без соседей</dt>
                      <dd>{item.livesWithout}</dd>
                    </div>
                    <div className="[@container(min-width:576px)]:col-span-2">
                      <dt className="font-medium text-muted-foreground">При выключении</dt>
                      <dd>{item.disableBehavior}</dd>
                    </div>
                    {item.provides.length > 0 ? (
                      <div className="[@container(min-width:576px)]:col-span-2">
                        <dt className="font-medium text-muted-foreground">Даёт другим</dt>
                        <dd>{item.provides.join(" · ")}</dd>
                      </div>
                    ) : null}
                    {item.optionalDependencies.length > 0 ? (
                      <div className="[@container(min-width:576px)]:col-span-2">
                        <dt className="font-medium text-muted-foreground">Необязательные связи</dt>
                        <dd>
                          {item.optionalDependencies
                            .map((id) => modules.data?.find((entry) => entry.id === id)?.label ?? id)
                            .join(", ")}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `Выключить «${pending.label}»?` : "Выключить модуль"}
        description={
          pending
            ? `${pending.disableBehavior} Действие относится только к текущему пространству.`
            : undefined
        }
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
