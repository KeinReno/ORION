import { describe, expect, it } from "vitest";
import { activeWorkspaceStorageKey } from "./use-active-workspace";

/**
 * U04 — pure key-composition test for the sessionStorage key
 * `use-active-workspace.ts` now reads/writes the active workspace choice
 * under, replacing the single global `orion:active-workspace-id`
 * `localStorage` key (confirmed gap, 12-PROGRESS.md U00 entry). The module
 * itself also switches storage backend (localStorage → sessionStorage),
 * which is what actually gives per-window isolation natively — this test
 * only proves the key-composition half is correct and deterministic, since
 * exercising real `sessionStorage` cross-tab isolation needs an actual
 * browser (not available in this vitest `node` environment — see
 * `window-context.test.ts`'s doc comment and 12-PROGRESS.md's U04 entry for
 * the honest limitation).
 */
describe("activeWorkspaceStorageKey (pure)", () => {
  it("scopes the key by windowId", () => {
    expect(activeWorkspaceStorageKey("window-1")).toBe("orion:active-workspace:window-1");
  });

  it("two different windowIds produce two different keys — the core U04 fix", () => {
    const keyA = activeWorkspaceStorageKey("window-A");
    const keyB = activeWorkspaceStorageKey("window-B");
    expect(keyA).not.toBe(keyB);
  });

  it("the same windowId always maps to the same key (stable across reloads of the same tab)", () => {
    expect(activeWorkspaceStorageKey("window-1")).toBe(activeWorkspaceStorageKey("window-1"));
  });
});
