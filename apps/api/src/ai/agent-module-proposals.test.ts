import { describe, expect, it } from "vitest";
import { moduleChangeDiff } from "./agent-module-proposals.service";

describe("module change diff", () => {
  const snapshot = {
    title: "Зарядка",
    fields: { name: "Зарядка", note: "", weekdays: [0, 2, 4] },
    labels: { name: "Название", note: "Заметка", weekdays: "Дни недели" }
  };

  it("lists only the fields that change, in human words", () => {
    expect(moduleChangeDiff(snapshot, { name: "Утренняя зарядка", note: "", weekdays: [0, 2, 4] })).toEqual([{ field: "name", label: "Название", before: "Зарядка", after: "Утренняя зарядка" }]);
    expect(moduleChangeDiff(snapshot, { weekdays: [] })).toEqual([{ field: "weekdays", label: "Дни недели", before: "0, 2, 4", after: null }]);
  });

  it("ignores fields the module does not show and values not given", () => {
    expect(moduleChangeDiff(snapshot, { secret: "x", name: undefined })).toEqual([]);
  });
});
