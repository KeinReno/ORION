import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeVariables } from "../../../packages/ui/src/design-tokens";

describe("Host theme stylesheet", () => {
  it("keeps the legacy CSS bridge equal to the public token contract", () => {
    const css = readFileSync(new URL("../../../packages/ui/src/theme.css", import.meta.url), "utf8");
    for (const [key, value] of Object.entries(themeVariables("legacy"))) {
      expect(css).toContain(`${key}: ${value};`);
    }
  });
});
