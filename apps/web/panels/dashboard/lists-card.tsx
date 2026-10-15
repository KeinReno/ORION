"use client";

import { useLists } from "@orion/core-react";
import { listProgress, sortListItems, type List } from "@orion/shared-types";
import { CheckToggle, cx } from "@orion/ui";
import { ArrowRight, ListChecks } from "lucide-react";
import { openList, openPanel } from "../../lib/panel-bus";
import { useListActions } from "../lists/use-list-actions";

const MAX_LISTS = 3;
const MAX_ITEMS = 4;

/**
 * «Списки» on the dashboard: the lists that still have something open (shopping first), each with its next
 * few entries you can tick right here. The module-off case is handled by the caller (it passes no workspace).
 * Renders nothing when every list is done or there are none — the dashboard stays quiet then.
 */
export function DashboardListsCard({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement | null {
  const lists = useLists(workspaceId);

  const open = (lists.data ?? [])
    .filter((list) => list.items.some((item) => !item.checked))
    .sort((a, b) => Number(b.kind === "shopping") - Number(a.kind === "shopping"))
    .slice(0, MAX_LISTS);
  if (open.length === 0) return null;

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card/60 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title text-foreground">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          Списки
        </h2>
        <button
          type="button"
          onClick={() => openPanel("lists")}
          aria-label="Открыть: Списки"
          className="rounded-md p-0.5 text-subtle-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-3">
        {open.map((list) => (
          <DashboardList key={list.id} workspaceId={workspaceId} list={list} />
        ))}
      </div>
    </section>
  );
}

/** One list of the card. Ticking goes through the same actions as the list's own view, so a bridge plugin (stock receipt) still applies. */
function DashboardList({ workspaceId, list }: { workspaceId: string | undefined; list: List }): React.ReactElement {
  const actions = useListActions(workspaceId, list);
  const progress = listProgress(list.items);
  const next = sortListItems(list.items).filter((item) => !item.checked).slice(0, MAX_ITEMS);
  return (
    <div>
      <button type="button" onClick={() => openList(list.id, list.name)} className="flex w-full items-baseline justify-between gap-2 text-left hover:underline">
        <span className="truncate text-body text-foreground">{list.name}</span>
        <span className="shrink-0 text-micro text-subtle-foreground">осталось {progress.open}</span>
      </button>
      <ul className="mt-1 space-y-0.5">
        {next.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <CheckToggle checked={item.checked} onClick={() => actions.toggle(item)} label={item.label} size="sm" />
            <span className={cx("min-w-0 flex-1 truncate text-body text-foreground")}>{item.label}</span>
          </li>
        ))}
      </ul>
      {progress.open > next.length ? <p className="mt-0.5 text-micro text-subtle-foreground">ещё {progress.open - next.length}</p> : null}
    </div>
  );
}
