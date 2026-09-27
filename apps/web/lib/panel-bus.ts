"use client";

import { useEffect, useState } from "react";
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
}

let bus: PanelBus | null = null;

export function registerPanelBus(impl: PanelBus): void {
  bus = impl;
}

/** Open (or focus, if already open) a panel by id — e.g. from a sidebar click or a redirect stub. */
export function openPanel(panelId: string, title?: string): void {
  bus?.openPanel(panelId, title);
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
const eventChannel = makeFocusChannel("calendar");
const documentChannel = makeFocusChannel("documents");
const transactionChannel = makeFocusChannel("finance");

/** Calendar (or anything else) calls this to jump to a task in the Tasks panel. */
export const focusTask = taskChannel.focus;
/** TasksPanel subscribes to this instead of reading `?focus=` from the URL. */
export const useFocusedTaskId = taskChannel.useFocusedId;

/** Open the Notes panel and select a note by id (e.g. from the ⌘K palette or dashboard). */
export const focusNote = noteChannel.focus;
export const useFocusedNoteId = noteChannel.useFocusedId;

/** Open the Calendar panel and select an event (notification bell, inbox). */
export const focusEvent = eventChannel.focus;
export const useFocusedEventId = eventChannel.useFocusedId;

/**
 * U02 (24-CONNECTED-CORE-BACKLOG.md) — the connected-materials block
 * (`EntityLinksSection`) needs to open a linked document or transaction the
 * same way it already opens a linked task/note/event: through the panel bus,
 * never a new navigation mechanism. Mirrors `taskChannel`/`noteChannel`
 * above exactly.
 */
export const focusDocument = documentChannel.focus;
export const useFocusedDocumentId = documentChannel.useFocusedId;

export const focusTransaction = transactionChannel.focus;
export const useFocusedTransactionId = transactionChannel.useFocusedId;

/** Entity links address every type the same way; a project's "focus" is its own tab. */
export function focusProject(projectId: string): void {
  openProject(projectId);
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
