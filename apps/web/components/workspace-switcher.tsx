"use client";

import type { Workspace } from "@orion/shared-types";
import { IconButton, Input, Popover, cx } from "@orion/ui";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  filterSwitcherGroups,
  neighborWorkspace,
  switchOrder,
  type SwitcherGroup
} from "../lib/workspace-order";

/**
 * Quick workspace switching without leaving the screen: ‹ previous · [current ▾] · next ›.
 * The arrows walk the user's own order (favourites, then spheres), the centre
 * opens a searchable list, and every row has "open in a new window" — the
 * second-monitor case. Switching never navigates to a separate page; the list
 * only appears on request.
 *
 * `expanded` is the sidebar's room: collapsed to a rail only the avatar shows
 * (it still opens the list), expanded adds the arrows and the name.
 */
export function WorkspaceSwitcher({
  groups,
  active,
  expanded,
  onSelect,
  onOpenInNewWindow,
  onOpenSpaces
}: {
  groups: SwitcherGroup[];
  active: Workspace | undefined;
  expanded: boolean;
  onSelect: (workspaceId: string) => void;
  onOpenInNewWindow: (workspaceId: string) => void;
  /** Fallback with a single workspace: the full page to create or pick others. */
  onOpenSpaces: () => void;
}): React.ReactElement {
  const order = useMemo(() => switchOrder(groups), [groups]);
  const previous = neighborWorkspace(order, active?.id, -1);
  const next = neighborWorkspace(order, active?.id, 1);
  const initial = (active?.name ?? "O").slice(0, 1).toUpperCase();
  const [query, setQuery] = useState("");

  const avatarClass =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-xs font-bold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {expanded && previous ? (
        <IconButton label={`Предыдущее пространство: ${previous.name}`} size="sm" onClick={() => onSelect(previous.id)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
      ) : null}

      <Popover
        align="start"
        width={288}
        onOpenChange={(open) => {
          if (!open) setQuery("");
        }}
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={order.length < 2 ? onOpenSpaces : toggle}
            aria-haspopup="listbox"
            aria-expanded={open}
            title={`Пространство: ${active?.name ?? "—"}. Сменить`}
            className={cx(
              "flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              expanded && "flex-1 px-1 py-0.5 text-left hover:bg-white/5"
            )}
          >
            <span className={avatarClass} aria-hidden>
              {initial}
            </span>
            {expanded ? <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{active?.name ?? "ORION"}</span> : null}
            <span className="sr-only">Пространство: {active?.name}</span>
          </button>
        )}
      >
        {({ close }) => (
          <SwitcherList
            groups={groups}
            activeId={active?.id}
            query={query}
            onQuery={setQuery}
            onSelect={(id) => {
              close();
              if (id !== active?.id) onSelect(id);
            }}
            onOpenInNewWindow={(id) => {
              close();
              onOpenInNewWindow(id);
            }}
            onOpenSpaces={() => {
              close();
              onOpenSpaces();
            }}
          />
        )}
      </Popover>

      {expanded && next ? (
        <IconButton label={`Следующее пространство: ${next.name}`} size="sm" onClick={() => onSelect(next.id)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      ) : null}
    </div>
  );
}

function SwitcherList({
  groups,
  activeId,
  query,
  onQuery,
  onSelect,
  onOpenInNewWindow,
  onOpenSpaces
}: {
  groups: SwitcherGroup[];
  activeId: string | undefined;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onOpenInNewWindow: (id: string) => void;
  onOpenSpaces: () => void;
}): React.ReactElement {
  const shown = filterSwitcherGroups(groups, query);
  return (
    <div className="flex max-h-[70vh] flex-col gap-2 p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Найти пространство"
          aria-label="Найти пространство"
          className="pl-8"
        />
      </div>
      <div className="orion-scroll min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Пространства">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-label text-subtle-foreground">Ничего не найдено</p>
        ) : (
          shown.map((group, groupIndex) => (
            <div key={`${group.label}:${groupIndex}`} className="py-1">
              {group.label ? (
                <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{group.label}</p>
              ) : null}
              {group.workspaces.map((workspace) => {
                const isActive = workspace.id === activeId;
                return (
                  <div key={workspace.id} className="group flex items-center gap-1 rounded-lg hover:bg-card-hover">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => onSelect(workspace.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-2xs font-bold text-accent" aria-hidden>
                        {workspace.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-label text-foreground">{workspace.name}</span>
                      {isActive ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Текущее" /> : null}
                    </button>
                    <IconButton
                      label={`Открыть «${workspace.name}» в новом окне`}
                      size="sm"
                      onClick={() => onOpenInNewWindow(workspace.id)}
                      className="mr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onOpenSpaces}
        className="rounded-lg px-2 py-1.5 text-left text-label text-muted-foreground hover:bg-card-hover hover:text-foreground"
      >
        Все пространства и новое…
      </button>
    </div>
  );
}
