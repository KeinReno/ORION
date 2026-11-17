import type { Workflow, WorkflowEdge, WorkflowNode } from "./workflows-api";

export const workflowNodeTypeLabels: Record<WorkflowNode["type"], string> = {
  task: "Задача",
  agent: "Агент",
  evidence: "Доказательство",
  decision: "Решение",
  result: "Результат"
};

export const workflowStatusLabels: Record<Workflow["status"], string> = {
  draft: "Черновик",
  active: "В работе",
  paused: "Приостановлен",
  done: "Завершён"
};

export const workflowNodeStatusLabels: Record<WorkflowNode["status"], string> = {
  pending: "Ожидание",
  active: "В работе",
  done: "Готово",
  pass: "PASS",
  blocked: "Заблокировано"
};

export const workflowEdgeKindLabels: Record<WorkflowEdge["kind"], string> = {
  flow: "основной маршрут",
  signal: "альтернативный"
};

let nodeSequence = 0;

/** Новый узел процесса: стабильный id, статус по умолчанию, позиция на сетке. */
export function createWorkflowNode(type: WorkflowNode["type"], position: { x: number; y: number }): WorkflowNode {
  nodeSequence += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${nodeSequence}`;
  return {
    id: `node-${random}`,
    type,
    title: workflowNodeTypeLabels[type],
    description: "",
    agentName: "",
    status: "pending",
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
}

let edgeSequence = 0;

/** Новая связь между узлами. */
export function createWorkflowEdge(source: string, target: string, kind: WorkflowEdge["kind"] = "flow"): WorkflowEdge {
  edgeSequence += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${edgeSequence}`;
  return { id: `edge-${random}`, source, target, kind };
}

export interface WorkflowTraceRow {
  nodeId: string;
  typeLabel: string;
  title: string;
  description: string;
  status: WorkflowNode["status"];
  statusLabel: string;
  /** Время последнего изменения узла; «—» в интерфейсе, пока узел не тронут. */
  time: string | null;
}

/**
 * Трасса выполнения — производное представление узлов процесса без отдельной таблицы событий.
 * Порядок строк — порядок чтения схемы сверху вниз, слева направо (по позициям на канве).
 * Время: updatedAt процесса как заполнитель для затронутых узлов, null — для узлов в «Ожидании».
 */
export function deriveWorkflowTrace(nodes: ReadonlyArray<WorkflowNode>, updatedAt: string): WorkflowTraceRow[] {
  return [...nodes]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(node => ({
      nodeId: node.id,
      typeLabel: workflowNodeTypeLabels[node.type],
      title: node.title,
      description: node.description,
      status: node.status,
      statusLabel: workflowNodeStatusLabels[node.status],
      time: node.status === "pending" ? null : updatedAt
    }));
}

export interface WorkflowEvent {
  at: string;
  text: string;
}

/**
 * Журнал событий — выводится из текущих статусов процесса и узлов (stateless, без backend events).
 */
export function deriveWorkflowEvents(workflow: Workflow): WorkflowEvent[] {
  const events: WorkflowEvent[] = [{ at: workflow.createdAt, text: "Процесс создан" }];
  if (workflow.status !== "draft") events.push({ at: workflow.updatedAt, text: `Процесс переведён в «${workflowStatusLabels[workflow.status]}»` });
  for (const node of workflow.nodes) {
    if (node.status === "pending") continue;
    events.push({ at: workflow.updatedAt, text: `Узел «${node.title}» переведён в «${workflowNodeStatusLabels[node.status]}»` });
  }
  return events;
}
