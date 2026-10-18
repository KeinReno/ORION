"use client";

import {
  usePreferences,
  useSetWorkspaceModule,
  useSetWorkspaceModuleRestriction,
  useUpdatePreferences,
  useWorkspaceModules
} from "@orion/core-react";
import { ApiError } from "@orion/core";
import { isComponentHasDependentsError, type ComponentDependent, type ModuleKind, type WorkspaceModuleState } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Skeleton, useToast } from "@orion/ui";
import { AlertCircle, Search } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { hasUnsavedDrafts } from "../../lib/unsaved-drafts";
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
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const { toast } = useToast();
  const hiddenByMe = preferences.data?.hiddenModules ?? [];
  const [pending, setPending] = useState<WorkspaceModuleState | null>(null);
  /** 409 component_has_dependents: ждём подтверждения владельца, затем повторяем с confirm. */
  const [blocked, setBlocked] = useState<{ item: WorkspaceModuleState; dependents: ComponentDependent[] } | null>(null);
  const [query, setQuery] = useState("");
  const isOwner = workspace?.role === "owner";

  async function apply(item: WorkspaceModuleState, enabled: boolean, confirm = false): Promise<void> {
    setPending(null);
    setBlocked(null);
    if (!enabled && hasUnsavedDrafts()) {
      toast({
        title: "Сначала сохраните открытые изменения",
        description: "Выключение модуля закроет его вкладки. Сохраните черновики или закройте их с подтверждением, затем повторите действие.",
        tone: "default"
      });
      return;
    }
    try {
      await setModule.mutateAsync({ moduleId: item.id, enabled, confirm });
      toast({
        title: enabled ? `Модуль «${item.label}» включён` : `Модуль «${item.label}» выключен`,
        description: enabled ? undefined : "Данные сохранены и вернутся при повторном включении.",
        tone: "success"
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isComponentHasDependentsError(error.details)) {
        setBlocked({ item, dependents: error.details.dependents });
        return;
      }
      toast({ title: "Не удалось изменить модуль", description: describeAuthError(error), tone: "danger" });
    }
  }

  /** Personal, navigation-only: nothing changes for the workspace and no data is touched. */
  async function toggleHiddenByMe(item: WorkspaceModuleState): Promise<void> {
    const hidden = hiddenByMe.includes(item.id);
    const next = hidden ? hiddenByMe.filter((id) => id !== item.id) : [...hiddenByMe, item.id];
    try {
      await updatePreferences.mutateAsync({ hiddenModules: next });
      toast({
        title: hidden ? `«${item.label}» снова в вашем меню` : `«${item.label}» скрыт из вашего меню`,
        description: hidden ? undefined : "Для остальных участников и для данных ничего не изменилось.",
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: describeAuthError(error), tone: "danger" });
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
  const search = query.trim().toLocaleLowerCase("ru");
  const visibleModules = modules.data.filter((item) =>
    `${item.label} ${item.summary}`.toLocaleLowerCase("ru").includes(search)
  );

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

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти модуль"
          aria-label="Найти модуль"
          className="pl-9"
        />
      </div>
      {visibleModules.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Модуль не найден"
          description="Попробуйте другое название."
          action={<Button size="sm" variant="outline" onClick={() => setQuery("")}>Сбросить поиск</Button>}
        />
      ) : null}

      {groups.map((kind) => {
        const items = visibleModules.filter((item) => item.kind === kind);
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
                        {hiddenByMe.includes(item.id) ? <Badge tone="neutral">Скрыт у вас</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.summary}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {item.enabled ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={updatePreferences.isPending || preferences.isLoading}
                          onClick={() => void toggleHiddenByMe(item)}
                          title="Только для вас: убирает пункт из вашего бокового меню, данные и доступ остальных не меняются"
                        >
                          {hiddenByMe.includes(item.id) ? "Показать у меня" : "Скрыть у меня"}
                        </Button>
                      ) : null}
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
                  <details className="text-2xs text-muted-foreground">
                    <summary className="w-fit cursor-pointer rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label={`Подробнее о модуле «${item.label}»`}>
                      Подробнее о модуле
                    </summary>
                  <dl className="mt-3 grid gap-2 text-2xs text-subtle-foreground [@container(min-width:576px)]:grid-cols-2">
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
                  </details>
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
      <ConfirmDialog
        open={blocked !== null}
        title={blocked ? `Выключить «${blocked.item.label}» вместе с зависимыми?` : "Зависимые компоненты"}
        description={
          blocked
            ? `Вместе с модулем перестанут работать: ${blocked.dependents.map((d) => `«${d.label}»`).join(", ")}. Данные сохранятся и вернутся при повторном включении.`
            : undefined
        }
        confirmLabel="Выключить всё"
        danger
        onConfirm={() => {
          if (blocked) void apply(blocked.item, false, true);
        }}
        onCancel={() => setBlocked(null)}
      />
    </div>
  );
}
