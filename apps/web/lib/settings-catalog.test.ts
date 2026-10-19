import { describe, expect, it } from "vitest";
import { SETTINGS_FIELDS, SETTINGS_TABS, isSettingsTab, searchSettings, settingsScopeText } from "./settings-catalog";

describe("settings catalog", () => {
  it("keeps tab values and field anchors unique, and every field on a known tab", () => {
    const tabs = SETTINGS_TABS.map((tab) => tab.value);
    expect(new Set(tabs).size).toBe(tabs.length);
    const anchors = SETTINGS_FIELDS.map((field) => `${field.tab}:${field.anchor}`);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const field of SETTINGS_FIELDS) expect(isSettingsTab(field.tab), field.anchor).toBe(true);
  });

  it("keeps the tab values detached views were saved with", () => {
    for (const value of ["profile", "security", "notifications", "appearance", "modules", "plugins", "workspace", "spheres", "members", "agents", "network", "updates", "about"]) {
      expect(isSettingsTab(value), value).toBe(true);
    }
  });

  it("finds a parameter by label, by keyword and regardless of ё", () => {
    expect(searchSettings("тихие")[0]).toMatchObject({ tab: "notifications", anchor: "quiet-hours" });
    expect(searchSettings("пин")[0]).toMatchObject({ tab: "security", anchor: "password" });
    expect(searchSettings("несуществующее")).toEqual([]);
    expect(searchSettings("ещё")).toEqual(searchSettings("еще"));
    expect(searchSettings("часовой пояс")[0]).toMatchObject({ tab: "region", anchor: "time-zone" });
  });

  it("ranks a label match above a keyword-only match and lists a field once even when its tab has the same name", () => {
    const hits = searchSettings("плагины");
    expect(hits[0]).toMatchObject({ tab: "plugins", anchor: "plugins" });
    expect(hits.filter((hit) => hit.tab === "plugins")).toHaveLength(1);
  });

  it("returns nothing for an empty query", () => {
    expect(searchSettings("   ")).toEqual([]);
  });

  it("names the workspace a workspace-wide change affects", () => {
    expect(settingsScopeText("workspace", "Семья")).toContain("«Семья»");
    expect(settingsScopeText("info", "Семья")).toBeNull();
  });
});
