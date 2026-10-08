/**
 * S11 — serialized autosave with trailing drain + CAS, extracted out of
 * `NoteEditor` so the concurrency logic can be unit-tested with fake timers
 * and controlled/deferred promises, without React or a real network.
 *
 * The bug this replaces (see docs/SONNET_IMPLEMENTATION/15-FIRST-TASKS.md
 * "S11: autosave trailing drain"): the previous `NoteEditor` guarded autosave
 * with a single `savingRef` boolean and *skipped* the debounce trigger
 * outright while a save was in flight. If the user kept typing during that
 * window, the next debounce firing landed on `savingRef.current === true`,
 * did nothing, and — unless the user typed again to re-arm the debounce —
 * the newest content was silently never sent. There was also no revision
 * check (two tabs could clobber each other) and a rejected save had no
 * recoverable state (no draft, no retry, no distinguishing stale content).
 *
 * Model: `latest` (whatever the caller last handed us via `setSnapshot`) vs.
 * `lastAcknowledged` (the snapshot the server has actually confirmed, by
 * revision). At most one save is ever in flight. When a save completes:
 *   - success updates `lastAcknowledged`/`revision` from the *response*, not
 *     optimistically from what was sent, and if `latest` has moved on since
 *     the request was built, a new save is sent immediately (no additional
 *     debounce wait, no user input needed) — the "trailing drain".
 *   - failure leaves `lastAcknowledged`/`revision` untouched, reports the
 *     error, and does NOT auto-retry (no infinite retry loop). `retry()`
 *     re-sends whatever `latest` is *right now* (not the stale rejected
 *     snapshot) with the current (pre-failure) revision.
 */

export type AutosaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface AutosaveSnapshot {
  title: string;
  summary: string;
  body: string;
  tags: string[];
  eventAt: string | null;
  projectId: string | null;
}

export interface AutosaveIdentity {
  workspaceId: string;
  noteId: string;
}

export interface SaveAck {
  revision: number;
}

/** Thrown by `save` when the server rejects on a stale `expectedRevision` (HTTP 409). */
export interface AutosaveConflict {
  readonly conflict: true;
  currentRevision: number;
  /** Server's current content, for a "reload the latest version" conflict UI. */
  current: AutosaveSnapshot;
}

export function isAutosaveConflict(err: unknown): err is AutosaveConflict {
  return typeof err === "object" && err !== null && (err as { conflict?: unknown }).conflict === true;
}

/**
 * Narrows an `ApiError.details` payload (raw JSON body of a 409) to the
 * shape `NotesService.update` throws on a CAS mismatch — see
 * `noteConflictSchema` in `packages/shared-types/src/note.ts`. Kept here
 * (not in the panel) so the "does this 409 mean a revision conflict"
 * decision has exactly one implementation.
 */
export function isNoteConflictPayload(
  payload: unknown
): payload is { code: "note_revision_conflict"; currentRevision: number; current: AutosaveSnapshot & { [k: string]: unknown } } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { code?: unknown }).code === "note_revision_conflict" &&
    typeof (payload as { currentRevision?: unknown }).currentRevision === "number"
  );
}

function sameSnapshot(a: AutosaveSnapshot | null, b: AutosaveSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.body === b.body &&
    a.eventAt === b.eventAt &&
    a.projectId === b.projectId &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i])
  );
}

export interface NoteAutosaveOptions {
  debounceMs: number;
  revision: number;
  /** Content at mount — the initial `lastAcknowledged` baseline (nothing dirty yet). */
  initial: AutosaveSnapshot;
  save: (identity: AutosaveIdentity, snapshot: AutosaveSnapshot, expectedRevision: number) => Promise<SaveAck>;
  onStateChange: (state: AutosaveState) => void;
  /** Fired only on a successful ack — the moment "Сохранено" is allowed to appear. */
  onSaved?: (revision: number) => void;
  onError?: (err: unknown) => void;
  /** A 409 (two clients editing the same note) — distinct from a transient network error: retrying blind would just conflict again, so no auto/normal retry is offered, only the caller's conflict UI (reload/overwrite). */
  onConflict?: (conflict: AutosaveConflict) => void;
}

/**
 * One controller per open note. The panel must create a fresh instance (and
 * `dispose()` the old one) whenever `noteId`/`workspaceId` changes — a save
 * started for note A must never land on note B's state after the user
 * switches, and `dispose()` is exactly the guard that drops such a stale
 * in-flight result (also covers the plain component-unmount case).
 */
export class NoteAutosave {
  private readonly identity: AutosaveIdentity;
  private readonly opts: NoteAutosaveOptions;
  private latest: AutosaveSnapshot;
  private lastAcknowledged: AutosaveSnapshot;
  private revision: number;
  private inFlight = false;
  private hasError = false;
  private hasConflict = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(identity: AutosaveIdentity, opts: NoteAutosaveOptions) {
    this.identity = identity;
    this.opts = opts;
    this.latest = opts.initial;
    this.lastAcknowledged = opts.initial;
    this.revision = opts.revision;
  }

  /** Call on every keystroke/field change. Debounces, then (re)triggers a send. */
  setSnapshot(snapshot: AutosaveSnapshot): void {
    if (this.disposed) return;
    this.latest = snapshot;
    this.hasError = false;
    // A conflict is a real fork the user must resolve explicitly (reload
    // server content or overwrite it); typing more doesn't clear it — only
    // `adoptServerState`/`overwrite` (via a fresh `retry()` after choosing to
    // overwrite) does.
    if (this.timer) clearTimeout(this.timer);
    if (sameSnapshot(this.latest, this.lastAcknowledged)) {
      // Typed back to the acknowledged content — nothing to schedule.
      this.emitState();
      return;
    }
    this.emitState();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.trigger();
    }, this.opts.debounceMs);
  }

  /** User-initiated retry after an error — sends the *current* latest snapshot, not the failed one. */
  retry(): void {
    if (this.disposed) return;
    this.hasError = false;
    this.hasConflict = false;
    void this.trigger();
  }

  /** Explicit save (submit button / Ctrl+S) — skip the debounce wait, send right away. */
  flush(): void {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.trigger();
  }

  currentRevision(): number {
    return this.revision;
  }

  /**
   * Conflict resolution "keep my edits, overwrite theirs": adopt the
   * server's revision as the new CAS baseline WITHOUT touching `latest` (the
   * user's in-progress content) or `lastAcknowledged` — so the next
   * `retry()`/drain sends the user's own content against a revision that
   * will actually match. Deliberately separate from `adoptServerState`,
   * which does the opposite (discards local edits, keeps server content).
   */
  forceRevision(revision: number): void {
    if (this.disposed) return;
    this.revision = revision;
    this.hasConflict = false;
    this.hasError = false;
  }

  /** After a conflict is resolved by accepting the server's version — resets the CAS baseline in place. */
  adoptServerState(snapshot: AutosaveSnapshot, revision: number): void {
    if (this.disposed) return;
    this.lastAcknowledged = snapshot;
    this.latest = snapshot;
    this.revision = revision;
    this.hasError = false;
    this.hasConflict = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emitState();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private emitState(): void {
    if (this.disposed) return;
    if (this.hasConflict) this.opts.onStateChange("conflict");
    else if (this.hasError) this.opts.onStateChange("error");
    else if (this.inFlight) this.opts.onStateChange("saving");
    else this.opts.onStateChange(sameSnapshot(this.latest, this.lastAcknowledged) ? "saved" : "dirty");
  }

  private async trigger(): Promise<void> {
    // Serialization: never more than one in-flight save. A trigger that
    // lands while one is already running is a no-op — the in-flight save's
    // own completion handler re-checks `latest` and drains if needed, so
    // nothing is lost, it's just deferred to that point instead of racing.
    if (this.inFlight || this.disposed) return;
    if (sameSnapshot(this.latest, this.lastAcknowledged)) return;

    this.inFlight = true;
    const toSend = this.latest;
    const expectedRevision = this.revision;
    this.emitState();

    try {
      const ack = await this.opts.save(this.identity, toSend, expectedRevision);
      if (this.disposed) return;
      this.revision = ack.revision;
      this.lastAcknowledged = toSend;
      this.hasError = false;
      this.opts.onSaved?.(ack.revision);
    } catch (err) {
      if (this.disposed) return;
      if (isAutosaveConflict(err)) {
        this.hasConflict = true;
        this.opts.onConflict?.(err);
      } else {
        this.hasError = true;
        this.opts.onError?.(err);
      }
    } finally {
      if (!this.disposed) this.inFlight = false;
    }

    if (this.disposed) return;

    if (!this.hasError && !this.hasConflict && !sameSnapshot(this.latest, this.lastAcknowledged)) {
      // Trailing drain: content moved on while this save was in flight —
      // send it now, with no extra debounce wait and no user input.
      void this.trigger();
      return;
    }
    this.emitState();
  }
}
