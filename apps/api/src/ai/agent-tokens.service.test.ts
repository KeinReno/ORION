import { describe, expect, it } from "vitest";
import { describePolicyChange } from "./agent-tokens.service";

function snapshot(patch: Partial<Parameters<typeof describePolicyChange>[0]> = {}) {
  return {
    mode: "assistant",
    permissions: { tasks: ["read"], notes: ["read"], events: ["read"], projects: ["read"], finance: [] },
    forbidden: ["delete"],
    writeLimitPerHour: null,
    allowedProjectIds: [],
    ...patch
  };
}

describe("describePolicyChange", () => {
  it("says nothing changed on a no-op save", () => {
    const row = snapshot();
    expect(describePolicyChange(row, row)).toBe("Настройки токена сохранены без изменений");
  });

  it("names the mode change by both labels", () => {
    expect(describePolicyChange(snapshot({ mode: "observer" }), snapshot({ mode: "assistant" })))
      .toBe("Права токена изменены: режим «Наблюдатель» → «Помощник»");
  });

  it("flags a matrix change without needing to spell out every cell", () => {
    expect(describePolicyChange(snapshot(), snapshot({ permissions: { tasks: ["read", "create"], notes: ["read"], events: ["read"], projects: ["read"], finance: [] } })))
      .toBe("Права токена изменены: права по разделам изменены");
  });

  it("ignores a reorder of the same forbidden flags or project ids — not a real change", () => {
    const a = snapshot({ forbidden: ["delete", "execute"], allowedProjectIds: ["p1", "p2"] });
    const b = snapshot({ forbidden: ["execute", "delete"], allowedProjectIds: ["p2", "p1"] });
    expect(describePolicyChange(a, b)).toBe("Настройки токена сохранены без изменений");
  });

  it("names the write-limit change, including to/from unlimited", () => {
    expect(describePolicyChange(snapshot({ writeLimitPerHour: null }), snapshot({ writeLimitPerHour: 50 })))
      .toBe("Права токена изменены: лимит записей: без лимита → 50");
  });

  it("joins several real changes in one sentence", () => {
    const before = snapshot({ mode: "observer", allowedProjectIds: ["p1"] });
    const after = snapshot({ mode: "assistant", allowedProjectIds: ["p1", "p2"] });
    expect(describePolicyChange(before, after)).toBe("Права токена изменены: режим «Наблюдатель» → «Помощник», набор проектов изменён");
  });
});
