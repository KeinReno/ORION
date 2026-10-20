import { Injectable } from "@nestjs/common";
import type { AgentPresence, AgentPresenceActivity, AgentPresenceEvent } from "@orion/shared-types";

/** How long an action stays in the live feed; the interface decides what of it is still «now». */
const WINDOW_MS = 2 * 60 * 1000;
const MAX_PER_WORKSPACE = 60;

interface StoredEvent extends AgentPresenceEvent {
  workspaceId: string;
  /** The member the agent acts as: only they see its live activity (the same rule as the journal). */
  userId: string;
  atMs: number;
}

export interface PresenceInput {
  workspaceId: string;
  userId: string;
  tokenId: string | null;
  agentName: string;
  assistant: boolean;
  activity: AgentPresenceActivity;
  module: string | null;
  summary: string | null;
  objectType: string | null;
  objectId: string | null;
}

/** Reads end in a verb like list/get/search; anything else that succeeded changed something. */
const READ_ACTION = /(^|[._])(list|get|search|context|read|manual|peers|messages|whoami|overview)s?$/i;

export function presenceActivity(action: string, status: number, wrote: boolean): AgentPresenceActivity {
  if (status === 202) return "proposing";
  if (status >= 400) return "denied";
  if (wrote) return "writing";
  return READ_ACTION.test(action) ? "reading" : "writing";
}

/** `task:<id>` / `note:<id>` → the object the call was about. */
export function objectOfResource(resource: string | null): { type: string; id: string } | null {
  const match = resource ? /^([a-z_]+):([^:/\s]+)$/i.exec(resource) : null;
  return match ? { type: match[1]!, id: match[2]! } : null;
}

/**
 * What agents are doing right now (TZ: «индикация работы агентов»). The journal (`agent_audit_entries`) is the durable
 * record; this is a small in-memory feed of the last two minutes, so the interface can poll it every couple of seconds
 * and draw who is reading or changing what. Lost on restart by design — nothing here is a source of truth.
 */
@Injectable()
export class AgentPresenceService {
  private readonly feed = new Map<string, StoredEvent[]>();
  private seq = 0;

  push(input: PresenceInput): void {
    const now = Date.now();
    const events = (this.feed.get(input.workspaceId) ?? []).filter((event) => now - event.atMs < WINDOW_MS);
    events.push({
      id: ++this.seq,
      workspaceId: input.workspaceId,
      userId: input.userId,
      tokenId: input.tokenId,
      agentName: input.agentName,
      assistant: input.assistant,
      activity: input.activity,
      module: input.module,
      summary: input.summary,
      objectType: input.objectType,
      objectId: input.objectId,
      at: new Date(now).toISOString(),
      atMs: now
    });
    this.feed.set(input.workspaceId, events.slice(-MAX_PER_WORKSPACE));
  }

  /** The caller's own agents in this workspace (membership is checked by the caller), newest last. */
  recent(workspaceId: string, userId: string): AgentPresence {
    const now = Date.now();
    const events = (this.feed.get(workspaceId) ?? [])
      .filter((event) => event.userId === userId && now - event.atMs < WINDOW_MS)
      .map(({ workspaceId: _workspace, userId: _user, atMs: _at, ...event }) => event);
    return { now: new Date(now).toISOString(), events };
  }
}
