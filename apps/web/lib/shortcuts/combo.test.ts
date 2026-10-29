import { describe, expect, it } from "vitest";
import { comboFromEvent, comboMatchesEvent, describeCombo, normalizeCombo, parseCombo } from "./combo";

const event = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
});

describe("parseCombo", () => {
  it("reads every modifier plus the key", () => {
    expect(parseCombo("mod+shift+alt+k")).toEqual({ mod: true, shift: true, alt: true, key: "k" });
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(parseCombo(" Mod + B ")).toEqual({ mod: true, shift: false, alt: false, key: "b" });
  });
});

describe("normalizeCombo", () => {
  it("puts modifiers in a fixed order regardless of input order", () => {
    expect(normalizeCombo("shift+mod+k")).toBe(normalizeCombo("mod+shift+k"));
    expect(normalizeCombo("mod+shift+k")).toBe("mod+shift+k");
  });

  it("is empty for a combo with no real key", () => {
    expect(normalizeCombo("mod+shift")).toBe("");
  });
});

describe("comboMatchesEvent", () => {
  it("matches mod+key regardless of which physical modifier (ctrl vs meta) fired it", () => {
    expect(comboMatchesEvent("mod+b", event("b", { ctrlKey: true }))).toBe(true);
    expect(comboMatchesEvent("mod+b", event("b", { metaKey: true }))).toBe(true);
  });

  it("rejects a plain key press when the combo requires mod", () => {
    expect(comboMatchesEvent("mod+b", event("b"))).toBe(false);
  });

  it("rejects when an extra modifier is held that the combo doesn't name", () => {
    expect(comboMatchesEvent("mod+b", event("b", { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("is case-insensitive on the key itself", () => {
    expect(comboMatchesEvent("mod+b", event("B", { ctrlKey: true }))).toBe(true);
  });
});

describe("comboFromEvent", () => {
  it("captures mod+shift+key from a real keystroke", () => {
    expect(comboFromEvent(event("k", { ctrlKey: true, shiftKey: true }))).toBe("mod+shift+k");
  });

  it("returns null while only a modifier key itself is held — not a combo yet", () => {
    expect(comboFromEvent(event("Control", { ctrlKey: true }))).toBeNull();
    expect(comboFromEvent(event("Shift", { shiftKey: true }))).toBeNull();
  });

  it("captures a bare key with no modifiers (e.g. Escape)", () => {
    expect(comboFromEvent(event("Escape"))).toBe("escape");
  });
});

describe("describeCombo", () => {
  it("renders Windows-style with + separators", () => {
    expect(describeCombo("mod+shift+k")).toBe("Ctrl+Shift+K");
  });

  it("renders macOS-style with symbols and no separators", () => {
    expect(describeCombo("mod+shift+k", true)).toBe("⌘⇧K");
  });

  it("gives special keys a readable label", () => {
    expect(describeCombo("escape")).toBe("Esc");
    expect(describeCombo("mod+arrowup")).toBe("Ctrl+↑");
  });

  it("is empty for an empty combo", () => {
    expect(describeCombo("")).toBe("");
  });
});
