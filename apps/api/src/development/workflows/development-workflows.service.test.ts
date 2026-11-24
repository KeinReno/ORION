import { describe, expect, it } from "vitest";
import {
  createWorkflowInputSchema,
  updateWorkflowInputSchema,
  workflowEdgeSchema,
  workflowNodeSchema,
  workflowSchema,
  workflowStatusSchema,
  type Workflow
} from "@orion/shared-types";
import { toSummaryDto, toWorkflowDto } from "./development-workflows.service";

describe("workflow schemas", () => {
  it("принимает полный узел и отклоняет узел без обязательных полей графа", () => {
    const parsed = workflowNodeSchema.parse({
      id: "n1",
      type: "agent",
      title: "Собрать контекст",
      description: "",
      agentName: "",
      status: "pending",
      x: 10,
      y: -5
    });
    expect(parsed).toEqual({
      id: "n1",
      type: "agent",
      title: "Собрать контекст",
      description: "",
      agentName: "",
      status: "pending",
      x: 10,
      y: -5
    });
    expect(workflowNodeSchema.safeParse({ id: "n1", type: "agent", title: "A", x: 0, y: 0 }).success).toBe(false);
  });

  it("отклоняет узел с пустым id, пустым title и неизвестным типом", () => {
    expect(workflowNodeSchema.safeParse({ id: "", type: "task", title: "A", x: 0, y: 0 }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ id: "n1", type: "task", title: "", x: 0, y: 0 }).success).toBe(false);
    expect(workflowNodeSchema.safeParse({ id: "n1", type: "mystery", title: "A", x: 0, y: 0 }).success).toBe(false);
  });

  it("ребро требует kind; enum kind ограничен flow/signal", () => {
    expect(workflowEdgeSchema.parse({ id: "e1", source: "a", target: "b", kind: "flow" }).kind).toBe("flow");
    expect(workflowEdgeSchema.parse({ id: "e1", source: "a", target: "b", kind: "signal" }).kind).toBe("signal");
    expect(workflowEdgeSchema.safeParse({ id: "e1", source: "a", target: "b" }).success).toBe(false);
    expect(workflowEdgeSchema.safeParse({ id: "e1", source: "a", target: "b", kind: "jump" }).success).toBe(false);
  });

  it("статусы процесса: draft/active/paused/done", () => {
    expect(workflowStatusSchema.options).toEqual(["draft", "active", "paused", "done"]);
  });

  it("create: name 1..120 обязателен, description не обязателен и не длиннее 2000", () => {
    expect(createWorkflowInputSchema.safeParse({}).success).toBe(false);
    expect(createWorkflowInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createWorkflowInputSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(createWorkflowInputSchema.safeParse({ name: "Релиз", description: "d".repeat(2001) }).success).toBe(false);
    expect(createWorkflowInputSchema.parse({ name: "Релиз" })).toEqual({ name: "Релиз" });
  });

  it("update: граф обязателен, поля метаданных — опциональны", () => {
    const empty = { nodes: [], edges: [] };
    expect(updateWorkflowInputSchema.parse({ ...empty, status: "active" }).status).toBe("active");
    expect(updateWorkflowInputSchema.safeParse({ status: "active" }).success).toBe(false);
    expect(updateWorkflowInputSchema.safeParse({ ...empty, status: "archived" }).success).toBe(false);
  });
});

describe("workflow DTO mapping", () => {
  const row = {
    id: "wf-1",
    name: "Релиз 1.0",
    description: "",
    status: "active",
    nodes: [{ id: "n1", type: "task", title: "T", description: "", agentName: "", status: "done", x: 0, y: 0 }],
    edges: [{ id: "e1", source: "n1", target: "n2", kind: "flow" }],
    createdAt: new Date("2026-11-18T10:00:00.000Z"),
    updatedAt: new Date("2026-11-18T12:00:00.000Z")
  };

  it("toSummaryDto: краткая строка списка без узлов и связей", () => {
    expect(toSummaryDto(row)).toEqual({
      id: "wf-1",
      name: "Релиз 1.0",
      description: "",
      status: "active",
      createdAt: "2026-11-18T10:00:00.000Z",
      updatedAt: "2026-11-18T12:00:00.000Z"
    });
  });

  it("toWorkflowDto: полный процесс проходит workflowSchema", () => {
    const dto = toWorkflowDto(row);
    expect(workflowSchema.parse(dto)).toEqual(dto);
    expect((dto as Workflow).nodes).toHaveLength(1);
    expect((dto as Workflow).edges).toHaveLength(1);
  });

  it("toWorkflowDto: битый jsonb даёт пустой граф, а не ошибку", () => {
    const dto = toWorkflowDto({ ...row, nodes: { not: "an array" }, edges: null });
    expect(dto.nodes).toEqual([]);
    expect(dto.edges).toEqual([]);
  });
});
