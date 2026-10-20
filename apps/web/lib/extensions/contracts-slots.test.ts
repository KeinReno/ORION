import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_SLOT_NAMES } from "./contracts";

describe("CORE_SLOT_NAMES", () => {
  it("lists exactly the slots of SlotContracts", () => {
    const text = readFileSync(join(__dirname, "contracts.ts"), "utf8");
    const start = text.indexOf("export interface SlotContracts {");
    const body = text.slice(start, text.indexOf("\n}", start));
    const keys = [...body.matchAll(/^\s+"([a-z][a-z0-9.-]*)"\??:/gm)].map((match) => match[1]);
    expect([...CORE_SLOT_NAMES].sort()).toEqual(keys.sort());
  });
});
