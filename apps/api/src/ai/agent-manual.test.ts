import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_TOOLS, renderAgentManual } from "@orion/shared-types";
import { describe, expect, it } from "vitest";

// Lives in apps/api, not next to the generator in shared-types: the doc check reads the repo file from disk,
// and shared-types is built without Node types (it is shared with the browser).
describe("Руководство агента", () => {
  const manualPath = resolve(__dirname, "..", "..", "..", "..", "docs", "AGENT_MANUAL.md");

  it("описывает каждый инструмент каталога и не упоминает внутренности", () => {
    const manual = renderAgentManual();
    for (const tool of AGENT_TOOLS) expect(manual).toContain(`\`${tool.name}\``);
    expect(manual).not.toMatch(/schema\.prisma|\.ts\b|withUser|asSystem|RLS/);
    expect(manual).not.toMatch(/orion_agt_[A-Za-z0-9_-]{6,}/);
  });

  it("docs/AGENT_MANUAL.md совпадает с генератором (UPDATE_AGENT_MANUAL=1 пересоздаёт файл)", () => {
    const expected = renderAgentManual();
    if (process.env.UPDATE_AGENT_MANUAL === "1") writeFileSync(manualPath, expected);
    expect(readFileSync(manualPath, "utf8").replace(/\r\n/g, "\n")).toBe(expected);
  });
});
