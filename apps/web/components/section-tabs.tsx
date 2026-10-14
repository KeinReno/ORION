"use client";

import { DropdownMenu, IconButton, SegmentedControl, type SegmentedOption } from "@orion/ui";
import { ExternalLink, PanelRight } from "lucide-react";
import { useEffect } from "react";
import { panelDragHandleProps } from "../lib/panel-drag-handle";
import { openPanel } from "../lib/panel-bus";
import type { PanelComponentProps } from "../lib/panel-registry";
import { detachPanelToWindow } from "../lib/panel-window";
import { resolveLockedView, sectionViewPanelId } from "../lib/section-views";

export interface SectionTab<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Plain-text name for the dock tab / window title and the menu; falls back to a string `label`, then to `value`. */
  title?: string;
}

/** Plain-text name of a tab (dock tab title, menu, panel subtitle). */
export function sectionTabTitle<T extends string>(tab: SectionTab<T> | undefined): string | undefined {
  return tab ? tabTitle(tab) : undefined;
}

function tabTitle<T extends string>(tab: SectionTab<T>): string {
  return tab.title ?? (typeof tab.label === "string" ? tab.label : tab.value);
}

/**
 * Locked mode of a section panel (it was opened as a view of one tab, see `lib/section-views.ts`):
 * which tab to show, and the title of the dock tab / OS window. Call it with the panel's available tabs
 * (plugin tabs included) before computing the tab to show.
 */
export function useSectionView<T extends string>(
  params: PanelComponentProps["params"],
  api: PanelComponentProps["api"],
  baseLabel: string,
  tabs: ReadonlyArray<SectionTab<T>>
): { locked: boolean; view: T | null; missing: boolean } {
  const state = resolveLockedView(params, tabs.map((tab) => tab.value));
  const found = tabs.find((tab) => tab.value === state.view);
  const title = found ? `${baseLabel} · ${tabTitle(found)}` : null;
  useEffect(() => {
    if (!title) return;
    if (api) api.setTitle(title);
    else if (typeof document !== "undefined") document.title = title;
  }, [api, title]);
  return state;
}

/**
 * The tab strip of a section panel, with every tab detachable: Ctrl/Cmd+drag a tab into the dock, or use
 * the «⧉» menu for the current tab («панелью» = dock tab, «окном» = OS window). Renders nothing when the
 * panel itself is a locked view — the tab is already the whole panel.
 */
export function SectionTabs<T extends string>({
  baseId,
  instance,
  tabs,
  value,
  onChange,
  locked = false,
  size
}: {
  baseId: string;
  /** The record the section is about (project id, home id), when there is one. */
  instance?: string;
  tabs: ReadonlyArray<SectionTab<T>>;
  value: T;
  onChange: (value: T) => void;
  locked?: boolean;
  size?: "sm" | "md";
}): React.ReactElement | null {
  if (locked) return null;
  const options: SegmentedOption<T>[] = tabs.map((tab) => {
    const id = sectionViewPanelId({ base: baseId, view: tab.value, instance });
    return { value: tab.value, label: tab.label, ...(id ? { dataAttrs: { "data-panel-drag": id } } : {}) };
  });
  const active = tabs.find((tab) => tab.value === value);
  const activeId = active ? sectionViewPanelId({ base: baseId, view: active.value, instance }) : null;
  const name = active ? tabTitle(active) : "";
  return (
    <div className="flex max-w-full items-center gap-1" {...panelDragHandleProps(null)}>
      <div className="min-w-0 overflow-x-auto">
        <SegmentedControl<T> value={value} onChange={onChange} options={options} size={size} />
      </div>
      {activeId ? (
        <DropdownMenu
          align="end"
          trigger={({ toggle }) => (
            <IconButton label={`Вынести вкладку «${name}»`} size="sm" onClick={toggle}>
              <ExternalLink className="h-3.5 w-3.5" />
            </IconButton>
          )}
          items={[
            { label: `«${name}» — открыть панелью`, icon: PanelRight, onSelect: () => openPanel(activeId, name) },
            { label: `«${name}» — открыть окном`, icon: ExternalLink, onSelect: () => void detachPanelToWindow(activeId, name) }
          ]}
        />
      ) : null}
    </div>
  );
}
