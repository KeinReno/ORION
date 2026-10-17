"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ObjectOpenMode, SearchableEntityType, ViewRef } from "@orion/shared-types";
import { createIntentChannel, type IntentChannel } from "./intent-channel";
import { getActiveWorkspaceId } from "./use-active-workspace";

/**
 * Panels used to talk to each other through the URL (Calendar linked to
 * `/tasks?focus=id`). Since v0.5 panels live inside one persistent
 * Workbench dock instead of routes, there's no URL to carry that anymore —
 * this is the replacement: a tiny in-memory pub/sub, deliberately not a
 * state library. Signals are fire-and-forget ("focus this task", "show
 * this project's board") — not a store.
 *
 * `registerPanelBus` is called once by the Workbench layout, after the
 * DockviewApi is ready, so any panel can ask to open/focus another panel
 * without importing dockview or the panel registry itself.
 */
interface PanelBus {
  /** `title` names the dock tab when the panel is created (instanced panels, e.g. a project's name). */
  openPanel: (panelId: string, title?: string) => void;
  openObject?: (view: ViewRef, mode: ObjectOpenMode, title?: string) => void;
}

let bus: PanelBus | null = null;
const busListeners = new Set<() => void>();
const subscribeBus = (listener: () => void) => { busListeners.add(listener); return () => { busListeners.delete(listener); }; };

export function registerPanelBus(impl: PanelBus): () => void {
  bus = impl;
  for (const listener of busListeners) listener();
  return () => {
    if (bus !== impl) return;
    bus = null;
    for (const listener of busListeners) listener();
  };
}

/** Detached single-panel windows have no dock host: don't offer commands they cannot execute. */
export function useObjectOpeningAvailable(): boolean {
  return useSyncExternalStore(subscribeBus, () => Boolean(bus?.openObject), () => false);
}

/** Open (or focus, if already open) a panel by id — e.g. from a sidebar click or a redirect stub. */
export function openPanel(panelId: string, title?: string): void {
  bus?.openPanel(panelId, title);
}

/** Explicit standalone opening. Existing openEntity/focus behavior stays compatible. */
export function openObject(view: ViewRef, mode: ObjectOpenMode = "tab", title?: string): void {
  bus?.openObject?.(view, mode, title);
}

/**
 * A project opens as its own dock tab (`project:<id>`), not a Sheet over the
 * project list: it is a container you work inside, so it gets the full width
 * and can sit next to Tasks or another project. Opening the same project
 * twice just focuses its tab. `title` is only a first-paint hint — the panel
 * renames its tab from the loaded project itself.
 */
export function openProject(projectId: string, title?: string): void {
  openPanel(`project:${projectId}`, title);
}

/**
 * A list opens as its own dock tab (`list:<id>`): a full-width view with every entry, groups,
 * drag-reorder and the entry editor — the card on the board only previews it. Opening the same list
 * twice just focuses its tab; `title` is a first-paint hint, the panel renames the tab itself.
 */
export function openList(listId: string, title?: string): void {
  openPanel(`list:${listId}`, title);
}

/**
 * S09 — "lost intent": `focusTask(id)` used to just loop over whatever
 * listeners happened to be subscribed at that exact instant. If the target
 * panel hadn't mounted yet (e.g. it's being opened for the first time by
 * this very call, and React hasn't committed/rendered it yet), there were
 * zero listeners, the loop was a no-op, and the click was silently lost —
 * the panel opened but never focused/selected the entity. A fixed
 * `setTimeout` "fix" would just trade a reliable bug for a flaky one (real
 * mount latency is unbounded, not a constant).
 *
 * Fix (see `intent-channel.ts` for the framework-free, unit-tested core):
 * a one-slot "pending intent" per channel, stamped with the workspace that
 * was active at emit time, held until a listener mounts to consume it.
 * `getActiveWorkspaceId()` (the same synchronous store the workspace
 * switcher writes to) is read both at emit time and at consume time, so an
 * intent stamped in workspace W1 does not get applied to a panel that
 * mounts after the user has already switched to W2.
 */
function useIntent<T>(channel: IntentChannel<T>): T | null {
  const [current, setCurrent] = useState<T | null>(null);
  useEffect(() => {
    const applied = channel.consumePending(getActiveWorkspaceId());
    if (applied !== null) setCurrent(applied);
    return channel.subscribe(setCurrent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return current;
}

function makeIntentChannel<T>(panelId: string | null): {
  emit: (value: T) => void;
  useIntent: () => T | null;
} {
  const channel = createIntentChannel<T>();
  return {
    emit(value: T): void {
      if (panelId) openPanel(panelId);
      channel.emit(value, getActiveWorkspaceId());
    },
    useIntent: () => useIntent(channel)
  };
}

function makeFocusChannel(panelId: string): {
  focus: (id: string) => void;
  useFocusedId: () => string | null;
} {
  const channel = makeIntentChannel<string>(panelId);
  return { focus: channel.emit, useFocusedId: channel.useIntent };
}

const taskChannel = makeFocusChannel("tasks");
const noteChannel = makeFocusChannel("notes");
export interface EntityFocusRequest { id: string; nonce: number; workspaceId: string | null }
const eventChannel = makeIntentChannel<EntityFocusRequest>("calendar");
const documentChannel = makeFocusChannel("documents");
const transactionChannel = makeIntentChannel<EntityFocusRequest>("finance");
const contactChannel = makeIntentChannel<EntityFocusRequest>("contacts");
const goalChannel = makeFocusChannel("goals");
let focusNonce = 0;
const browserChannel = makeIntentChannel<{ url: string; nonce: number }>("browser");
let browserNonce = 0;

/** Open a web page in ORION's built-in browser (a new tab there; the panel is opened/focused first). */
export function openInBrowser(url: string): void {
  browserNonce += 1;
  browserChannel.emit({ url, nonce: browserNonce });
}
/** BrowserPanel reads the latest request; `nonce` tells a repeated URL from an old one. */
export const useBrowserRequest = browserChannel.useIntent;

/** Calendar (or anything else) calls this to jump to a task in the Tasks panel. */
export const focusTask = taskChannel.focus;
/** TasksPanel subscribes to this instead of reading `?focus=` from the URL. */
export const useFocusedTaskId = taskChannel.useFocusedId;

/** Open the Notes panel and select a note by id (e.g. from the ⌘K palette or dashboard). */
export const focusNote = noteChannel.focus;
export const useFocusedNoteId = noteChannel.useFocusedId;

/** Open the Calendar panel and select an event (notification bell, inbox). */
export function focusEvent(id: string): void { eventChannel.emit({ id, nonce: ++focusNonce, workspaceId: getActiveWorkspaceId() }); }
export const useEventFocusRequest = eventChannel.useIntent;

/**
 * U02 (24-CONNECTED-CORE-BACKLOG.md) — the connected-materials block
 * (`EntityLinksSection`) needs to open a linked document or transaction the
 * same way it already opens a linked task/note/event: through the panel bus,
 * never a new navigation mechanism. Mirrors `taskChannel`/`noteChannel`
 * above exactly.
 */
export const focusDocument = documentChannel.focus;
export const useFocusedDocumentId = documentChannel.useFocusedId;

export function focusTransaction(id: string): void { transactionChannel.emit({ id, nonce: ++focusNonce, workspaceId: getActiveWorkspaceId() }); }
export const useTransactionFocusRequest = transactionChannel.useIntent;

/** Open the Contacts panel on one contact; a nonce so re-opening the same contact still applies. */
export function focusContact(id: string): void { contactChannel.emit({ id, nonce: ++focusNonce, workspaceId: getActiveWorkspaceId() }); }
export const useContactFocusRequest = contactChannel.useIntent;

export const focusGoal = goalChannel.focus;
export const useFocusedGoalId = goalChannel.useFocusedId;

/** Entity links address every type the same way; a project's "focus" is its own tab. */
export function focusProject(projectId: string): void {
  openProject(projectId);
}

/**
 * The one way to jump to a record of any searchable type: search hits,
 * linked-record lists, notifications and project materials all used to carry
 * their own `if (type === …)` chain (and the palette forgot events, documents
 * and transactions — it opened the panel but never selected the record).
 * Like every focus helper this is navigation only: the target panel loads the
 * record through its own access-checked API, so a link never widens access.
 */
export function openEntity(type: SearchableEntityType, id: string, title?: string): void {
  switch (type) {
    case "task":
      focusTask(id);
      return;
    case "note":
      focusNote(id);
      return;
    case "event":
      focusEvent(id);
      return;
    case "document":
      focusDocument(id);
      return;
    case "transaction":
      focusTransaction(id);
      return;
    case "project":
      openProject(id, title);
      return;
    case "goal":
      focusGoal(id);
      return;
    case "contact":
      focusContact(id);
      return;
    case "list":
      openList(id, title);
      return;
    case "account":
      // Accounts have no page of their own: Finance opens, the account lives on its «Счета» tab.
      openPanel("finance");
      return;
    case "savings_goal":
      openPanel("view:finance~goals", "Финансы · Цели");
      return;
  }
}

/**
 * "Open the tasks board filtered to this project." A nonce (`at`) so clicking
 * the same project twice still retriggers the panel (React would ignore an
 * unchanged `{ projectId }` state).
 */
export interface TasksProjectSignal {
  projectId: string;
  at: number;
}

const tasksProjectChannel = makeIntentChannel<TasksProjectSignal>("tasks");

export function showTasksForProject(projectId: string): void {
  tasksProjectChannel.emit({ projectId, at: Date.now() });
}

export const useTasksProjectSignal = tasksProjectChannel.useIntent;
