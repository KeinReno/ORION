"use client";

import { useAgentPresence } from "@orion/core-react";
import type { AgentPresenceEvent, SearchableEntityType } from "@orion/shared-types";
import { Button, Popover, StarBorder, cx } from "@orion/ui";
import { Bot } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { relativeTime } from "./format";
import { openEntity, openSettings } from "./panel-bus";
import { useActiveWorkspace } from "./use-active-workspace";

/**
 * «Индикация работы агентов»: who of your agents (Claude Desktop, Cursor, the built-in assistant) is doing what in ORION
 * right now. One feeder per window polls `GET …/agent-tokens/presence` and keeps a small store; the shell shows a pill,
 * the panel of the touched module gets an animated frame, a touched record lights up.
 *
 * The store is module-level (not a React context) so panels rendered by dockview and detached windows read it the
 * same way. Hooks return the event objects themselves, so a row re-renders only when ITS state changes.
 */

/** An agent counts as working while its last call is this fresh. */
const ACTIVE_MS = 10_000;
/** A panel keeps its frame this long after the agent's last call into its module. */
const MODULE_MS = 8_000;
/** A record stays lit this long after the agent touched it. */
const OBJECT_MS = 20_000;

export interface PresenceSnapshot {
  /** Latest event per working agent, most recent first. */
  agents: AgentPresenceEvent[];
  /** Everything of the last two minutes, most recent first. */
  events: AgentPresenceEvent[];
  modules: ReadonlyMap<string, AgentPresenceEvent>;
  objects: ReadonlyMap<string, AgentPresenceEvent>;
}

const EMPTY: PresenceSnapshot = { agents: [], events: [], modules: new Map(), objects: new Map() };
let snapshot: PresenceSnapshot = EMPTY;
const listeners = new Set<() => void>();

function publish(next: PresenceSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Builds the snapshot from the feed; `serverNow` is the server clock at the moment `now` (client) was read. */
export function presenceSnapshot(events: readonly AgentPresenceEvent[], serverNow: number): PresenceSnapshot {
  if (events.length === 0) return EMPTY;
  const age = (event: AgentPresenceEvent): number => serverNow - Date.parse(event.at);
  const newest = [...events].reverse();
  const agents: AgentPresenceEvent[] = [];
  const seen = new Set<string>();
  const modules = new Map<string, AgentPresenceEvent>();
  const objects = new Map<string, AgentPresenceEvent>();
  for (const event of newest) {
    const key = event.tokenId ?? event.agentName;
    if (age(event) < ACTIVE_MS && !seen.has(key)) {
      seen.add(key);
      agents.push(event);
    }
    if (event.module && age(event) < MODULE_MS && !modules.has(event.module)) modules.set(event.module, event);
    if (event.objectId && event.activity !== "denied" && age(event) < OBJECT_MS && !objects.has(event.objectId)) objects.set(event.objectId, event);
  }
  return { agents, events: newest, modules, objects };
}

/** Query families (`[family, workspaceId, …]`) to reread when an agent changed something in a module. */
const MODULE_QUERIES: Record<string, readonly string[]> = {
  tasks: ["tasks", "project", "projects"],
  notes: ["notes", "project"],
  calendar: ["events"],
  projects: ["projects", "project"]
};

/** Modules an agent changed in events newer than `afterId` (reads and refusals change nothing). */
export function modulesChangedSince(events: readonly AgentPresenceEvent[], afterId: number): string[] {
  const modules = new Set<string>();
  for (const event of events) if (event.id > afterId && event.activity === "writing" && event.module) modules.add(event.module);
  return [...modules];
}

/**
 * Mount once per window (shell, detached panel window): polls the feed and keeps ages ticking while something is fresh.
 * When an agent CHANGED something, the module's lists are reread, so an open panel shows the new task at once instead
 * of on the next manual refresh.
 */
export function AgentPresenceFeed(): null {
  const { workspace } = useActiveWorkspace();
  const presence = useAgentPresence(workspace?.id);
  const [tick, setTick] = useState(0);
  const data = presence.data;
  const receivedAt = presence.dataUpdatedAt;
  const queryClient = useQueryClient();
  const workspaceId = workspace?.id;
  /** Last event already acted on; `null` until the first answer, which is only a baseline (nothing to reread yet). */
  const seenId = useRef<number | null>(null);

  useEffect(() => {
    seenId.current = null;
  }, [workspaceId]);

  useEffect(() => {
    if (!data || !workspaceId) return;
    const latest = data.events.at(-1)?.id ?? 0;
    if (seenId.current !== null) {
      const families = new Set(modulesChangedSince(data.events, seenId.current).flatMap((module) => MODULE_QUERIES[module] ?? [module]));
      if (families.size > 0) {
        void queryClient.invalidateQueries({ predicate: (query) => families.has(String(query.queryKey[0])) && query.queryKey[1] === workspaceId });
      }
    }
    seenId.current = Math.max(seenId.current ?? 0, latest);
  }, [data, workspaceId, queryClient]);

  useEffect(() => {
    if (!data) return publish(EMPTY);
    const offset = Date.parse(data.now) - receivedAt;
    const next = presenceSnapshot(data.events, Date.now() + offset);
    publish(next);
    // While anything is still lit, re-check every second so frames and pills go out on time.
    if (next.events.length > 0 && next.events.some((event) => Date.now() + offset - Date.parse(event.at) < OBJECT_MS)) {
      const timer = setTimeout(() => setTick((value) => value + 1), 1_000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [data, receivedAt, tick]);

  useEffect(() => () => publish(EMPTY), [workspace?.id]);
  return null;
}

export function useAgentPresenceNow(): PresenceSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** The agent working in this module right now, if any. */
export function useAgentModuleTouch(moduleId: string | null | undefined): AgentPresenceEvent | null {
  return useSyncExternalStore(subscribe, () => (moduleId ? snapshot.modules.get(moduleId) ?? null : null), () => null);
}

/** The agent that touched this record in the last few seconds, if any. */
export function useAgentObjectTouch(objectId: string | null | undefined): AgentPresenceEvent | null {
  return useSyncExternalStore(subscribe, () => (objectId ? snapshot.objects.get(objectId) ?? null : null), () => null);
}

const MODULE_WORD: Record<string, string> = {
  tasks: "задачи",
  notes: "заметки",
  calendar: "календарь",
  finance: "финансы",
  projects: "проекты",
  documents: "документы",
  habits: "привычки",
  lists: "списки",
  time: "учёт времени",
  contacts: "контакты",
  goals: "цели",
  inventory: "склад",
  health: "здоровье",
  home: "дом"
};

export function agentLabel(event: AgentPresenceEvent): string {
  return event.assistant ? "Ассистент" : event.agentName;
}

/** «смотрит задачи», «Создал задачу «…»», «предлагает изменение» — one phrase for the pill, frame and feed. */
export function describePresence(event: AgentPresenceEvent): string {
  const what = (event.module && MODULE_WORD[event.module]) || "данные";
  switch (event.activity) {
    case "thinking":
      return "думает над ответом";
    case "reading":
      return `смотрит ${what}`;
    case "writing":
      return event.summary ?? `меняет ${what}`;
    case "proposing":
      return event.summary ? `предлагает: ${event.summary}` : "предлагает изменение — нужно ваше подтверждение";
    case "denied":
      return "получил отказ";
  }
}

export function presenceTone(event: AgentPresenceEvent): "accent" | "warning" | "danger" {
  return event.activity === "proposing" ? "warning" : event.activity === "denied" ? "danger" : "accent";
}

function agentsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "агента";
  return "агентов";
}

const OPENABLE: ReadonlySet<string> = new Set(["task", "note", "event", "document", "project", "contact", "goal", "list"]);

/** The shell's pill: shown only while an agent works; opens the feed of recent actions. */
export function AgentPresencePill({ className }: { className?: string }): React.ReactElement | null {
  const { agents, events } = useAgentPresenceNow();
  if (agents.length === 0) return null;
  const lead = agents[0]!;
  const text = agents.length > 1 ? `${agents.length} ${agentsWord(agents.length)} работают` : `${agentLabel(lead)} · ${describePresence(lead)}`;
  return (
    <Popover
      align="end"
      trigger={({ toggle, ref }) => (
        <StarBorder active className={cx("rounded-full", className)}>
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            aria-label={`ИИ работает: ${text}`}
            className="flex h-7 max-w-[20rem] items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 text-label text-foreground hover:bg-accent/15"
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            <span className="truncate">{text}</span>
          </button>
        </StarBorder>
      )}
    >
      {({ close }) => (
        <div className="w-80 space-y-2 p-3" role="region" aria-label="Что делают агенты">
          <p className="text-label font-medium text-foreground">Что делают агенты</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {events.slice(0, 12).map((event) => (
              <PresenceRow key={event.id} event={event} onOpen={close} />
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              close();
              openSettings("agents", "agents");
            }}
          >
            Открыть настройки ИИ
          </Button>
        </div>
      )}
    </Popover>
  );
}

function PresenceRow({ event, onOpen }: { event: AgentPresenceEvent; onOpen: () => void }): React.ReactElement {
  const openable = event.objectId && event.objectType && OPENABLE.has(event.objectType) && event.activity !== "denied";
  const body = (
    <>
      <span className="font-medium text-foreground">{agentLabel(event)}</span> <span className="text-muted-foreground">{describePresence(event)}</span>
      <span className="block text-2xs text-subtle-foreground">{relativeTime(event.at)}</span>
    </>
  );
  return (
    <li className="text-label">
      {openable ? (
        <button
          type="button"
          className="w-full rounded-md px-2 py-1 text-left hover:bg-card-hover"
          onClick={() => {
            onOpen();
            openEntity(event.objectType as SearchableEntityType, event.objectId as string);
          }}
        >
          {body}
        </button>
      ) : (
        <div className="px-2 py-1">{body}</div>
      )}
    </li>
  );
}

/** Wraps a dock panel: an animated frame and a caption while an agent works in the panel's module. */
export function AgentPanelFrame({ moduleId, children }: { moduleId: string | null | undefined; children: ReactNode }): React.ReactElement {
  const touch = useAgentModuleTouch(moduleId);
  const caption = useMemo(() => (touch ? `${agentLabel(touch)} · ${describePresence(touch)}` : null), [touch]);
  return (
    <div className="relative h-full min-h-0">
      {children}
      {touch ? (
        <>
          <div aria-hidden className="agent-frame" data-tone={presenceTone(touch)} />
          <div aria-hidden className="pointer-events-none absolute bottom-3 right-3 z-20 flex max-w-[60%] items-center gap-1 rounded-full border border-accent/40 bg-panel/95 px-2 py-0.5 text-2xs text-foreground shadow-sm">
            <Bot className="h-3 w-3 shrink-0 text-accent" />
            <span className="truncate">{caption}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** For a list row: the class that lights it up and a short tag, while an agent has just touched the record. */
export function useAgentRowMark(objectId: string | null | undefined): { className: string | undefined; tag: ReactNode } {
  const touch = useAgentObjectTouch(objectId);
  if (!touch) return { className: undefined, tag: null };
  return {
    className: "agent-touched",
    tag: (
      <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/15 px-1.5 text-2xs text-accent" title={`${agentLabel(touch)}: ${describePresence(touch)}`}>
        <Bot className="h-3 w-3" aria-hidden />
        {agentLabel(touch)}
      </span>
    )
  };
}
