import { describe, expect, it } from "vitest";
import { projectContextId, projectPinsKey, parseProjectPins } from "./shell-context";
import { themePreferenceSchema } from "@orion/shared-types";

describe("workspace shell context boundaries", () => {
  it("only recognizes actual project views, never unrelated panel ids", () => {
    for (const view of ["project", "projecttasks", "projectmaterials", "projectplan", "projectaccess"]) expect(projectContextId(`${view}:abc`)).toBe("abc");
    for (const id of [null, "projects", "task:abc", "project:abc:other", "project:", "custom:abc"]) expect(projectContextId(id)).toBeUndefined();
  });
  it("isolates pins by user and workspace, including delimiter-bearing ids", () => {
    expect(projectPinsKey("u", "w")).not.toBe(projectPinsKey("v", "w"));
    expect(projectPinsKey("u", "w")).not.toBe(projectPinsKey("u", "x"));
    expect(projectPinsKey("u:w", "x")).not.toBe(projectPinsKey("u", "w:x"));
  });
  it("ignores corrupt pin storage without dropping valid unrecognized ids", () => {
    for (const raw of [null, "{", '{}', '[1]', '[""]', JSON.stringify(Array(101).fill("id"))]) expect(parseProjectPins(raw)).toEqual([]);
    expect(parseProjectPins('["known","unknown","known"]')).toEqual(["known", "unknown"]);
  });
  it("keeps old preference values and explicitly validates the redesign opt-in", () => {
    for (const theme of ["system", "dark", "light", "kaiden-precision"]) expect(themePreferenceSchema.parse(theme)).toBe(theme);
    expect(themePreferenceSchema.safeParse("arbitrary-css").success).toBe(false);
  });
});
