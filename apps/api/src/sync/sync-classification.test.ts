import { describe, expect, it } from "vitest";
import { SNAPSHOT_MODEL_REGISTRY } from "./snapshot-registry";
import { REPLICATED_MODELS, SYNC_CLASSIFICATION } from "./sync-classification";

describe("ADR-0016 §1: классификация моделей для гибридной синхронизации", () => {
  const registered = SNAPSHOT_MODEL_REGISTRY.map((c) => c.model);

  it("охватывает ВСЕ модели реестра снапшота и не содержит лишних", () => {
    const missing = registered.filter((m) => !(m in SYNC_CLASSIFICATION));
    const stale = Object.keys(SYNC_CLASSIFICATION).filter((m) => !registered.includes(m));
    expect(missing, `не классифицированы: ${missing.join(", ")}`).toEqual([]);
    expect(stale, `лишние строки: ${stale.join(", ")}`).toEqual([]);
  });

  it("всё, что реестр бэкапа считает не-данными пространства, не синхронизируется", () => {
    const wrong = SNAPSHOT_MODEL_REGISTRY.filter(
      (c) => c.policy !== "included" && SYNC_CLASSIFICATION[c.model]?.syncClass !== "not-synced"
    ).map((c) => c.model);
    expect(wrong).toEqual([]);
  });

  it("деньги и строгие инварианты не получают офлайн-запись", () => {
    const bad = Object.entries(SYNC_CLASSIFICATION)
      .filter(([, c]) => c.syncClass === "strict" && c.stage !== "never")
      .map(([m]) => m);
    expect(bad).toEqual([]);
    for (const model of ["Transaction", "Account", "InventoryMovement", "TimeEntry"]) {
      expect(SYNC_CLASSIFICATION[model]?.syncClass).toBe("strict");
    }
  });

  it("данные здоровья (ADR-0012) никогда не реплицируются", () => {
    for (const model of registered.filter((m) => m.startsWith("Health"))) {
      expect(SYNC_CLASSIFICATION[model]).toMatchObject({ syncClass: "not-synced", stage: "never" });
    }
  });

  it("локальная копия содержит только модели этапов 2–3", () => {
    for (const model of REPLICATED_MODELS) {
      expect(["stage2", "stage3"]).toContain(SYNC_CLASSIFICATION[model]?.stage);
    }
    const stage23 = Object.entries(SYNC_CLASSIFICATION)
      .filter(([, c]) => c.stage === "stage2" || c.stage === "stage3")
      .map(([m]) => m)
      .sort();
    expect(stage23).toEqual([...REPLICATED_MODELS].sort());
  });

  it("у каждой строки есть пояснение", () => {
    for (const [model, c] of Object.entries(SYNC_CLASSIFICATION)) {
      expect(c.note.length, model).toBeGreaterThan(3);
    }
  });
});
