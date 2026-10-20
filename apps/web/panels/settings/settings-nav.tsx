"use client";

import { DropdownMenu, IconButton, Input, Select, cx } from "@orion/ui";
import { ExternalLink, PanelRight, Search } from "lucide-react";
import { useState } from "react";
import { panelDragHandleProps } from "../../lib/panel-drag-handle";
import { openPanel } from "../../lib/panel-bus";
import { detachPanelToWindow } from "../../lib/panel-window";
import { sectionViewPanelId } from "../../lib/section-views";
import {
  SETTINGS_GROUPS,
  searchSettings,
  settingsGroupLabel,
  settingsTabInfo,
  type SettingsSearchHit,
  type SettingsTab
} from "../../lib/settings-catalog";

const BASE_ID = "settings";

/**
 * Navigation of the settings panel: a search over every parameter, then the tabs grouped by who a
 * change affects (a sidebar list on wide, a <select> with groups on narrow). Every tab can be its own
 * dock panel / OS window: Ctrl/Cmd+drag an entry into the dock, or use the «⧉» menu for the current one.
 */
/** A settings section added by a plugin or extension (ADR-0022): tab value `ext:<pluginId>.<id>`. */
export interface ExtensionSettingsTab {
  value: `ext:${string}`;
  label: string;
}

export function SettingsNav({
  value,
  workspaceName,
  extensionTabs = [],
  onChange,
  onPick
}: {
  value: SettingsTab | ExtensionSettingsTab["value"];
  workspaceName: string | undefined;
  /** Shown as their own group «Разделы расширений» before «Справка». */
  extensionTabs?: readonly ExtensionSettingsTab[];
  onChange: (value: SettingsTab | ExtensionSettingsTab["value"]) => void;
  /** A search hit: switch to its tab and bring the parameter into view. */
  onPick: (hit: SettingsSearchHit) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const hits = searchSettings(query);
  const searching = query.trim() !== "";
  const active = settingsTabInfo(value);
  const activeId = active ? sectionViewPanelId({ base: BASE_ID, view: active.value }) : null;
  const name = active?.label ?? "";
  // Built-in groups from the catalog, plus one group for sections plugins and extensions add.
  const groups: { id: string; label: string; tabs: readonly { value: SettingsTab | ExtensionSettingsTab["value"]; label: string }[] }[] = SETTINGS_GROUPS.map(
    (group) => ({ id: group.id, label: settingsGroupLabel(group.id, workspaceName), tabs: group.tabs })
  );
  if (extensionTabs.length > 0) {
    const help = groups.findIndex((group) => group.id === "help");
    groups.splice(help === -1 ? groups.length : help, 0, { id: "extension-sections", label: "Разделы расширений", tabs: extensionTabs });
  }

  function pick(hit: SettingsSearchHit): void {
    setQuery("");
    onPick(hit);
  }

  const search = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <Input
        type="search"
        aria-label="Найти настройку"
        placeholder="Найти настройку"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && hits[0]) {
            event.preventDefault();
            pick(hits[0]);
          } else if (event.key === "Escape" && searching) {
            event.preventDefault();
            setQuery("");
          }
        }}
        className="w-full pl-8"
      />
    </div>
  );

  const results = searching ? (
    <ul className="flex flex-col gap-0.5" aria-label="Найденные настройки">
      {hits.length === 0 ? (
        <li className="px-3 py-row text-label text-subtle-foreground">Ничего не нашлось</li>
      ) : (
        hits.map((hit) => (
          <li key={`${hit.tab}:${hit.anchor ?? ""}`}>
            <button
              type="button"
              onClick={() => pick(hit)}
              className="flex w-full flex-col rounded-lg px-3 py-row text-left text-label text-foreground transition-colors hover:bg-white/5"
            >
              <span>{hit.label}</span>
              {hit.anchor ? <span className="text-2xs text-subtle-foreground">{hit.tabLabel}</span> : null}
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <>
      <div className="flex flex-col gap-2 [@container(min-width:640px)]:hidden">
        {search}
        {results}
        <div className="flex items-center gap-1">
          <Select value={value} onChange={(event) => onChange(event.target.value as SettingsTab)} className="min-w-0 flex-1" aria-label="Раздел настроек">
            {groups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.tabs.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {activeId ? <DetachMenu activeId={activeId} name={name} /> : null}
        </div>
      </div>
      <div className="hidden w-52 shrink-0 flex-col gap-3 [@container(min-width:640px)]:flex">
        {search}
        {results ?? (
          <nav className="flex flex-col gap-3" aria-label="Разделы настроек" {...panelDragHandleProps(null)}>
            {groups.map((group) => (
              <div key={group.id} className="flex flex-col gap-0.5">
                <p className="truncate px-3 pb-0.5 text-micro uppercase text-subtle-foreground" title={group.label}>
                  {group.label}
                </p>
                {group.tabs.map((item) => {
                  // Only built-in tabs detach into their own panel (`view:settings~<tab>`); extension sections stay in place.
                  const id = settingsTabInfo(item.value) ? sectionViewPanelId({ base: BASE_ID, view: item.value }) : null;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => onChange(item.value)}
                      aria-current={value === item.value ? "page" : undefined}
                      {...(id ? { "data-panel-drag": id, "data-panel-title": `Настройки · ${item.label}` } : {})}
                      className={cx(
                        "rounded-lg px-3 py-row text-left text-label transition-colors",
                        value === item.value ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}
        {activeId && !searching ? (
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
