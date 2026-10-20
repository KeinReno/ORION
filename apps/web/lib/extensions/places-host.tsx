"use client";

import { isOrionPluginId } from "@orion/shared-types";
import { EmptyState, ErrorBoundary, PanelBody, PanelHeader, PanelShell } from "@orion/ui";
import { Puzzle } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { PanelComponentProps } from "../panel-registry";
import { useActiveWorkspace } from "../use-active-workspace";
import { useEnabledPlugins } from "../use-enabled-plugins";
import { places, placeKey, type PlaceKind, type PlaceKinds } from "./places";
import { PluginFallback } from "./slot-boundary";
// Importing the slot loader registers every compiled-in plugin, and with it the places they add.
import "./slot";

/**
 * Хост «мест» (ADR-0022, E1): что из добавленного плагинами и расширениями показывать в активном пространстве.
 * Место видно, только пока включён его владелец (плагин и модуль, который он расширяет).
 */
export function useEnabledPlaces<K extends PlaceKind>(kind: K): PlaceKinds[K][] {
  const version = useSyncExternalStore(places.subscribe, places.version, places.version);
  const { isEnabled } = useEnabledPlugins();
  const enabled = places.list(kind).filter((place) => place.runtime === true || (isOrionPluginId(place.pluginId) && isEnabled(place.pluginId)));
  // The same list object while nothing changed, so consumers can put it in memo/effect dependencies.
  const signature = `${version}|${enabled.map(placeKey).join(",")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => enabled, [signature]);
}

/** Граница ошибок одного места: сбой расширения не роняет панель-хозяина. */
export function PlaceBoundary({ pluginId, children }: { pluginId: string; children: ReactNode }): React.ReactElement {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => <PluginFallback pluginId={pluginId} onRetry={reset} />}
      onError={(error) => console.error(`[extensions] place of "${pluginId}" failed`, error)}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Панель дока `ext:<pluginId>.<id>` — одна на все панели плагинов и расширений. Окно открепления и сохранённая
 * раскладка знают только этот id; если владелец выключен или удалён, панель говорит об этом, а не падает.
 */
export function ExtensionPanelHost({ params, api }: PanelComponentProps): React.ReactElement {
  const key = params?.instanceId ?? "";
  const place = useEnabledPlaces("panel").find((item) => placeKey(item) === key);
  const { workspace } = useActiveWorkspace();
  useEffect(() => {
    if (place) api?.setTitle(place.label);
  }, [api, place]);

  if (!place || !workspace) {
    return (
      <PanelShell>
        <PanelHeader icon={Puzzle} title="Расширение" />
        <PanelBody>
          <EmptyState
            icon={Puzzle}
            title="Расширение недоступно"
            description="Оно выключено в этом пространстве, его модуль выключен или расширение удалено. Включить — «Настройки → Плагины»."
          />
        </PanelBody>
      </PanelShell>
    );
  }
  const Panel = place.component;
  return (
    <PlaceBoundary pluginId={place.pluginId}>
      <Panel workspaceId={workspace.id} setTitle={(title) => api?.setTitle(title)} />
    </PlaceBoundary>
  );
}

/** Карточки дашборда от плагинов и расширений; без них не рисует ничего. */
export function ExtensionWidgets({ workspaceId, className }: { workspaceId: string; className?: string }): React.ReactElement | null {
  const widgets = useEnabledPlaces("widget");
  if (widgets.length === 0) return null;
  return (
    <div className={className}>
      {widgets.map((widget) => {
        const Widget = widget.component;
        return (
          <section key={placeKey(widget)} aria-label={widget.title} className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-medium text-foreground">{widget.title}</h2>
            <PlaceBoundary pluginId={widget.pluginId}>
              <Widget workspaceId={workspaceId} />
            </PlaceBoundary>
          </section>
        );
      })}
    </div>
  );
}
