import { expect, it } from "vitest";
import { opportunitiesCsv } from "./opportunity-export";
import { createOpportunityInputSchema } from "@orion/shared-types";

it("preserves multiline source text and neutralizes spreadsheet formulas", () => {
  const row = { ...createOpportunityInputSchema.parse({ kind: "job", title: '=HYPERLINK("https://evil.test")', organizationName: "  +CMD", description: 'line 1; "quoted"\nline 2' }),
    id: "id", workspaceId: "ws", revision: 0, archivedAt: null, createdAt: "2026-10-14", updatedAt: "2026-10-14", history: [] };
  row.organizationName = "  +CMD"; // Export must also defend values not passed through the create parser.
  const csv = opportunitiesCsv([row]);
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""https://evil.test"")"');
  expect(csv).toContain('"\'  +CMD"');
  expect(csv).toContain('"line 1; ""quoted""\nline 2"');
  expect(csv).toContain('"";"";"{'); // absent URL/id stay empty, not the string "null".
});
