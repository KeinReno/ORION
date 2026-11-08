"use client";

import { useAgentPresence } from "@orion/core-react";
import type { AgentPresenceEvent, SearchableEntityType } from "@orion/shared-types";
import { Button, Popover, StarBorder, Switch, cx } from "@orion/ui";
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

/** This computer only. Off until the person asks to watch one named agent. */
const FOLLOW_KEY = "orion.agent.follow.v1";
export interface FollowAgentPrefs {
  on: boolean;
  /** Token id, or `name:<agent>` when the event has no token. Null means nobody is chosen. */
  who: string | null;
}
const FOLLOW_OFF: FollowAgentPrefs = { on: false, who: null };
let followAgent: FollowAgentPrefs = FOLLOW_OFF;
let followHydrated = false;
const followListeners = new Set<() => void>();

export function readStoredFollow(raw: string | null): FollowAgentPrefs {
  if (raw === "1") return { on: true, who: null };
  if (!raw || raw === "0") return FOLLOW_OFF;
  try {
    const parsed = JSON.parse(raw) as { on?: unknown; who?: unknown };
    return { on: parsed.on === true, who: typeof parsed.who === "string" && parsed.who.length > 0 ? parsed.who : null };
  } catch {
    return FOLLOW_OFF;
  }
}

function currentFollow(): FollowAgentPrefs {
  if (!followHydrated && typeof window !== "undefined") {
    try {
      followAgent = readStoredFollow(window.localStorage.getItem(FOLLOW_KEY));
    } catch {
      followAgent = FOLLOW_OFF;
    }
    followHydrated = true;
  }
  return followAgent;
}

function subscribeFollow(listener: () => void): () => void {
  followListeners.add(listener);
  return () => followListeners.delete(listener);
}

function writeFollow(next: FollowAgentPrefs): void {
  followAgent = next;
  followHydrated = true;
  try {
    window.localStorage.setItem(FOLLOW_KEY, JSON.stringify(next));
  } catch {
    /* a private window still follows for this session */
  }
  for (const listener of followListeners) listener();
}

export function setFollowAgent(on: boolean): void {
  writeFollow({ ...currentFollow(), on });
}

export function setFollowedAgent(who: string): void {
  writeFollow({ on: true, who });
}

export function useFollowAgent(): FollowAgentPrefs {
  return useSyncExternalStore(subscribeFollow, currentFollow, () => FOLLOW_OFF);
}

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
    const key = presenceAgentKey(event);
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
  projects: ["projects", "project"],
  habits: ["habits", "habit-entries"],
  lists: ["lists", "list"],
  time: ["time", "time-running", "time-summary"],
  contacts: ["contacts", "contact-interactions"],
  documents: ["documents"],
  inventory: ["inventory-items", "inventory-movements"],
  health: ["health"],
  home: ["home"],
  "pet-care": ["pet-care"]
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
  /** Event ids already considered for opening a record. The first snapshot only fills this set. */
  const followedIds = useRef<Set<number>>(new Set());
  const followReady = useRef(false);
  const follow = useFollowAgent();

  useEffect(() => {
    seenId.current = null;
    followedIds.current = new Set();
    followReady.current = false;
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
    if (!data || !workspaceId) return;
    if (!followReady.current) {
      for (const event of data.events) followedIds.current.add(event.id);
      followReady.current = true;
      return;
    }
    const fresh = data.events.filter((event) => !followedIds.current.has(event.id));
    for (const event of fresh) followedIds.current.add(event.id);
    const target = navigationTarget(fresh, follow);
    if (target) openEntity(target.type, target.id);
  }, [data, workspaceId, follow]);

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

export interface AgentPresenceGroup {
  key: string;
  label: string;
  events: AgentPresenceEvent[];
}

/** One trail per token. Events are newest first, so the first group is the agent who acted last. */
export function groupPresenceByAgent(events: readonly AgentPresenceEvent[], limit = 12): AgentPresenceGroup[] {
  const groups: AgentPresenceGroup[] = [];
  const index = new Map<string, AgentPresenceGroup>();
  let shown = 0;
  for (const event of events) {
    if (shown >= limit) break;
    const key = presenceAgentKey(event);
    let group = index.get(key);
    if (!group) {
      group = { key, label: agentLabel(event), events: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.events.push(event);
    shown += 1;
  }
  return groups;
}

/** Pill caption. Two agents are named, not collapsed into a count. */
export function presencePillText(agents: readonly AgentPresenceEvent[]): string {
  if (agents.length === 0) return "";
  const lead = agents[0]!;
  if (agents.length === 1) return `${agentLabel(lead)} · ${describePresence(lead)}`;
  const names = agents.map((agent) => agentLabel(agent));
  const who = names.length === 2 ? `${names[0]} и ${names[1]}` : `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
  return `${who} работают`;
}

const FOLLOW_TYPES = ["task", "note", "event", "document", "project", "contact", "goal", "list"] as const satisfies readonly SearchableEntityType[];
const OPENABLE: ReadonlySet<string> = new Set(FOLLOW_TYPES);

function isFollowType(value: string): value is (typeof FOLLOW_TYPES)[number] {
  return OPENABLE.has(value);
}

/**
 * Where a followed agent is looking. Only a real read or write of a record the shell can open.
 * A refusal, a proposal, or «thinking» is not a place to open. The shell calls this only while
 * «Следить за агентом» is on; highlight and the feed do not depend on it.
 */
export function followTarget(event: AgentPresenceEvent): { type: SearchableEntityType; id: string } | null {
  if (event.activity !== "reading" && event.activity !== "writing") return null;
  if (!event.objectId || !event.objectType || !isFollowType(event.objectType)) return null;
  return { type: event.objectType, id: event.objectId };
}

/**
 * The one record to open for a fresh batch. Off means no navigation, even when the batch
 * contains a real read. Several records in one poll open only the latest, so a sweep of
 * tasks does not walk the whole dock.
 */
export function presenceAgentKey(event: Pick<AgentPresenceEvent, "tokenId" | "agentName">): string {
  return event.tokenId ?? `name:${event.agentName}`;
}

export function navigationTarget(events: readonly AgentPresenceEvent[], follow: FollowAgentPrefs): { type: SearchableEntityType; id: string } | null {
  if (!follow.on || !follow.who) return null;
  let target: { type: SearchableEntityType; id: string } | null = null;
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (presenceAgentKey(event) !== follow.who) continue;
    const next = followTarget(event);
    if (next) target = next;
  }
  return target;
}

/** The shell's pill: shown only while an agent works; opens the feed of recent actions. */
export function AgentPresencePill({ className }: { className?: string }): React.ReactElement | null {
  const { agents, events } = useAgentPresenceNow();
  const follow = useFollowAgent();
  const followed = events.find((event) => presenceAgentKey(event) === follow.who);
  if (agents.length === 0) return null;
  const text = presencePillText(agents);
  const groups = groupPresenceByAgent(events);
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
          <div className="flex items-start justify-between gap-3">
            <p className="text-label font-medium text-foreground">Что делают агенты</p>
            <FollowAgentSwitch checked={follow.on} />
          </div>
          <p className="text-2xs text-muted-foreground">{followHint(follow, followed ? agentLabel(followed) : null)}</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {groups.map((group) => (
              <li key={group.key}>
                <div className="flex items-center justify-between gap-2 px-2">
                  <p className="text-2xs font-medium text-subtle-foreground">{group.label}</p>
                  <button
                    type="button"
                    className="text-2xs text-accent hover:underline"
                    aria-pressed={follow.on && follow.who === group.key}
                    onClick={() => setFollowedAgent(group.key)}
                  >
                    {follow.on && follow.who === group.key ? "Слежу" : "Следить"}
                  </button>
                </div>
                <ul className="space-y-1">
                  {group.events.map((event) => (
                    <PresenceRow key={event.id} event={event} onOpen={close} hideAgent />
                  ))}
                </ul>
              </li>
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

function followHint(follow: FollowAgentPrefs, whoLabel: string | null): string {
  if (!follow.on) return "Только подсветка и эта лента. Экран сам не переключается.";
  if (!follow.who || !whoLabel) return "Слежение включено, агент не выбран. Нажмите «Следить» у нужного имени — чужие действия экран не откроют.";
  return `Экран открывает записи агента «${whoLabel}». Остальные остаются в ленте.`;
}

function FollowAgentSwitch({ checked }: { checked: boolean }): React.ReactElement {
  return <Switch checked={checked} onChange={setFollowAgent} label="Следить за агентом" />;
}

/** Same switch as the pill, for the settings page where no agent is working yet. */
export function FollowAgentControl(): React.ReactElement {
  const follow = useFollowAgent();
  const { events } = useAgentPresenceNow();
  const followed = events.find((event) => presenceAgentKey(event) === follow.who);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="text-label text-foreground">Следить за агентом</p>
        <p className="text-2xs text-muted-foreground">{followHint(follow, followed ? agentLabel(followed) : null)} Кого именно — кнопка «Следить» в ленте.</p>
      </div>
      <FollowAgentSwitch checked={follow.on} />
    </div>
  );
}

function PresenceRow({ event, onOpen, hideAgent = false }: { event: AgentPresenceEvent; onOpen: () => void; hideAgent?: boolean }): React.ReactElement {
  const openable = event.objectId && event.objectType && OPENABLE.has(event.objectType) && event.activity !== "denied";
  const body = (
    <>
      {hideAgent ? null : <span className="font-medium text-foreground">{agentLabel(event)} </span>}
      <span className="text-muted-foreground">{describePresence(event)}</span>
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

/**
 * Legal way to mark one row inside `.map`: the presence hook lives in this component,
 * the row receives the class and the tag through the render prop.
 */
export function AgentTouchSlot({
  objectId,
  children
}: {
  objectId: string;
  children: (mark: { className: string | undefined; tag: ReactNode }) => ReactNode;
}): React.ReactElement {
  const mark = useAgentRowMark(objectId);
  return <>{children(mark)}</>;
}

/** For a list row: the class that lights it up and a short tag, while an agent has just touched the record. */
export function useAgentRowMark(objectId: string | null | undefined): { className: string | undefined; tag: ReactNode } {
  const touch = useAgentObjectTouch(objectId);
  if (!touch) return { className: undefined, tag: null };
  return {
    className: "agent-touched",
    tag: (
      <span className="ml-1 inline-flex max-w-[16rem] shrink-0 items-center gap-0.5 rounded-full bg-accent/15 px-1.5 text-2xs text-accent" title={`${agentLabel(touch)}: ${describePresence(touch)}`}>
        <Bot className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{agentLabel(touch)} · {describePresence(touch)}</span>
      </span>
    )
  };
}
