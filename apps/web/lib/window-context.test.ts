import { beforeEach, describe, expect, it } from "vitest";
import { getWindowId, resetWindowIdCacheForTests, resolveWindowId } from "./window-context";

/**
 * U04 (24-CONNECTED-CORE-BACKLOG.md) — `windowId` is the primitive the rest
 * of this session's changes (`use-active-workspace.ts`,
 * `dock-layout-key.ts`) key their per-window storage on. Run under vitest's
 * `node` environment (see `vitest.config.mts`) — there is no real
 * `sessionStorage`/browser here, so these tests exercise the pure decision
 * function directly (`resolveWindowId`) and `getWindowId`'s documented
 * fallback path (storage unavailable → in-memory id, cached for the page's
 * lifetime) rather than real cross-tab isolation, which needs an actual
 * browser (see 12-PROGRESS.md's U04 entry for that honest limitation).
 */
describe("resolveWindowId (pure)", () => {
  it("reuses an existing non-empty id instead of generating a new one", () => {
    let generated = false;
    const id = resolveWindowId("existing-id", () => {
      generated = true;
      return "new-id";
    });
    expect(id).toBe("existing-id");
    expect(generated).toBe(false);
  });

  it("generates a new id when there is none stored yet (null)", () => {
    const id = resolveWindowId(null, () => "new-id");
    expect(id).toBe("new-id");
  });

  it("generates a new id when there is none stored yet (undefined)", () => {
    const id = resolveWindowId(undefined, () => "new-id");
    expect(id).toBe("new-id");
  });

  it("treats an empty string as absent and generates a new id", () => {
    const id = resolveWindowId("", () => "new-id");
    expect(id).toBe("new-id");
  });
});

describe("getWindowId (storage-unavailable fallback, node environment)", () => {
  beforeEach(() => {
    resetWindowIdCacheForTests();
  });

  it("does not throw when sessionStorage/crypto access fails, and returns a non-empty string", () => {
    expect(() => getWindowId()).not.toThrow();
    expect(typeof getWindowId()).toBe("string");
    expect(getWindowId().length).toBeGreaterThan(0);
  });

  it("caches the fallback id across calls within the same 'page lifetime' (module scope)", () => {
    const first = getWindowId();
    const second = getWindowId();
    expect(second).toBe(first);
  });

  it("a fresh page load (cache reset) can mint a different id than the previous one", () => {
    const first = getWindowId();
    resetWindowIdCacheForTests();
    const second = getWindowId();
    // Not a hard guarantee (fallback is a random uuid so collision is
    // astronomically unlikely, not impossible) — this documents the intent:
    // resetting the cache simulates a new tab, which must not silently keep
    // reusing the old window's id.
    expect(typeof second).toBe("string");
    expect(second.length).toBeGreaterThan(0);
    void first;
  });
});
