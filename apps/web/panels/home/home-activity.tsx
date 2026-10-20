"use client";

import { useHomeActivity } from "@orion/core-react";
import { History } from "lucide-react";
import { openTask } from "../../lib/panel-bus";
import { EmptyLine, SectionCard, type HomeSectionProps } from "./shared";

/** Lately around this home: chores moving, comments, meter readings — newest first. */
export function HomeActivity({ workspaceId, home }: HomeSectionProps): React.ReactElement {
  const { data } = useHomeActivity(workspaceId, home.id);
  const entries = (data ?? []).slice(0, 12);
  return (
    <SectionCard title="Недавнее по дому" icon={History}>
      {entries.length === 0 ? (
        <EmptyLine>Пока ничего не происходило.</EmptyLine>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-label">
              <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle-foreground">
                {new Date(entry.at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              {entry.actorName ? <span className="shrink-0">{entry.actorName}</span> : null}
              <span className="min-w-0 flex-1 text-muted-foreground">{entry.summary}</span>
              {entry.entity ? (
                <button type="button" onClick={() => openTask(entry.entity!.id)} className="max-w-[14rem] truncate hover:underline">
                  {entry.entity.title}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
