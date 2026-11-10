import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Text typed into a small field (the capture box, a task comment) and not saved yet is also kept in the browser's
 * storage, per workspace, so a crash or a closed window does not lose it. It is dropped as soon as the field is empty
 * again — sending or clearing the text is what clears it. A convenience: unavailable storage just means no restore.
 * Long note bodies are not kept here: they autosave to the server.
 */
export const DRAFT_MAX_LENGTH = 20_000;
const DRAFTS_PREFIX = "orion.draft.v1:";

export function draftStorageKey(workspaceId: string, name: string): string {
  return `${DRAFTS_PREFIX}${workspaceId}:${name}`;
}

export function readDraft(storage: Pick<Storage, "getItem">, key: string): string {
  try {
    const raw = JSON.parse(storage.getItem(key) ?? "null") as { text?: unknown } | null;
    return raw && typeof raw.text === "string" ? raw.text.slice(0, DRAFT_MAX_LENGTH) : "";
  } catch {
    return "";
  }
}

/** Stores `text`, or removes the entry when it is blank. */
export function writeDraft(storage: Pick<Storage, "setItem" | "removeItem">, key: string, text: string): void {
  try {
    if (text.trim() === "") storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ text: text.slice(0, DRAFT_MAX_LENGTH), savedAt: Date.now() }));
  } catch {
    /* a convenience only */
  }
}

/** Like `useState("")`, but the value is restored on mount and kept in storage while it is not blank. */
export function usePersistedDraft(workspaceId: string | undefined, name: string): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState("");
  const key = workspaceId ? draftStorageKey(workspaceId, name) : null;
  const skipWrite = useRef(true);
  // Restore after mount (not in the initial state): the server render has no storage, and a different first render would not hydrate.
  useEffect(() => {
    skipWrite.current = true;
    if (!key) return;
    const stored = readDraft(window.localStorage, key);
    if (stored) setValue(current => (current === "" ? stored : current));
  }, [key]);
  useEffect(() => {
    // The run that follows a (re)load still sees the empty field and would delete what was just restored.
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    if (key) writeDraft(window.localStorage, key, value);
  }, [key, value]);
  return [value, setValue];
}

/**
 * Does this workspace have a non-empty persisted draft (capture, a comment…)? Lets a workspace
 * switch ask before leaving even when the panel that owns the draft has not mounted yet after a
 * reload — the registry in `unsaved-drafts.ts` only knows mounted editors, so a fast switch right
 * after a reload used to slip past the question.
 */
export function hasStoredDraft(storage: Pick<Storage, "length" | "key" | "getItem">, workspaceId: string): boolean {
  const prefix = draftStorageKey(workspaceId, "");
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && readDraft(storage, key).trim() !== "") return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Does any workspace have a persisted non-empty draft? Used before closing the whole app. */
export function hasAnyStoredDraft(storage: Pick<Storage, "length" | "key" | "getItem">): boolean {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFTS_PREFIX) && readDraft(storage, key).trim() !== "") return true;
    }
  } catch {
    return false;
  }
  return false;
}
