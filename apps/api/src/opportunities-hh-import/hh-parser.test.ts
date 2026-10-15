import { describe, expect, it } from "vitest";
import { hhImportPreviewInputSchema, classifyHhPath, normalizeHhPath } from "@orion/shared-types";
import { compileHhPlan } from "./hh-parser";
const input = (files: { path: string; text: string }[], flags = {}) => hhImportPreviewInputSchema.parse({ files, acknowledgeWorkspaceVisibility: true, ...flags });
describe("controlled HH parsing", () => {
  it("rejects traversal and credentials, keeps scripts non-executable", () => {
    for (const path of ["../vacancies_x.json", "C:/HH/a.txt", "/HH/a.txt", "HH/a/../b"]) expect(normalizeHhPath(path)).toBeNull();
    for (const path of ["HH/a/hh_browser_profile/a.json", "HH/a/storage_state.json", "HH/a/run.py"]) expect(classifyHhPath(path)).toBe("excluded");
    expect(compileHhPlan(input([{ path: "a/run.py", text: "raise Exception()" }])).operations).toEqual([]);
  });
  it("uses scoped folder identity, immutable content versions, no extracted facts", () => {
    const plan = compileHhPlan(input(["team1", "team2"].map((p) => ({ path: `HH/${p}/Иван/Резюме/Аналитик.md`, text: "Резюме" })), { includeProfiles: true }));
    expect(plan.operations).toHaveLength(2);
    const keys = plan.operations.map((o) => o.kind === "material" ? o.data.profileSourceKey : "");
    expect(new Set(keys).size).toBe(2); expect(keys[0]).toBe("hh-folder:team1/Иван");
    const incomplete = compileHhPlan(input([{ path: "Резюме/Аналитик.md", text: "CV" }], { includeProfiles: true }));
    expect(incomplete.operations).toHaveLength(0); expect(incomplete.warnings[0].reason).toContain("кандидата целиком");
  });
  it("allows HH vacancy URLs only and sanitizes HTML/query secrets", () => {
    const records = ["https://hh.ru/vacancy/123?token=secret", "https://hh.ru.evil.test/vacancy/456", "https://user:pass@hh.ru/vacancy/789"].map((url) => ({ title: "Аналитик", url, description: "<b>Опыт</b>", salary: { from: 90000, to: 110000, currency: "RUR", gross: false } }));
    const plan = compileHhPlan(input([{ path: "vacancies_test.json", text: JSON.stringify(records) }]));
    expect(plan.operations).toHaveLength(1);
    const op = plan.operations[0]; if (op.kind !== "opportunity") throw new Error();
    expect(op.data.input.canonicalUrl).toBe("https://hh.ru/vacancy/123"); expect(op.data.input.conditions.taxBasis).toBe("net");
    expect(JSON.stringify(op.data.snapshot)).not.toContain("secret"); expect(op.data.snapshot.description).toBe("Опыт");
  });
  it("never promotes legacy verified/already_applied to a confirmed send", () => {
    const records = [{ title: "A", url: "https://hh.ru/vacancy/1", verified: true, reason: "already_applied" }, { title: "B", verified: true }, { title: "C", success: false }, { title: "D", success: true }];
    const plan = compileHhPlan(input([{ path: "applications/test.json", text: JSON.stringify(records) }], { includeHistory: true }));
    expect(plan.operations.map((o) => o.kind === "history" && o.data.outcome)).toEqual(["already_exists", "legacy_claimed_verified", "failed", "unconfirmed"]);
    expect(JSON.stringify(plan)).not.toContain('"confirmed"');
  });
  it("skips the entire over-complex file without leaving partial operations", () => {
    const records: unknown[] = [{ title: "Good", url: "https://hh.ru/vacancy/1" }, Array(10001).fill(0)];
    const plan = compileHhPlan(input([{ path: "vacancies_test.json", text: JSON.stringify(records) }]));
    expect(plan.operations).toHaveLength(0); expect(plan.warnings[0].reason).toContain("полностью");
  });
  it("rejects oversize input and requires explicit workspace visibility acknowledgment", () => {
    expect(hhImportPreviewInputSchema.safeParse({ files: [{ path: "vacancies_x.json", text: "[]" }] }).success).toBe(false);
    expect(hhImportPreviewInputSchema.safeParse({ files: Array(3).fill({ path: "a.txt", text: "x".repeat(180000) }), acknowledgeWorkspaceVisibility: true }).success).toBe(false);
  });
});
