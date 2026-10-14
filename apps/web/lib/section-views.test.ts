import { describe, expect, it } from "vitest";
import { parseSectionViewInstance, resolveLockedView, sectionViewInstanceId, sectionViewPanelId } from "./section-views";

describe("section view ids", () => {
  it("round-trips base, view and optional instance", () => {
    expect(sectionViewPanelId({ base: "finance", view: "accounts" })).toBe("view:finance~accounts");
    expect(sectionViewPanelId({ base: "project", view: "ideas", instance: "7f3a-90" })).toBe("view:project~ideas~7f3a-90");
    expect(parseSectionViewInstance("finance~accounts")).toEqual({ base: "finance", view: "accounts" });
    expect(parseSectionViewInstance("project~ideas~7f3a-90")).toEqual({ base: "project", view: "ideas", instance: "7f3a-90" });
  });

  it("refuses unusable parts instead of building a broken id", () => {
    expect(sectionViewInstanceId({ base: "fin:ance", view: "x" })).toBeNull();
    expect(sectionViewInstanceId({ base: "finance", view: "a~b" })).toBeNull();
    expect(sectionViewInstanceId({ base: "finance", view: "" })).toBeNull();
    expect(sectionViewInstanceId({ base: "finance", view: "x", instance: "has space" })).toBeNull();
  });

  it("parses nothing from malformed text", () => {
    for (const raw of [null, undefined, "", "finance", "a~b~c~d", "a~", "~b", "a~b~c d"]) expect(parseSectionViewInstance(raw)).toBeNull();
  });
});

describe("resolveLockedView", () => {
  const tabs = ["transactions", "accounts"] as const;
  it("is not locked without the flag", () => {
    expect(resolveLockedView(undefined, tabs)).toEqual({ locked: false, view: null, missing: false });
    expect(resolveLockedView({ view: "accounts" }, tabs)).toEqual({ locked: false, view: null, missing: false });
  });
  it("locks to a known tab", () => {
    expect(resolveLockedView({ locked: true, view: "accounts" }, tabs)).toEqual({ locked: true, view: "accounts", missing: false });
  });
  it("reports a vanished tab (plugin switched off) as missing, never as another tab", () => {
    expect(resolveLockedView({ locked: true, view: "budgets" }, tabs)).toEqual({ locked: true, view: null, missing: true });
  });
});
