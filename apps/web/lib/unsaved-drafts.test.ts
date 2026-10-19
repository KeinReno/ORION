import { afterEach, describe, expect, it, vi } from "vitest";

const setActive = vi.fn();
let activeId: string | null = null;
vi.mock("./use-active-workspace", () => ({ setActiveWorkspaceId: (id: string) => setActive(id), getActiveWorkspaceId: () => activeId }));

import { cancelPendingSwitch, confirmPendingSwitch, hasUnsavedDrafts, registerDraft, requestWorkspaceSwitch } from "./unsaved-drafts";

afterEach(() => {
  cancelPendingSwitch();
  setActive.mockReset();
  activeId = null;
  delete (globalThis as { window?: unknown }).window;
});

describe("unsaved drafts guard", () => {
  it("switches at once when nothing is unsaved", () => {
    expect(hasUnsavedDrafts()).toBe(false);
    requestWorkspaceSwitch("ws-2");
    expect(setActive).toHaveBeenCalledWith("ws-2");
  });

  it("holds the switch while a draft exists, and only a confirm lets it through", () => {
    const release = registerDraft("capture");
    expect(hasUnsavedDrafts()).toBe(true);
    requestWorkspaceSwitch("ws-2");
    expect(setActive).not.toHaveBeenCalled();
    confirmPendingSwitch();
    expect(setActive).toHaveBeenCalledWith("ws-2");
    // Confirming discards the drafts: the fields remount empty in the new workspace.
    expect(hasUnsavedDrafts()).toBe(false);
    release();
  });

  it("cancel keeps the user where they are", () => {
    const release = registerDraft("note");
    requestWorkspaceSwitch("ws-3");
    cancelPendingSwitch();
    expect(setActive).not.toHaveBeenCalled();
    expect(hasUnsavedDrafts()).toBe(true);
    release();
  });

  it("a cleared draft no longer blocks", () => {
    const release = registerDraft("comment");
    release();
    requestWorkspaceSwitch("ws-4");
    expect(setActive).toHaveBeenCalledWith("ws-4");
  });

  it("guards only the dock tab that owns a draft while still guarding workspace switches", () => {
    const release = registerDraft("unsaved-note", "notes");
    expect(hasUnsavedDrafts("notes")).toBe(true);
    expect(hasUnsavedDrafts("documents")).toBe(false);
    requestWorkspaceSwitch("ws-5");
    expect(setActive).not.toHaveBeenCalled();
    cancelPendingSwitch();
    release();
  });

  it("asks before leaving a workspace whose persisted draft has not been mounted yet (fast switch after a reload)", () => {
    activeId = "ws-1";
    const entries: Record<string, string> = { "orion.draft.v1:ws-1:capture": JSON.stringify({ text: "Черновик" }) };
    const keys = Object.keys(entries);
    (globalThis as { window?: unknown }).window = {
      localStorage: { length: keys.length, key: (index: number) => keys[index] ?? null, getItem: (key: string) => entries[key] ?? null }
    };
    expect(hasUnsavedDrafts()).toBe(false);
    requestWorkspaceSwitch("ws-2");
    expect(setActive).not.toHaveBeenCalled();
    confirmPendingSwitch();
    expect(setActive).toHaveBeenCalledWith("ws-2");
  });
});
