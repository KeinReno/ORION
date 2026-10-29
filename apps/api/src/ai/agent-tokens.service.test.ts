import { describe, expect, it } from "vitest";
import { describePolicyChange, scopesAfterPolicyEdit } from "./agent-tokens.service";

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

describe("scopesAfterPolicyEdit", () => {
  const previous = ["tasks:read", "notes:read", "links:write", "habits.habit.read"];

  it("adds a write scope when the matrix newly allows it", () => {
    const next = scopesAfterPolicyEdit(previous, {
      permissions: { tasks: ["read", "create"], notes: ["read"], events: [], projects: [], finance: [] },
      extraScopes: ["links:write"],
      modulePermissions: ["habits.habit.read"]
    });
    expect(next).toContain("tasks:write");
    expect(next).toContain("links:write");
    expect(next).toContain("habits.habit.read");
    expect(next).not.toContain("notes:write");
  });

  it("drops a scope the matrix no longer grants and keeps an omitted module list", () => {
    const next = scopesAfterPolicyEdit(["tasks:read", "tasks:write", "habits.habit.read"], {
      permissions: { tasks: ["read"], notes: [], events: [], projects: [], finance: [] }
    });
    expect(next).toEqual(["tasks:read", "habits.habit.read"]);
  });

  it("clears the extra scopes when the save sends none", () => {
    const next = scopesAfterPolicyEdit(previous, {
      permissions: { tasks: ["read"], notes: ["read"], events: [], projects: [], finance: [] },
      extraScopes: [],
      modulePermissions: []
    });
    expect(next).not.toContain("links:write");
    expect(next).not.toContain("habits.habit.read");
  });
});
