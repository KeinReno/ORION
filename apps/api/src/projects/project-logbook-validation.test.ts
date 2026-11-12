import { describe, expect, it } from "vitest";
import { normaliseProjectLogFields, readProjectLogAlternatives, validateProjectLogFields } from "./project-logbook-validation";

function fields(input: Parameters<typeof normaliseProjectLogFields>[0] = {}) {
  return normaliseProjectLogFields(input);
}

describe("project logbook type validation", () => {
  it("requires rationale for a decision and allows alternatives", () => {
    expect(validateProjectLogFields("decision", fields())).toEqual({
      rationale: "Для решения обязательно обоснование (rationale)"
    });
    expect(validateProjectLogFields("decision", fields({
      rationale: "Меньше запросов",
      alternatives: [{ option: "Кэш", whyNot: "Инвалидация" }]
    }))).toEqual({});
  });

  it("rejects fields that do not belong to the type", () => {
    expect(validateProjectLogFields("observation", fields({ severity: "high" }))).toHaveProperty("severity");
    expect(validateProjectLogFields("decision", fields({ rationale: "ok", severity: "low" }))).toHaveProperty("severity");
    expect(validateProjectLogFields("hypothesis", fields({ rationale: "ok" }))).toHaveProperty("rationale");
    expect(validateProjectLogFields("result", fields({ verificationDue: "2026-01-01T00:00:00.000Z" }))).toHaveProperty("verificationDue");
  });

  it("requires severity for an incident and allows a resolution note", () => {
    expect(validateProjectLogFields("incident", fields())).toHaveProperty("severity");
    expect(validateProjectLogFields("incident", fields({ severity: "high", resolution: "Перезапустили" }))).toEqual({});
  });

  it("keeps verdict tied to a confirmed entry", () => {
    expect(validateProjectLogFields("result", fields({ verdict: "confirms" }))).toHaveProperty("verdict");
    expect(validateProjectLogFields("result", fields({ verdict: "refutes", confirmsEntryId: "entry-id" }))).toEqual({});
  });

  it("normalises alternatives defensively", () => {
    expect(readProjectLogAlternatives([{ option: "A", whyNot: "b" }, { whyNot: "no option" }, null, "x"])).toEqual([{ option: "A", whyNot: "b" }]);
    expect(readProjectLogAlternatives("nope")).toEqual([]);
  });
});
