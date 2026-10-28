import type { FeedbackKind } from "@orion/shared-types";

/**
 * ORION-20: a bug/idea report used to live only in the dialog's own React state — closing it (even
 * by clicking the backdrop after a failed send) lost the typed text for good, and a failed send had
 * no way back except retyping it. This is the local draft/retry queue that fixes that: a failed send
 * is pushed here immediately, survives a reload (localStorage), and can be resent — or discarded —
 * later. Pure array operations, thin localStorage wrappers around them (same split as
 * `project-order.ts`'s pin/order helpers).
 *
 * What this does NOT claim: server-side idempotency. A resend after a send that actually succeeded
 * but whose response never reached the client (a rare mid-response drop) can create a second GitHub
 * issue — the queue only guarantees a report is never silently lost, not that a retry can never
 * double-post. A real dedup needs the server to search GitHub for a marker before creating, a
 * separate, heavier change than this pass.
 */
export const FEEDBACK_QUEUE_KEY = "orion.feedback.queue";

export interface QueuedFeedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export function enqueueFeedback(queue: readonly QueuedFeedback[], item: { id: string; kind: FeedbackKind; message: string; createdAt: string }): QueuedFeedback[] {
  return [...queue, { ...item, attempts: 0, lastError: null }];
}

export function dequeueFeedback(queue: readonly QueuedFeedback[], id: string): QueuedFeedback[] {
  return queue.filter((item) => item.id !== id);
}

export function markFeedbackAttempt(queue: readonly QueuedFeedback[], id: string, error: string): QueuedFeedback[] {
  return queue.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1, lastError: error } : item));
}

export function loadFeedbackQueue(): QueuedFeedback[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is QueuedFeedback => typeof item === "object" && item !== null && typeof (item as QueuedFeedback).id === "string");
  } catch {
    return [];
  }
}

export function saveFeedbackQueue(queue: readonly QueuedFeedback[]): void {
  try {
    localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* a lost queue save just means the next failed send starts the list over */
  }
}
