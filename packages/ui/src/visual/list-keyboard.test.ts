import { describe, expect, it } from "vitest";
import { comboboxMenuAction, glideMenuAction, stepIndex, typeaheadIndex } from "./list-keyboard";

describe("glideMenuAction", () => {
  it("opens from the trigger and then moves, chooses, and closes", () => {
    expect(glideMenuAction("ArrowDown", false)).toBe("open");
    expect(glideMenuAction("ArrowDown", true)).toBe("next");
    expect(glideMenuAction("ArrowUp", true)).toBe("prev");
    expect(glideMenuAction("Home", true)).toBe("first");
    expect(glideMenuAction("End", true)).toBe("last");
    expect(glideMenuAction("Enter", true)).toBe("choose");
    expect(glideMenuAction(" ", true)).toBe("choose");
    expect(glideMenuAction("Escape", true)).toBe("close");
    expect(glideMenuAction("Tab", true)).toBe("tab");
    expect(glideMenuAction("Escape", false)).toBe("none");
    expect(glideMenuAction("Enter", false)).toBe("open");
  });
});

describe("comboboxMenuAction", () => {
  it("does not treat space as a choice, and Enter does nothing while the list is closed", () => {
    expect(comboboxMenuAction(" ", true)).toBe("none");
    expect(comboboxMenuAction("Enter", false)).toBe("none");
    expect(comboboxMenuAction("Enter", true)).toBe("choose");
    expect(comboboxMenuAction("Escape", true)).toBe("close");
    expect(comboboxMenuAction("ArrowDown", false)).toBe("open");
  });
});

describe("list movement", () => {
  it("stays inside the list and finds the next letter", () => {
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(typeaheadIndex(["Сделать", "Ждёт", "Готово"], 0, "г")).toBe(2);
    expect(typeaheadIndex(["Сделать", "Ждёт", "Готово"], 2, "г")).toBe(2);
  });
});
