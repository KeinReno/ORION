import { describe, expect, it } from "vitest";
import { componentDataStatus } from "./component-data";
import { COMPONENT_MANIFESTS } from "./component-manifest";

const done = (name: string) => ({ name, finishedAt: new Date(), rolledBackAt: null });

describe("componentDataStatus (G11)", () => {
  it("все объявленные миграции применены — ok", () => {
    expect(componentDataStatus("pet-care", ["a", "b"], [done("a"), done("b"), done("чужая")])).toMatchObject({ state: "ok", applied: ["a", "b"], pending: [], failed: [] });
  });

  it("нет строки или миграция откачена — pending", () => {
    const status = componentDataStatus("x", ["a", "b", "c"], [done("a"), { name: "b", finishedAt: new Date(), rolledBackAt: new Date() }]);
    expect(status).toMatchObject({ state: "pending", applied: ["a"], pending: ["b", "c"] });
  });

  it("начата и не завершена — failed, и это важнее pending", () => {
    const status = componentDataStatus("x", ["a", "b"], [{ name: "a", finishedAt: null, rolledBackAt: null }]);
    expect(status).toMatchObject({ state: "failed", failed: ["a"], pending: ["b"] });
  });

  it("таблицу миграций не прочитали — unknown, а не ok", () => {
    expect(componentDataStatus("x", ["a"], null)).toMatchObject({ state: "unknown", applied: [], pending: [] });
  });
});

describe("манифесты и миграции (G11)", () => {
  it("манифест Pet Care перечисляет миграции модуля", () => {
    expect(COMPONENT_MANIFESTS.find((m) => m.id === "pet-care")?.migrations).toEqual(["20261018120000_pet_care", "20261019150000_pet_care_wellbeing", "20261020200000_pet_care_weight"]);
  });
});
