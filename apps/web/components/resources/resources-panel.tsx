"use client";

import { useEntityLinks } from "@orion/core-react";
import { ContextPanelFrame, EmptyState, IconButton, useToast } from "@orion/ui";
import { Copy, ExternalLink, Pin, PinOff, RotateCcw, FileSearch } from "lucide-react";
import { useState } from "react";
import { ENTITY_TYPE_ICON, ENTITY_TYPE_LABEL } from "../../lib/entity-type-meta";
import type { ResourceContext } from "../../lib/extensions/contracts";
import { ExtensionSlot, useSlotContributions } from "../../lib/extensions/slot";
import { openEntity, openPanel } from "../../lib/panel-bus";
import { contextHeading } from "../../lib/resource-context";
import { resourceContextActions, useResourceContext } from "../../lib/resource-context-store";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { EntityLinksSection } from "../entity-links";

type TabId = "resources" | "links" | "properties";

/**
 * The right-hand context panel (ADR-0014): «Ресурсы / Связи / Свойства» for the object or section that is in
 * focus. The shell owns the frame and the context; files come from whichever plugin fills
 * `shell.context.resources`; links reuse `EntityLinksSection` — the one UI for `entity_links`.
 */
export function ResourcesPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { state, context, pinned } = useResourceContext();
  const [tab, setTab] = useState<TabId>("resources");
  const providers = useSlotContributions("shell.context.resources");

  const heading = context ? contextHeading(context) : { title: "Контекст не выбран", subtitle: "" };
  const canReset = pinned || (state.activePanelId !== null && state.published[state.activePanelId] !== undefined);
  const workspaceId = workspace?.id;

  return (
    <ContextPanelFrame
      title={heading.title}
      subtitle={heading.subtitle}
      badge={pinned ? "закреплено" : undefined}
      tabs={[
        { id: "resources", label: "Ресурсы" },
        { id: "links", label: "Связи" },
        { id: "properties", label: "Свойства" }
      ]}
      activeTab={tab}
      onTabChange={(id) => setTab(id as TabId)}
      onClose={onClose}
      notice={
        state.notice ? (
          <span className="flex items-start justify-between gap-2">
            <span>{state.notice}</span>
            <button type="button" onClick={resourceContextActions.dismissNotice} className="shrink-0 underline hover:text-foreground">
              Понятно
            </button>
          </span>
        ) : undefined
      }
      actions={
        <>
          {context ? (
            <IconButton
              label={pinned ? "Следовать за текущим объектом" : "Закрепить контекст"}
              size="sm"
              aria-pressed={pinned}
              onClick={() => (pinned ? resourceContextActions.unpin() : resourceContextActions.pin(context))}
            >
              {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </IconButton>
          ) : null}
          {canReset ? (
            <IconButton label="Сбросить контекст до раздела" size="sm" onClick={resourceContextActions.reset}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          ) : null}
        </>
      }
    >
      {!workspaceId || !context ? (
        <div className="p-4">
          <EmptyState icon={FileSearch} title="Откройте раздел" description="Панель показывает файлы и связи текущего раздела или выбранного объекта." />
        </div>
      ) : tab === "resources" ? (
        providers.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={FileSearch}
              title="Ресурсы недоступны"
              description="Файлы показывает модуль «Документы» (плагин «Файлы в контекстной панели»). Он выключен в этом пространстве; сами файлы и связи не удалены."
            />
          </div>
        ) : (
          <ExtensionSlot name="shell.context.resources" props={{ workspaceId, context }} wrapperClassName="flex min-h-0 flex-1 flex-col" />
        )
      ) : tab === "links" ? (
        <LinksBody workspaceId={workspaceId} context={context} />
      ) : (
        <PropertiesBody workspaceId={workspaceId} context={context} />
      )}
    </ContextPanelFrame>
  );
}

function LinksBody({ workspaceId, context }: { workspaceId: string; context: ResourceContext }): React.ReactElement {
  if (context.kind !== "entity") {
    return (
      <div className="p-4">
        <EmptyState icon={FileSearch} title="Выберите объект" description={`В разделе «${context.label}» откройте задачу, заметку, проект, операцию или счёт — здесь появятся его связи.`} />
      </div>
    );
  }
  return (
    <div className="orion-scroll min-h-0 flex-1 overflow-y-auto p-3">
      <EntityLinksSection workspaceId={workspaceId} type={context.ref.entityType} id={context.ref.entityId} />
    </div>
  );
}

function PropertiesBody({ workspaceId, context }: { workspaceId: string; context: ResourceContext }): React.ReactElement {
  const { toast } = useToast();
  const entity = context.kind === "entity" ? context.ref : null;
  const links = useEntityLinks(workspaceId, entity?.entityType ?? "project", entity?.entityId);

  if (!entity || context.kind !== "entity") {
    const section = context.kind === "section" ? context : null;
    return (
      <dl className="space-y-2 p-3 text-xs">
        <Row label="Раздел" value={section?.label ?? "—"} />
        <p className="pt-1 text-2xs text-subtle-foreground">Выберите объект в разделе, чтобы увидеть его свойства.</p>
      </dl>
    );
  }

  const Icon = ENTITY_TYPE_ICON[entity.entityType];
  return (
    <div className="orion-scroll min-h-0 flex-1 overflow-y-auto p-3">
      <dl className="space-y-2 text-xs">
        <Row label="Название" value={context.title || "Без названия"} icon={<Icon className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden />} />
        <Row label="Тип" value={ENTITY_TYPE_LABEL[entity.entityType]} />
        <Row label="Раздел" value={context.sectionLabel || "—"} />
        <Row
          label="Связей"
          value={links.isLoading ? "…" : links.isError ? "не удалось загрузить" : String(links.data?.items.length ?? 0) + (links.data?.nextCursor ? "+" : "")}
        />
        <div className="flex items-center justify-between gap-2">
          <dt className="shrink-0 text-subtle-foreground">Идентификатор</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <code className="truncate text-2xs text-muted-foreground" title={entity.entityId}>
              {entity.entityId}
            </code>
            <IconButton
              label="Скопировать идентификатор"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(entity.entityId).then(
                  () => toast({ title: "Идентификатор скопирован", tone: "success" }),
                  () => toast({ title: "Не удалось скопировать", tone: "danger" })
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </IconButton>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-2xs text-subtle-foreground">Полное редактирование — в основной вкладке раздела; панель его не заменяет.</p>
      <button
        type="button"
        onClick={() => (entity.entityType === "account" ? openPanel("finance") : openEntity(entity.entityType, entity.entityId, context.title))}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Открыть
      </button>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-subtle-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-foreground">
        {icon}
        <span className="truncate" title={value}>
          {value}
        </span>
      </dd>
    </div>
  );
}
