import { describe, expect, it } from "vitest";
import { componentDataStatus } from "./component-data";
import { buildComponentDiagnostics } from "./component-diagnostics";
import { COMPONENT_MANIFESTS, buildComponentManifests } from "./component-manifest";
import type { BackgroundJobStatus } from "./settings";

const job = (over: Partial<BackgroundJobStatus>): BackgroundJobStatus => ({
  componentId: "tasks",
  jobName: "due",
  running: false,
  runs: 3,
  failures: 0,
  skipped: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastError: null,
  ...over
});

describe("buildComponentDiagnostics (G16)", () => {
  it("по каждому компоненту одна строка, на чистой платформе проблем нет", () => {
    const rows = buildComponentDiagnostics(COMPONENT_MANIFESTS, [], []);
    expect(rows).toHaveLength(COMPONENT_MANIFESTS.length);
    expect(rows.every((row) => row.compatible && row.problems.length === 0)).toBe(true);
    expect(rows.find((row) => row.id === "pet-care")?.data).toBe("none");
  });

  it("собирает зависимые из жёстких requires.modules", () => {
    const rows = buildComponentDiagnostics(COMPONENT_MANIFESTS, [], []);
    const host = COMPONENT_MANIFESTS.find((m) => m.kind === "plugin")!.requires.modules[0]!;
    expect(rows.find((row) => row.id === host)?.dependents.length).toBeGreaterThan(0);
  });

  it("показывает неприменённые миграции, сбои задач и несовместимую платформу, проблемные — первыми", () => {
    const manifests = buildComponentManifests().map((m) =>
      m.id === "tasks" ? { ...m, requires: { ...m.requires, platform: "^9.0.0" } } : m
    );
    const data = [componentDataStatus("pet-care", ["a"], [])];
    const rows = buildComponentDiagnostics(manifests, data, [job({ componentId: "notes", failures: 2, lastError: "boom" })]);
    expect(rows.filter(row => row.problems.length).map(row => row.id)).toEqual(expect.arrayContaining(["notes", "pet-care", "tasks"]));
    expect(rows.find((r) => r.id === "tasks")).toMatchObject({ compatible: false });
    expect(rows.find((r) => r.id === "pet-care")?.problems[0]).toContain("Не применены миграции: a");
    expect(rows.find((r) => r.id === "notes")?.problems[0]).toContain("Сбои фоновых задач: 2 (boom)");
  });
});
