import { describe, expect, it } from "vitest";
import {
  loadNavSidebarPins,
  navSidebarPinned,
  navSidebarPinsStorageKey,
  parseNavSidebarPins,
  saveNavSidebarPins,
  withNavSidebarPin,
  type NavSidebarPinsStorage,
} from "./nav-sidebar-pins";

/** In-memory stand-in for localStorage — the real one is exercised through the hook. */
function memoryStorage(): NavSidebarPinsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("parseNavSidebarPins", () => {
  it("keeps only boolean values under non-empty ids", () => {
    expect(parseNavSidebarPins({ primary: true, "side-2": false, bad: "yes", "": true, num: 1 })).toEqual({
      primary: true,
      "side-2": false,
    });
  });

  it("returns an empty map for anything that is not a record", () => {
    expect(parseNavSidebarPins(null)).toEqual({});
    expect(parseNavSidebarPins("primary")).toEqual({});
    expect(parseNavSidebarPins([true])).toEqual({});
  });
});

describe("load/save round-trip", () => {
  it("writes under the per-user per-workspace key and reads back", () => {
    const storage = memoryStorage();
    saveNavSidebarPins(storage, "u1", "w1", { primary: false });
    expect(storage.data.get(navSidebarPinsStorageKey("u1", "w1"))).toBe('{"primary":false}');
    expect(loadNavSidebarPins(storage, "u1", "w1")).toEqual({ primary: false });
    // Another pair is untouched.
    expect(loadNavSidebarPins(storage, "u1", "w2")).toEqual({});
  });

  it("treats missing or corrupt data as 'no choice saved'", () => {
    const storage = memoryStorage();
    storage.data.set(navSidebarPinsStorageKey("u1", "w1"), "not json");
    expect(loadNavSidebarPins(storage, "u1", "w1")).toEqual({});
  });
});

describe("navSidebarPinned", () => {
  it("defaults to expanded, and an explicit choice wins over the default", () => {
    expect(navSidebarPinned({}, "primary")).toBe(true);
    expect(navSidebarPinned({ primary: false }, "primary")).toBe(false);
    expect(navSidebarPinned({ primary: false }, "primary", false)).toBe(false);
    // A bar the user never touched falls back to the caller's default
    // (the layout passes `density !== "icons"` — icon-only bars stay collapsed).
    expect(navSidebarPinned({ primary: false }, "side-2", false)).toBe(false);
    expect(navSidebarPinned({ primary: true }, "side-2", false)).toBe(false);
  });
});

describe("withNavSidebarPin", () => {
  it("sets immutably and keeps the same reference when nothing changes", () => {
    const before: { primary?: boolean } = {};
    const after = withNavSidebarPin(before, "primary", true);
    expect(after).not.toBe(before);
    expect(after).toEqual({ primary: true });
    expect(withNavSidebarPin(after, "primary", true)).toBe(after);
  });
});
