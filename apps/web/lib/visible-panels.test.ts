import { isPluginEnabled } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { visiblePanels } from "./panel-registry";

const navIds = (pluginOverrides: readonly string[]): string[] => visiblePanels([], [], pluginOverrides).map((panel) => panel.id);

describe("visiblePanels", () => {
  it("lists a plugin-owned panel only while its plugin is on", () => {
    // The override flips the plugin from its catalog default, whichever that is.
    for (const overrides of [[], ["projects-goals"]]) {
      expect(navIds(overrides).includes("goals"), JSON.stringify(overrides)).toBe(isPluginEnabled(overrides, "projects-goals"));
    }
  });

  it("drops panels of a disabled module and of a personally hidden one", () => {
    expect(visiblePanels(["tasks"]).map((panel) => panel.id)).not.toContain("tasks");
    expect(visiblePanels([], ["notes"]).map((panel) => panel.id)).not.toContain("notes");
    expect(visiblePanels([], ["notes"]).map((panel) => panel.id)).toContain("dashboard");
  });

  it("places cross-workspace shared items in the tools menu", () => {
    expect(visiblePanels([], []).find((panel) => panel.id === "shared")?.group).toBe("Инструменты");
  });
});
