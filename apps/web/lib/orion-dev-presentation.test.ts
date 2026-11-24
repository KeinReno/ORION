import { describe, expect, it } from "vitest";
import { workflowNodeSchema } from "../modules-ext/orion-dev/workflows-api";
import {
  createWorkflowEdge,
  createWorkflowNode,
  deriveWorkflowEvents,
  deriveWorkflowTrace,
  workflowEdgeKindLabels,
  workflowNodeStatusLabels,
  workflowNodeTypeLabels,
  workflowStatusLabels
} from "../modules-ext/orion-dev/workflows";

const node = (overrides: Partial<ReturnType<typeof createWorkflowNode>> = {}) => ({
  ...createWorkflowNode("task", { x: 0, y: 0 }),
  title: "Узел",
  description: "",
  ...overrides
});

describe("workflow label maps", () => {
  it("covers every node type, node status and workflow status", () => {
    expect(Object.keys(workflowNodeTypeLabels).sort()).toEqual(["agent", "decision", "evidence", "result", "task"]);
    expect(Object.keys(workflowNodeStatusLabels).sort()).toEqual(["active", "blocked", "done", "pass", "pending"]);
    expect(Object.keys(workflowStatusLabels).sort()).toEqual(["active", "done", "draft", "paused"]);
    expect(workflowNodeTypeLabels.task).toBe("Задача");
    expect(workflowStatusLabels.draft).toBe("Черновик");
    expect(workflowNodeStatusLabels.pass).toBe("PASS");
    expect(workflowEdgeKindLabels.flow).toBe("основной маршрут");
  });
});

describe("createWorkflowNode / createWorkflowEdge", () => {
  it("creates a pending node with a stable unique id and rounded position", () => {
    const first = createWorkflowNode("agent", { x: 10.4, y: 20.6 });
    const second = createWorkflowNode("agent", { x: 0, y: 0 });
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("pending");
    expect(first.type).toBe("agent");
    expect(first.x).toBe(10);
    expect(first.y).toBe(21);
    expect(workflowNodeSchema.parse(first)).toEqual(first);
  });
  it("creates edges with kind and unique ids", () => {
    const edge = createWorkflowEdge("a", "b", "signal");
    expect(edge).toMatchObject({ source: "a", target: "b", kind: "signal" });
    expect(createWorkflowEdge("a", "b").kind).toBe("flow");
  });
});

describe("deriveWorkflowTrace", () => {
  const updatedAt = "2026-11-18T12:00:00.000Z";
  it("orders rows by canvas reading order (top-to-bottom, left-to-right)", () => {
    const rows = deriveWorkflowTrace([
      node({ id: "right", title: "Правый", x: 300, y: 0 }),
      node({ id: "second-line", title: "Ниже", x: 0, y: 140 }),
      node({ id: "left", title: "Левый", x: 0, y: 0 })
    ], updatedAt);
    expect(rows.map(row => row.nodeId)).toEqual(["left", "right", "second-line"]);
  });
  it("uses the updatedAt placeholder only for touched nodes", () => {
    const rows = deriveWorkflowTrace([
      node({ id: "waiting", status: "pending" }),
      node({ id: "working", status: "active" })
    ], updatedAt);
    expect(rows.find(row => row.nodeId === "waiting")?.time).toBeNull();
    expect(rows.find(row => row.nodeId === "working")?.time).toBe(updatedAt);
    expect(rows.find(row => row.nodeId === "working")?.statusLabel).toBe("В работе");
  });
});

describe("deriveWorkflowEvents", () => {
  const base = {
    id: "workflow",
    name: "Процесс",
    description: "",
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-18T12:00:00.000Z"
  };
  it("always starts with process creation and skips pending nodes", () => {
    const events = deriveWorkflowEvents({ ...base, status: "draft", nodes: [node({ title: "А", status: "pending" })], edges: [] });
    expect(events).toEqual([{ at: base.createdAt, text: "Процесс создан" }]);
  });
  it("derives status transitions for the process and touched nodes", () => {
    const events = deriveWorkflowEvents({
      ...base, status: "active",
      nodes: [node({ title: "Проверка", status: "done" }), node({ title: "Приёмка", status: "pass" })],
      edges: []
    });
    expect(events.map(event => event.text)).toEqual([
      "Процесс создан",
      "Процесс переведён в «В работе»",
      "Узел «Проверка» переведён в «Готово»",
      "Узел «Приёмка» переведён в «PASS»"
    ]);
  });
});
