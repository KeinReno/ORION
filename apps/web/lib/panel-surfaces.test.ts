import { COMPONENT_MANIFESTS, SHELL_SURFACES, SURFACE_IDS } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { getPanelDefinition, panelRegistry, panelSupportsSurface } from "./panel-registry";

describe("panel surfaces derived from manifests", () => {
  it("gives every registry panel surfaces from its owner's manifest", () => {
    for (const panel of panelRegistry) {
      const ownerId = panel.pluginId ?? panel.moduleId;
      const manifest = ownerId ? COMPONENT_MANIFESTS.find((candidate) => candidate.id === ownerId) : undefined;
      if (ownerId) expect(manifest, `${panel.id}: нет манифеста ${ownerId}`).toBeDefined();
      const declared = manifest ? manifest.surfaces : SHELL_SURFACES;
      const expected = panel.instanced ? declared.filter((surface) => surface !== "widget") : declared;
      expect(panel.surfaces, panel.id).toEqual(expected);
      expect(panel.surfaces.length, `${panel.id}: нет ни одной поверхности`).toBeGreaterThan(0);
      for (const surface of panel.surfaces) expect(SURFACE_IDS).toContain(surface);
      expect(panel.surfaces, `${panel.id}: панель обязана открываться во вкладке дока`).toContain("dock");
    }
  });

  it("keeps today's behaviour: every panel can float and detach", () => {
    for (const panel of panelRegistry) {
      expect(panel.surfaces, panel.id).toContain("floating");
      expect(panel.surfaces, panel.id).toContain("window");
    }
  });

  it("offers a widget only to non-instanced panels of dashboard modules", () => {
    expect(panelSupportsSurface("tasks", "widget")).toBe(true);
    expect(panelSupportsSurface("project:abc", "widget")).toBe(false);
    expect(panelSupportsSurface("settings", "widget")).toBe(false);
    expect(panelSupportsSurface("unknown-panel", "dock")).toBe(false);
    expect(getPanelDefinition("calendar")?.surfaces).toEqual(["dock", "floating", "window", "widget"]);
  });

  it("declares surfaces for every manifest and the slot-only plugins", () => {
    for (const manifest of COMPONENT_MANIFESTS) expect(Array.isArray(manifest.surfaces), manifest.id).toBe(true);
    expect(COMPONENT_MANIFESTS.find((m) => m.id === "calendar-widget")?.surfaces).toEqual(["widget"]);
    expect(COMPONENT_MANIFESTS.find((m) => m.id === "documents-resources")?.surfaces).toEqual(["side"]);
  });
});
