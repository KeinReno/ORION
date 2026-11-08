import { describe, expect, it } from "vitest";
import { LEGACY_NAV_SIDEBAR_KEY, NAV_SIDEBAR_CLAIM_KEY, loadNavSidebars, navSidebarStorageKey } from "./nav-sidebar-storage";
import type { NavSidebarStorage } from "./nav-sidebar-storage";

function memory(): NavSidebarStorage & { dump: Record<string, string> } {
  const dump: Record<string, string> = {};
  return {
    dump,
    getItem: (key) => (key in dump ? dump[key]! : null),
    setItem: (key, value) => {
      dump[key] = value;
    },
    removeItem: (key) => {
      delete dump[key];
    },
  };
}

describe("loadNavSidebars", () => {
  it("gives the legacy bar to the first profile and not to the next account", () => {
    const storage = memory();
    storage.setItem(LEGACY_NAV_SIDEBAR_KEY, JSON.stringify({
      sidebars: [{ id: "primary", name: "Дом", edge: "left", density: "full" }, { id: "side-2", name: "Второй", edge: "right", density: "icons" }],
      placement: { notes: "side-2" },
    }));
    const first = loadNavSidebars(storage, "user-a", "space-a");
    expect(first.sidebars.map((sidebar) => sidebar.name)).toEqual(["Дом", "Второй"]);
    expect(first.placement).toEqual({ notes: "side-2" });
    expect(storage.getItem(LEGACY_NAV_SIDEBAR_KEY)).toBeNull();
    expect(storage.getItem(NAV_SIDEBAR_CLAIM_KEY)).toBe("user-a\nspace-a");

    const other = loadNavSidebars(storage, "user-b", "space-b");
    expect(other.sidebars).toHaveLength(1);
    expect(other.placement).toEqual({});
    expect(storage.getItem(navSidebarStorageKey("user-b", "space-b"))).toBeNull();
  });

  it("keeps two workspaces of one person apart", () => {
    const storage = memory();
    storage.setItem(navSidebarStorageKey("user-a", "space-a"), JSON.stringify({
      sidebars: [{ id: "primary", name: "Работа", edge: "left", density: "full" }],
      placement: {},
    }));
    const home = loadNavSidebars(storage, "user-a", "space-b");
    expect(home.sidebars[0]?.name).toBe("Основной");
    expect(loadNavSidebars(storage, "user-a", "space-a").sidebars[0]?.name).toBe("Работа");
  });
});
