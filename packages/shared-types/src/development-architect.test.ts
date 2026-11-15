import { describe, expect, it } from "vitest";
import { diffArchitectMaps } from "./development-architect";

describe("diffArchitectMaps", () => {
  it("находит добавленные и удалённые узлы и связи, изменение размера не путает со структурой", () => {
    const base = {
      nodes: [
        { id: "src/a.ts", sizeBytes: 100 },
        { id: "src/b.ts", sizeBytes: 200 },
        { id: "src/old.ts", sizeBytes: 50 }
      ],
      edges: [
        { from: "src/a.ts", to: "src/b.ts", kind: "import" },
        { from: "src/old.ts", to: "src/b.ts", kind: "import" }
      ]
    };
    const target = {
      nodes: [
        { id: "src/a.ts", sizeBytes: 140 }, // изменился размер
        { id: "src/b.ts", sizeBytes: 200 },
        { id: "src/new.ts", sizeBytes: 30 }
      ],
      edges: [
        { from: "src/a.ts", to: "src/b.ts", kind: "import" }, // без изменений
        { from: "src/new.ts", to: "src/b.ts", kind: "import" }
      ]
    };
    const diff = diffArchitectMaps(base, target);
    expect(diff.addedNodes).toEqual(["src/new.ts"]);
    expect(diff.removedNodes).toEqual(["src/old.ts"]);
    expect(diff.addedEdges).toEqual(["import:src/new.ts->src/b.ts"]);
    expect(diff.removedEdges).toEqual(["import:src/old.ts->src/b.ts"]);
    expect(diff.changedNodes).toEqual([{ id: "src/a.ts", fromSizeBytes: 100, toSizeBytes: 140 }]);
  });

  it("одинаковые карты дают пустой диф в обе стороны", () => {
    const map = {
      nodes: [{ id: "a.ts", sizeBytes: 10 }],
      edges: [{ from: "a.ts", to: "b.ts", kind: "import" }]
    };
    const diff = diffArchitectMaps(map, map);
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
    expect(diff.changedNodes).toEqual([]);
  });

  it("связь с теми же концами, но другим типом — отдельный ключ", () => {
    const base = { nodes: [], edges: [{ from: "a.ts", to: "b.ts", kind: "import" }] };
    const target = { nodes: [], edges: [{ from: "a.ts", to: "b.ts", kind: "call" }] };
    const diff = diffArchitectMaps(base, target);
    expect(diff.removedEdges).toEqual(["import:a.ts->b.ts"]);
    expect(diff.addedEdges).toEqual(["call:a.ts->b.ts"]);
  });
});
