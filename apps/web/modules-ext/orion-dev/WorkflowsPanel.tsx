"use client";

import { useCore } from "@orion/core-react";
import { Button, EmptyState } from "@orion/ui";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, ArrowLeft, Box, Copy, GitBranch, ListChecks, LoaderCircle, Plus, ScrollText, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createWorkflowsClient, type Workflow, type WorkflowEdge, type WorkflowNode, type WorkflowStatus } from "./workflows-api";
import {
  createWorkflowEdge,
  createWorkflowNode,
  deriveWorkflowEvents,
  deriveWorkflowTrace,
  workflowEdgeKindLabels,
  workflowNodeStatusLabels,
  workflowNodeTypeLabels,
  workflowStatusLabels
} from "./workflows";
import styles from "./workbench-processes.module.css";

type Props = { workspaceId: string };

type FlowData = { node: WorkflowNode };
type FlowNode = Node<FlowData>;

const nodeTypeIcons: Record<WorkflowNode["type"], string> = { task: "☐", agent: "✳", evidence: "≡", decision: "◆", result: "⚑" };
const nodeTypeOrder: WorkflowNode["type"][] = ["task", "agent", "evidence", "decision", "result"];

function decisionGlyph(node: WorkflowNode): string {
  if (node.status === "pass") return "✓";
  if (node.status === "blocked") return "✗";
  return nodeTypeIcons.decision;
}

function NodeGlyph({ node }: { node: WorkflowNode }): React.ReactElement {
  if (node.type === "decision") return <span aria-hidden>{decisionGlyph(node)}</span>;
  if (node.type === "task" && node.status === "done") return <span aria-hidden>✓</span>;
  return <span aria-hidden>{nodeTypeIcons[node.type]}</span>;
}

function WorkflowFlowNode({ data, selected }: NodeProps<FlowNode>): React.ReactElement {
  const node = data.node;
  return <div className={`${styles.nodeCard}${selected ? ` ${styles.nodeCardSelected}` : ""}`} data-status={node.status}>
    <Handle type="target" position={Position.Left} className={styles.nodeHandle} />
    <span className={`${styles.nodeIcon} ${styles[`nodeIcon_${node.type}`]}`}><NodeGlyph node={node} /></span>
    <span className={styles.nodeBody}>
      <strong className={styles.nodeTitle}>{node.title}</strong>
      {node.description ? <small className={styles.nodeDescription}>{node.description}</small> : null}
      {node.type === "agent" && node.agentName ? <small className={styles.nodeAgent}>{node.agentName}</small> : null}
    </span>
    <span className={`${styles.chip} ${styles[`chip_${node.status}`]}`}>{workflowNodeStatusLabels[node.status]}</span>
    <Handle type="source" position={Position.Right} className={styles.nodeHandle} />
  </div>;
}

const flowNodeTypes = { workflow: WorkflowFlowNode };

function toFlowNodes(nodes: WorkflowNode[], selectedNodeId: string | null): FlowNode[] {
  return nodes.map(node => ({
    id: node.id,
    type: "workflow",
    position: { x: node.x, y: node.y },
    selected: node.id === selectedNodeId,
    data: { node }
  }));
}

function toFlowEdges(edges: WorkflowEdge[], selectedEdgeId: string | null): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    selected: edge.id === selectedEdgeId,
    label: workflowEdgeKindLabels[edge.kind],
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.kind === "flow" ? "#d2ad69" : "#b2b0a9" },
    className: edge.kind === "signal" ? styles.edgeSignal : styles.edgeFlow
  }));
}

const statusTone: Record<WorkflowStatus, string> = { draft: "neutral", active: "accent", paused: "warning", done: "success" };

export function WorkflowsPanel({ workspaceId }: Props): React.ReactElement {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const client = useMemo(() => createWorkflowsClient(api, workspaceId), [api, workspaceId]);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const listKey = ["orion-dev-workflows", workspaceId];
  const workflows = useQuery({ queryKey: listKey, retry: false, queryFn: () => client.list() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const submitCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const created = await client.create({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
      setName(""); setDescription(""); setCreating(false);
      await invalidate();
      setEditorId(created.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать процесс."); }
    finally { setBusy(false); }
  };

  const removeWorkflow = async (id: string, title: string) => {
    if (!window.confirm(`Удалить процесс «${title}»? Схема будет удалена без возможности восстановления.`)) return;
    setError("");
    try { await client.remove(id); await invalidate(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить процесс."); }
  };

  if (editorId) return <WorkflowEditor key={editorId} workspaceId={workspaceId} workflowId={editorId} onBack={() => { void invalidate(); setEditorId(null); }} />;

  return <section className={styles.root} aria-label="Процессы">
    <header className={styles.toolbar}>
      <div className={styles.toolbarTitle}><ListChecks size={15} /><span>Процессы</span><span className={styles.countBadge}>{workflows.data?.length ?? 0}</span></div>
      <Button size="sm" variant={creating ? "ghost" : "primary"} aria-pressed={creating} onClick={() => { setCreating(current => !current); setError(""); }}><Plus size={14} aria-hidden /> Новый процесс</Button>
    </header>
    {error && <div role="alert" className={styles.alert}><AlertCircle size={16} /><span>{error}</span></div>}
    {creating && <form className={styles.createForm} onSubmit={event => { event.preventDefault(); void submitCreate(); }}>
      <label>Название<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Например, Проверка релиза 0.24" /></label>
      <label>Описание<input maxLength={600} value={description} onChange={event => setDescription(event.target.value)} placeholder="Зачем нужен этот процесс (необязательно)" /></label>
      <div className={styles.createActions}><Button type="submit" size="sm" disabled={busy || !name.trim()}>{busy ? "Создаём…" : "Создать процесс"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Отмена</Button></div>
    </form>}
    {workflows.isPending ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} /> Загружаем процессы…</div> :
      workflows.isError ? <EmptyState icon={AlertCircle} title="Не удалось загрузить процессы" description="Проверьте подключение и обновите список." action={<Button variant="outline" onClick={() => void workflows.refetch()}>Повторить</Button>} /> :
        workflows.data.length === 0 ? <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><WorkflowIcon size={22} /></span>
          <h3>Создайте первый процесс — визуальную схему работы над задачей</h3>
          <p>Процесс соединяет задачи, агентов, доказательства, решения и результат в один маршрут. Подключите git-репозиторий на вкладке «Git», если процесс опирается на код.</p>
          <div><Button onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> Новый процесс</Button></div>
        </div> : <ul className={styles.list}>
          {workflows.data.map(row => <li key={row.id}>
            <button type="button" className={styles.row} onClick={() => setEditorId(row.id)}>
              <span className={styles.rowMain}><strong>{row.name}</strong>{row.description ? <small>{row.description}</small> : null}</span>
              <span className={`${styles.chip} ${styles[`chip_${statusTone[row.status]}`]}`}>{workflowStatusLabels[row.status]}</span>
              <time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</time>
            </button>
            <Button size="sm" variant="ghost" title="Удалить процесс" aria-label={`Удалить процесс «${row.name}»`} onClick={() => void removeWorkflow(row.id, row.name)}><Trash2 size={14} aria-hidden /></Button>
          </li>)}
        </ul>}
  </section>;
}

interface Draft {
  name: string;
  description: string;
  status: WorkflowStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function WorkflowEditor({ workspaceId, workflowId, onBack }: Props & { workflowId: string; onBack: () => void }): React.ReactElement {
  const { api } = useCore();
  const client = useMemo(() => createWorkflowsClient(api, workspaceId), [api, workspaceId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState<Workflow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeKind, setEdgeKind] = useState<WorkflowEdge["kind"]>("flow");
  const [traceOpen, setTraceOpen] = useState(true);
  const [traceTab, setTraceTab] = useState<"trace" | "events" | "artifacts">("trace");
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef<Draft | null>(null);
  const flowNodesRef = useRef<FlowNode[]>([]);
  draftRef.current = draft;

  useEffect(() => {
    let live = true;
    client.get(workflowId)
      .then(workflow => { if (live) { setLoaded(workflow); setDraft({ name: workflow.name, description: workflow.description, status: workflow.status, nodes: workflow.nodes, edges: workflow.edges }); } })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Не удалось загрузить процесс."); });
    return () => { live = false; };
  }, [client, workflowId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  /** Дебаунсированный автосохранение: серия правок уходит одним PUT. */
  const queueSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const snapshot = draftRef.current;
      if (!snapshot) return;
      saveChain.current = saveChain.current.then(async () => {
        setSaving(true);
        try {
          const saved = await client.update(workflowId, snapshot);
          setLoaded(saved);
          setSaveNotice("Сохранено");
        } catch (cause) { setSaveNotice(""); setError(cause instanceof Error ? cause.message : "Не удалось сохранить процесс."); }
        finally { setSaving(false); }
      });
    }, 600);
  }, [client, workflowId]);

  const patchDraft = useCallback((patch: Partial<Draft>) => {
    setDraft(current => current ? { ...current, ...patch } : current);
    setSaveNotice("");
    queueSave();
  }, [queueSave]);

  const selectedNode = draft?.nodes.find(node => node.id === selectedNodeId) ?? null;
  const selectedEdge = draft?.edges.find(edge => edge.id === selectedEdgeId) ?? null;

  const flowNodes = useMemo(() => draft ? toFlowNodes(draft.nodes, selectedNodeId) : [], [draft, selectedNodeId]);
  const flowEdges = useMemo(() => draft ? toFlowEdges(draft.edges, selectedEdgeId) : [], [draft, selectedEdgeId]);
  flowNodesRef.current = flowNodes;

  const syncPositions = useCallback((next: FlowNode[]) => {
    const current = draftRef.current;
    if (!current) return;
    const positions = new Map(next.map(node => [node.id, node.position]));
    patchDraft({ nodes: current.nodes.map(node => { const position = positions.get(node.id); return position ? { ...node, x: Math.round(position.x), y: Math.round(position.y) } : node; }) });
  }, [patchDraft]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const removed = changes.filter(change => change.type === "remove").map(change => change.id);
    const current = draftRef.current;
    if (removed.length && current) {
      const removedSet = new Set(removed);
      patchDraft({ nodes: current.nodes.filter(node => !removedSet.has(node.id)), edges: current.edges.filter(edge => !removedSet.has(edge.source) && !removedSet.has(edge.target)) });
      if (selectedNodeId && removedSet.has(selectedNodeId)) setSelectedNodeId(null);
    }
    const next = applyNodeChanges(changes, flowNodesRef.current);
    if (changes.some(change => change.type === "position")) syncPositions(next);
  }, [patchDraft, selectedNodeId, syncPositions]);

  // Двойной обработки удаления нет: в управляемом режиме keyboard-delete (deleteKeyCode)
  // приходит теми же remove-изменениями в onNodesChange/onEdgesChange.
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const current = draftRef.current;
    if (!current) return;
    const removed = changes.filter(change => change.type === "remove").map(change => change.id);
    if (removed.length) {
      const removedSet = new Set(removed);
      patchDraft({ edges: current.edges.filter(edge => !removedSet.has(edge.id)) });
      if (selectedEdgeId && removedSet.has(selectedEdgeId)) setSelectedEdgeId(null);
    }
  }, [patchDraft, selectedEdgeId]);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    const current = draftRef.current;
    if (!current || !connection.source || !connection.target) return;
    const edge = createWorkflowEdge(connection.source, connection.target, edgeKind);
    patchDraft({ edges: [...current.edges, edge] });
    setSelectedEdgeId(edge.id);
  }, [edgeKind, patchDraft]);

  const addNode = (type: WorkflowNode["type"]) => {
    const current = draftRef.current;
    if (!current) return;
    const node = createWorkflowNode(type, { x: 90 + (current.nodes.length % 5) * 60, y: 80 + current.nodes.length * 48 });
    patchDraft({ nodes: [...current.nodes, node] });
    setSelectedNodeId(node.id);
  };

  const patchNode = (id: string, patch: Partial<WorkflowNode>) => {
    const current = draftRef.current;
    if (!current) return;
    patchDraft({ nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch } : node) });
  };

  const duplicateNode = (id: string) => {
    const current = draftRef.current;
    if (!current) return;
    const source = current.nodes.find(node => node.id === id);
    if (!source) return;
    const copy = createWorkflowNode(source.type, { x: source.x + 48, y: source.y + 48 });
    patchDraft({ nodes: [...current.nodes, { ...copy, title: source.title, description: source.description, agentName: source.agentName, status: source.status }] });
    setSelectedNodeId(copy.id);
  };

  const removeSelected = () => {
    const current = draftRef.current;
    if (!current) return;
    if (selectedNodeId) {
      const id = selectedNodeId;
      patchDraft({ nodes: current.nodes.filter(node => node.id !== id), edges: current.edges.filter(edge => edge.source !== id && edge.target !== id) });
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      const id = selectedEdgeId;
      patchDraft({ edges: current.edges.filter(edge => edge.id !== id) });
      setSelectedEdgeId(null);
    }
  };

  if (!draft) return <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} /> {error ? error : "Загружаем процесс…"}</div>;

  const trace = deriveWorkflowTrace(draft.nodes, loaded?.updatedAt ?? new Date().toISOString());
  const events = deriveWorkflowEvents({ ...draft, id: workflowId, createdAt: loaded?.createdAt ?? new Date().toISOString(), updatedAt: loaded?.updatedAt ?? new Date().toISOString() });

  return <section className={styles.root} aria-label="Редактор процесса">
    <header className={styles.toolbar}>
      <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14} aria-hidden /> К процессам</Button>
      <input className={styles.nameInput} value={draft.name} maxLength={160} onChange={event => patchDraft({ name: event.target.value })} aria-label="Название процесса" />
      <select className={styles.select} value={draft.status} onChange={event => patchDraft({ status: event.target.value as WorkflowStatus })} aria-label="Статус процесса">
        {(Object.keys(workflowStatusLabels) as WorkflowStatus[]).map(status => <option key={status} value={status}>{workflowStatusLabels[status]}</option>)}
      </select>
      <span className={styles.saveState} role="status" aria-live="polite">{saving ? <><LoaderCircle className={styles.spin} size={13} /> Сохраняем…</> : saveNotice || "Изменения сохраняются автоматически"}</span>
    </header>
    {error && <div role="alert" className={styles.alert}><AlertCircle size={16} /><span>{error}</span></div>}

    <div className={styles.editorLayout}>
      <aside className={styles.palette} aria-label="Добавить узел">
        <h4>Узлы</h4>
        {nodeTypeOrder.map(type => <button key={type} type="button" className={styles.paletteItem} onClick={() => addNode(type)}>
          <span className={`${styles.nodeIcon} ${styles[`nodeIcon_${type}`]}`} aria-hidden>{nodeTypeIcons[type]}</span>
          <span>{workflowNodeTypeLabels[type]}</span><Plus size={13} aria-hidden />
        </button>)}
        <h4>Связь</h4>
        <label className={styles.edgeKindLabel}>Новые связи<select className={styles.select} value={edgeKind} onChange={event => setEdgeKind(event.target.value as WorkflowEdge["kind"])}>
          <option value="flow">основной маршрут</option>
          <option value="signal">альтернативный</option>
        </select></label>
        <p className={styles.paletteHint}>Перетащите связь от правого края узла к левому краю другого. Удаление — клавиша Del или кнопка ниже.</p>
        <div className={styles.paletteActions}>
          <Button size="sm" variant="ghost" disabled={!selectedNodeId && !selectedEdgeId} onClick={removeSelected}><Trash2 size={13} aria-hidden /> Удалить выбранное</Button>
        </div>
      </aside>

      <div className={styles.canvas}>
        <ReactFlowProvider>
          <ReactFlow<FlowNode>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={flowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
            deleteKeyCode={["Backspace", "Delete"]}
            minZoom={0.15} maxZoom={2}
            fitView
            aria-label="Схема процесса">
            <Background color="color-mix(in srgb, var(--wp-border, #3a3b3c) 70%, transparent)" gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" nodeColor={() => "#d2ad69"} maskColor="color-mix(in srgb, #101112 68%, transparent)" />
          </ReactFlow>
        </ReactFlowProvider>
        {draft.nodes.length === 0 && <div className={styles.canvasEmpty}><Box size={20} /><span>Схема пуста. Добавьте первый узел из палитры слева.</span></div>}
      </div>

      <aside className={styles.inspector} aria-label="Свойства узла">
        {selectedNode ? <>
          <div className={styles.inspectorTop}><span className={`${styles.nodeIcon} ${styles[`nodeIcon_${selectedNode.type}`]}`} aria-hidden>{nodeTypeIcons[selectedNode.type]}</span><span>{workflowNodeTypeLabels[selectedNode.type]}</span></div>
          <label className={styles.field}>Заголовок<input value={selectedNode.title} maxLength={160} onChange={event => patchNode(selectedNode.id, { title: event.target.value })} /></label>
          <label className={styles.field}>Описание<textarea rows={3} value={selectedNode.description} maxLength={600} onChange={event => patchNode(selectedNode.id, { description: event.target.value })} /></label>
          {selectedNode.type === "agent" && <label className={styles.field}>Агент<input value={selectedNode.agentName} maxLength={120} placeholder="Имя агента" onChange={event => patchNode(selectedNode.id, { agentName: event.target.value })} /></label>}
          <label className={styles.field}>Статус<select className={styles.select} value={selectedNode.status} onChange={event => patchNode(selectedNode.id, { status: event.target.value as WorkflowNode["status"] })}>
            {(Object.keys(workflowNodeStatusLabels) as WorkflowNode["status"][]).map(status => <option key={status} value={status}>{workflowNodeStatusLabels[status]}</option>)}
          </select></label>
          <div className={styles.inspectorActions}>
            <Button size="sm" variant="ghost" onClick={() => duplicateNode(selectedNode.id)}><Copy size={13} aria-hidden /> Дублировать</Button>
            <Button size="sm" variant="ghost" onClick={() => { const current = draftRef.current; if (current) { patchDraft({ nodes: current.nodes.filter(node => node.id !== selectedNode.id), edges: current.edges.filter(edge => edge.source !== selectedNode.id && edge.target !== selectedNode.id) }); setSelectedNodeId(null); } }}><Trash2 size={13} aria-hidden /> Удалить</Button>
          </div>
        </> : selectedEdge ? <>
          <div className={styles.inspectorTop}><GitBranch size={15} /><span>Связь</span></div>
          <label className={styles.field}>Тип маршрута<select className={styles.select} value={selectedEdge.kind} onChange={event => { const current = draftRef.current; if (current) patchDraft({ edges: current.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, kind: event.target.value as WorkflowEdge["kind"] } : edge) }); }}>
            <option value="flow">основной маршрут</option>
            <option value="signal">альтернативный</option>
          </select></label>
          <p className={styles.paletteHint}>Основной маршрут — сплошная золотая линия; альтернативный — пунктир.</p>
          <div className={styles.inspectorActions}><Button size="sm" variant="ghost" onClick={() => { const current = draftRef.current; if (current) { patchDraft({ edges: current.edges.filter(edge => edge.id !== selectedEdge.id) }); setSelectedEdgeId(null); } }}><Trash2 size={13} aria-hidden /> Удалить связь</Button></div>
        </> : <div className={styles.inspectorEmpty}><Box size={20} /><span>Выберите узел или связь на схеме, чтобы изменить свойства.</span></div>}
      </aside>
    </div>

    <div className={styles.trace}>
      <button type="button" className={styles.traceToggle} aria-expanded={traceOpen} onClick={() => setTraceOpen(current => !current)}>
        <ScrollText size={14} aria-hidden /> Трасса выполнения
        <span className={styles.traceTabs} role="group" aria-label="Содержимое нижней панели" onClick={event => event.stopPropagation()}>
          {([["trace", "Трасса"], ["events", "Журнал событий"], ["artifacts", "Артефакты"]] as const).map(([id, label]) => <span key={id} role="button" tabIndex={0} className={`${styles.traceTab}${traceTab === id ? ` ${styles.traceTabActive}` : ""}`} aria-pressed={traceTab === id} onClick={() => setTraceTab(id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setTraceTab(id); }}>{label}</span>)}
        </span>
      </button>
      {traceOpen && <div className={styles.traceBody}>
        {traceTab === "trace" && (trace.length ? <ol className={styles.traceList}>{trace.map(row => <li key={row.nodeId}>
          <time>{row.time ? new Date(row.time).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "—"}</time>
          <span className={`${styles.chip} ${styles[`chip_${row.status}`]}`}>{row.statusLabel}</span>
          <strong>{row.title}</strong>
          {row.description ? <small>{row.description}</small> : null}
        </li>)}</ol> : <p className={styles.traceEmpty}>Узлов пока нет — трасса появится после добавления узлов на схему.</p>)}
        {traceTab === "events" && (events.length ? <ol className={styles.traceList}>{events.map((event, index) => <li key={index}><time>{new Date(event.at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</time><span className={styles.eventText}>{event.text}</span></li>)}</ol> : <p className={styles.traceEmpty}>Событий пока нет.</p>)}
        {traceTab === "artifacts" && <div className={styles.traceEmpty}><Box size={18} /><p>Артефакты появятся здесь, когда процесс начнёт порождать файлы и доказательства.</p></div>}
      </div>}
    </div>
  </section>;
}
