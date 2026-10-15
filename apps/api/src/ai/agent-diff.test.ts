import { describe, expect, it } from "vitest";
import { buildProposalDiff } from "./agent-diff";

describe("buildProposalDiff", () => {
  it("показывает только реально меняющиеся поля", () => {
    const diff = buildProposalDiff("task", { title: "A", status: "todo", dueAt: null }, { title: "A", status: "done", dueAt: "2026-10-20T00:00:00.000Z" });
    expect(diff.map((d) => d.field)).toEqual(["status", "dueAt"]);
    expect(diff[0]).toMatchObject({ before: "todo", after: "done", label: "Статус" });
    expect(diff[1]).toMatchObject({ before: null, after: "2026-10-20T00:00:00.000Z" });
  });

  it("сравнивает даты по моменту, а теги — списком", () => {
    const same = buildProposalDiff("event", { startAt: new Date("2026-10-20T10:00:00Z") }, { startAt: "2026-10-20T10:00:00Z" });
    expect(same).toEqual([]);
    const tags = buildProposalDiff("note", { tags: ["a"] }, { tags: ["a", "b"] });
    expect(tags[0]).toMatchObject({ before: "a", after: "a, b" });
  });

  it("режет длинный текст и игнорирует чужие поля", () => {
    const diff = buildProposalDiff("note", { body: "x" }, { body: "y".repeat(5000), assigneeId: "u" });
    expect(diff).toHaveLength(1);
    expect(diff[0]?.after?.length).toBeLessThan(700);
  });
});
