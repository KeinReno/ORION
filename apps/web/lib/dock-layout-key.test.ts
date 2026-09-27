import { describe, expect, it } from "vitest";
import { dockLayoutStorageKey } from "./dock-layout-key";

/**
 * U04 — "Layout ключуется пользователем, пространством и назначением
 * раскладки" (23-UNIVERSAL-CONNECTED-CORE.md). Pure key-composition function
 * used by `app/(app)/layout.tsx` to scope the dockview layout instead of the
 * single fixed `orion.dockLayout` key it used before this session.
 */
describe("dockLayoutStorageKey (pure)", () => {
  it("composes purpose, userId and workspaceId into a single key", () => {
    expect(dockLayoutStorageKey("user-1", "ws-1")).toBe("orion.dockLayout:main:user-1:ws-1");
  });

  it("defaults purpose to 'main' when not given", () => {
    expect(dockLayoutStorageKey("user-1", "ws-1")).toBe(dockLayoutStorageKey("user-1", "ws-1", "main"));
  });

  it("accepts an explicit purpose for a future second layout kind", () => {
    expect(dockLayoutStorageKey("user-1", "ws-1", "popout")).toBe("orion.dockLayout:popout:user-1:ws-1");
  });

  it("different users produce different keys for the same workspace", () => {
    expect(dockLayoutStorageKey("user-1", "ws-1")).not.toBe(dockLayoutStorageKey("user-2", "ws-1"));
  });

  it("different workspaces produce different keys for the same user", () => {
    expect(dockLayoutStorageKey("user-1", "ws-1")).not.toBe(dockLayoutStorageKey("user-1", "ws-2"));
  });

  it("switching a workspace's layout key back and forth is stable (idempotent per pair)", () => {
    const a = dockLayoutStorageKey("user-1", "ws-family");
    const b = dockLayoutStorageKey("user-1", "ws-studio");
    expect(dockLayoutStorageKey("user-1", "ws-family")).toBe(a);
    expect(dockLayoutStorageKey("user-1", "ws-studio")).toBe(b);
    expect(a).not.toBe(b);
  });
});
