"use client";

import { DropdownMenu, IconButton, Select, cx } from "@orion/ui";
import { ExternalLink, PanelRight } from "lucide-react";
import type { SectionTab } from "../../components/section-tabs";
import { panelDragHandleProps } from "../../lib/panel-drag-handle";
import { openPanel } from "../../lib/panel-bus";
import { detachPanelToWindow } from "../../lib/panel-window";
import { sectionViewPanelId } from "../../lib/section-views";

const BASE_ID = "settings";

/**
 * Navigation of the settings panel (a sidebar list on wide, a <select> on narrow). Every entry can be its own
 * dock panel / OS window: Ctrl/Cmd+drag an entry into the dock, or use the «⧉» menu for the current one.
 * `SectionTabs` is a horizontal segmented strip, so the vertical list is local to this panel.
 */
export function SettingsNav<T extends string>({
  tabs,
  value,
  onChange
}: {
  tabs: ReadonlyArray<SectionTab<T> & { label: string }>;
  value: T;
  onChange: (value: T) => void;
}): React.ReactElement {
  const active = tabs.find((tab) => tab.value === value);
  const activeId = active ? sectionViewPanelId({ base: BASE_ID, view: active.value }) : null;
  const name = active?.label ?? "";
  return (
    <>
      <div className="flex items-center gap-1 [@container(min-width:640px)]:hidden">
        <Select value={value} onChange={(event) => onChange(event.target.value as T)} className="min-w-0 flex-1" aria-label="Раздел настроек">
          {tabs.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        {activeId ? <DetachMenu activeId={activeId} name={name} /> : null}
      </div>
      <div className="hidden w-48 shrink-0 flex-col gap-1 [@container(min-width:640px)]:flex">
        <nav className="flex flex-col gap-0.5" aria-label="Разделы настроек" {...panelDragHandleProps(null)}>
          {tabs.map((item) => {
            const id = sectionViewPanelId({ base: BASE_ID, view: item.value });
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onChange(item.value)}
                {...(id ? { "data-panel-drag": id, "data-panel-title": `Настройки · ${typeof item.label === "string" ? item.label : item.value}` } : {})}
                className={cx(
                  "rounded-lg px-3 py-row text-left text-label transition-colors",
                  value === item.value ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        {activeId ? (
          <div className="flex justify-end">
            <DetachMenu activeId={activeId} name={name} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function DetachMenu({ activeId, name }: { activeId: string; name: string }): React.ReactElement {
  return (
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
  );
}
