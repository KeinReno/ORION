"use client";

import { useCore } from "@orion/core-react";
import { Button, EmptyState } from "@orion/ui";
import {
  applyNodeChanges,
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, ArrowDownLeft, ArrowLeft, ArrowUpRight, Box, Copy, GitBranch, ListChecks, LoaderCircle, Maximize2, Minus, Plus, Redo2, ScrollText, Trash2, Undo2, Workflow as WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createWorkflowsClient, type WorkflowEdge, type WorkflowNode, type WorkflowStatus } from "./workflows-api";
import {
  createWorkflowEdge,
  createWorkflowNode,
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
    <div className={styles.nodeHeader}>
      <span className={`${styles.nodeIcon} ${styles[`nodeIcon_${node.type}`]}`} aria-hidden><NodeGlyph node={node} /></span>
      <span className={styles.nodeKind}>{workflowNodeTypeLabels[node.type]}</span>
    </div>
    <strong className={styles.nodeTitle}>{node.title}</strong>
    {node.description ? <small className={styles.nodeDescription}>{node.description}</small> : null}
    <div className={styles.nodeFooter}>
      {node.type === "agent" && node.agentName ? <small className={styles.nodeAgent}>{node.agentName}</small> : <span />}
      <span className={`${styles.chip} ${styles[`chip_${node.status}`]}`}>{workflowNodeStatusLabels[node.status]}</span>
    </div>
    <Handle type="source" position={Position.Right} className={styles.nodeHandle} />
  </div>;
}

const flowNodeTypes = { workflow: WorkflowFlowNode };

type CanvasMenuState = { left: number; top: number; clientX: number; clientY: number; nodeId: string | null };

function WorkflowCanvasToolbar({ canUndo, canRedo, miniMapOpen, onUndo, onRedo, onToggleMiniMap }: {
  canUndo: boolean;
  canRedo: boolean;
  miniMapOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleMiniMap: () => void;
}): React.ReactElement {
  const flow = useReactFlow<FlowNode>();
  const { zoom } = useViewport();
  return <div className={styles.canvasToolbar} role="toolbar" aria-label="Управление схемой">
    <button type="button" title="Отменить (Ctrl+Z)" aria-label="Отменить" disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></button>
    <button type="button" title="Повторить (Ctrl+Y)" aria-label="Повторить" disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></button>
    <span className={styles.toolbarDivider} aria-hidden />
    <button type="button" title="Уменьшить масштаб" aria-label="Уменьшить масштаб" onClick={() => void flow.zoomOut()}><Minus size={15} /></button>
    <span className={styles.zoomValue} aria-live="polite">{Math.round(zoom * 100)}%</span>
    <button type="button" title="Увеличить масштаб" aria-label="Увеличить масштаб" onClick={() => void flow.zoomIn()}><Plus size={15} /></button>
    <button type="button" title="Вписать схему" aria-label="Вписать схему" onClick={() => void flow.fitView({ padding: 0.16, duration: 180 })}><Maximize2 size={15} /></button>
    <span className={styles.toolbarDivider} aria-hidden />
    <button type="button" title={miniMapOpen ? "Скрыть мини-карту" : "Показать мини-карту"} aria-label={miniMapOpen ? "Скрыть мини-карту" : "Показать мини-карту"} aria-pressed={miniMapOpen} onClick={onToggleMiniMap}><MapIcon /></button>
  </div>;
}

function MapIcon(): React.ReactElement {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15m6-12v15" /></svg>;
}

function WorkflowCanvasMenu({ menu, onClose, onAdd, onDuplicate, onDelete }: {
  menu: CanvasMenuState | null;
  onClose: () => void;
  onAdd: (type: WorkflowNode["type"], position: { x: number; y: number }) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}): React.ReactElement | null {
  const flow = useReactFlow<FlowNode>();
  if (!menu) return null;
  const addAtPointer = (type: WorkflowNode["type"]) => {
    const point = flow.screenToFlowPosition({ x: menu.clientX, y: menu.clientY });
    onAdd(type, { x: point.x - 116, y: point.y - 63 });
    onClose();
  };
  return <div className={styles.canvasMenu} role="group" aria-label={menu.nodeId ? "Действия узла" : "Добавить узел на холст"} style={{ left: menu.left, top: menu.top }} onContextMenu={event => event.preventDefault()}>
    {menu.nodeId ? <>
      <span className={styles.canvasMenuLabel}>ДЕЙСТВИЯ УЗЛА</span>
      <button type="button" onClick={() => { onDuplicate(menu.nodeId!); onClose(); }}><Copy size={14} /> Дублировать узел</button>
      <button type="button" onClick={() => { onDelete(menu.nodeId!); onClose(); }}><Trash2 size={14} /> Удалить узел</button>
    </> : <>
      <span className={styles.canvasMenuLabel}>ДОБАВИТЬ УЗЕЛ СЮДА</span>
      {nodeTypeOrder.map(type => <button key={type} type="button" onClick={() => addAtPointer(type)}>
        <span className={`${styles.nodeIcon} ${styles[`nodeIcon_${type}`]}`} aria-hidden>{nodeTypeIcons[type]}</span>{workflowNodeTypeLabels[type]}
      </button>)}
      <span className={styles.canvasMenuDivider} />
      <button type="button" onClick={() => { void flow.fitView({ padding: 0.16, duration: 180 }); onClose(); }}><Maximize2 size={14} /> Вписать схему</button>
    </>}
  </div>;
}

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
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.kind === "flow" ? "var(--wp-accent)" : "var(--wp-muted)" },
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

function cloneDraft(draft: Draft): Draft {
  return JSON.parse(JSON.stringify(draft)) as Draft;
}

function WorkflowEditor({ workspaceId, workflowId, onBack }: Props & { workflowId: string; onBack: () => void }): React.ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { api } = useCore();
  const client = useMemo(() => createWorkflowsClient(api, workspaceId), [api, workspaceId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeKind, setEdgeKind] = useState<WorkflowEdge["kind"]>("flow");
  const [traceOpen, setTraceOpen] = useState(false);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
  const [, setHistoryRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true));
  const draftRef = useRef<Draft | null>(null);
  const savedDraft = useRef<Draft | null>(null);
  const flowNodesRef = useRef<FlowNode[]>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragHistoryActive = useRef(false);
  const history = useRef<{ past: Draft[]; future: Draft[] }>({ past: [], future: [] });
  draftRef.current = draft;

  useEffect(() => {
    let live = true;
    client.get(workflowId)
      .then(workflow => {
        if (!live) return;
        const snapshot = { name: workflow.name, description: workflow.description, status: workflow.status, nodes: workflow.nodes, edges: workflow.edges };
        savedDraft.current = snapshot;
        setDraft(snapshot);
      })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Не удалось загрузить процесс."); });
    return () => { live = false; };
  }, [client, workflowId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persist = useCallback((snapshot: Draft) => {
    saveChain.current = saveChain.current.then(async () => {
      if (savedDraft.current === snapshot) return true;
      setSaving(true);
      try {
        await client.update(workflowId, snapshot);
        savedDraft.current = snapshot;
        setSaveNotice("Сохранено");
        setError("");
        return true;
      } catch (cause) {
        setSaveNotice("");
        setError(cause instanceof Error ? cause.message : "Не удалось сохранить процесс.");
        return false;
      } finally {
        setSaving(false);
      }
    });
    return saveChain.current;
  }, [client, workflowId]);

  /** Серия правок уходит одним PUT. */
  const queueSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const snapshot = draftRef.current;
      if (snapshot) void persist(snapshot);
    }, 600);
  }, [persist]);

  const returnToList = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setLeaving(true);
    // If a user edits while the request is in flight, flush the newer draft as well.
    while (draftRef.current) {
      const snapshot = draftRef.current;
      if (!(await persist(snapshot))) {
        setLeaving(false);
        return;
      }
      if (draftRef.current === snapshot) break;
    }
    onBack();
  };

  const recordHistory = useCallback(() => {
    if (dragHistoryActive.current) return;
    const current = draftRef.current;
    if (!current) return;
    const snapshot = JSON.stringify(current);
    const past = history.current.past;
    if (past.length && JSON.stringify(past[past.length - 1]) === snapshot) return;
    past.push(cloneDraft(current));
    if (past.length > 80) past.shift();
    history.current.future = [];
    setHistoryRevision(value => value + 1);
  }, []);

  const queueHistoryRestore = useCallback((next: Draft) => {
    const snapshot = cloneDraft(next);
    draftRef.current = snapshot;
    setDraft(snapshot);
    setSaveNotice("");
    queueSave();
  }, [queueSave]);

  const undo = useCallback(() => {
    const previous = history.current.past.pop();
    const current = draftRef.current;
    if (!previous || !current) return;
    history.current.future.push(cloneDraft(current));
    setHistoryRevision(value => value + 1);
    queueHistoryRestore(previous);
  }, [queueHistoryRestore]);

  const redo = useCallback(() => {
    const next = history.current.future.pop();
    const current = draftRef.current;
    if (!next || !current) return;
    history.current.past.push(cloneDraft(current));
    setHistoryRevision(value => value + 1);
    queueHistoryRestore(next);
  }, [queueHistoryRestore]);

  const patchDraft = useCallback((patch: Partial<Draft>) => {
    recordHistory();
    setDraft(current => current ? { ...current, ...patch } : current);
    setSaveNotice("");
    queueSave();
  }, [queueSave, recordHistory]);

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

  const onNodeDragStart = useCallback(() => {
    recordHistory();
    dragHistoryActive.current = true;
  }, [recordHistory]);

  const onNodeDragStop = useCallback(() => { dragHistoryActive.current = false; }, []);

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

  const addNode = (type: WorkflowNode["type"], at?: { x: number; y: number }) => {
    const current = draftRef.current;
    if (!current) return;
    let index = 0;
    const nextPosition = () => ({ x: 64 + (index % 2) * 280, y: 64 + Math.floor(index / 2) * 120 });
    let position = nextPosition();
    while (current.nodes.some(node => Math.abs(node.x - position.x) < 240 && Math.abs(node.y - position.y) < 100)) {
      index += 1;
      position = nextPosition();
    }
    const node = createWorkflowNode(type, at ?? position);
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

  const deleteNode = (id: string) => {
    const current = draftRef.current;
    if (!current) return;
    patchDraft({ nodes: current.nodes.filter(node => node.id !== id), edges: current.edges.filter(edge => edge.source !== id && edge.target !== id) });
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const openCanvasMenu = (event: MouseEvent | React.MouseEvent, nodeId: string | null = null) => {
    event.preventDefault();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const left = Math.max(6, Math.min(event.clientX - bounds.left, bounds.width - 228));
    const top = Math.max(6, Math.min(event.clientY - bounds.top, bounds.height - (nodeId ? 118 : 310)));
    if (nodeId) { setSelectedNodeId(nodeId); setSelectedEdgeId(null); }
    canvasRef.current?.focus({ preventScroll: true });
    setCanvasMenu({ left, top, clientX: event.clientX, clientY: event.clientY, nodeId });
  };

  const closeCanvasMenu = () => {
    setCanvasMenu(null);
    canvasRef.current?.focus({ preventScroll: true });
  };

  const selectedConnections: Array<{ edge: WorkflowEdge; neighbor: WorkflowNode; direction: "in" | "out" }> = [];
  if (selectedNode && draft) for (const edge of draft.edges) {
    if (edge.source === selectedNode.id) {
      const neighbor = draft.nodes.find(node => node.id === edge.target);
      if (neighbor) selectedConnections.push({ edge, neighbor, direction: "out" });
    } else if (edge.target === selectedNode.id) {
      const neighbor = draft.nodes.find(node => node.id === edge.source);
      if (neighbor) selectedConnections.push({ edge, neighbor, direction: "in" });
    }
  }
  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;

  if (!draft) return <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} /> {error ? error : "Загружаем процесс…"}</div>;


  return <section className={styles.root} aria-label="Редактор процесса" onKeyDown={event => {
    if (event.key === "Escape" && canvasMenu) { setCanvasMenu(null); return; }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  }}>
    <header className={styles.toolbar}>
      <Button size="sm" variant="ghost" disabled={leaving} onClick={() => void returnToList()}><ArrowLeft size={14} aria-hidden /> К процессам</Button>
      <input className={styles.nameInput} value={draft.name} maxLength={160} onChange={event => patchDraft({ name: event.target.value })} aria-label="Название процесса" />
      <select className={styles.select} value={draft.status} onChange={event => patchDraft({ status: event.target.value as WorkflowStatus })} aria-label="Статус процесса">
        {(Object.keys(workflowStatusLabels) as WorkflowStatus[]).map(status => <option key={status} value={status}>{workflowStatusLabels[status]}</option>)}
      </select>
      <Button size="sm" variant="ghost" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(value => !value)}>{paletteOpen ? "Скрыть инструменты" : "Инструменты процесса"}</Button>
      <span className={styles.saveState} role="status" aria-live="polite">{saving ? <><LoaderCircle className={styles.spin} size={13} /> Сохраняем…</> : saveNotice || "Изменения сохраняются автоматически"}</span>
    </header>
    {error && <div role="alert" className={styles.alert}><AlertCircle size={16} /><span>{error}</span></div>}

    <div className={styles.editorLayout} data-palette={paletteOpen}>
      <aside hidden={!paletteOpen} className={styles.palette} aria-label="Добавить узел">
        <h4>Добавить узел</h4>
        {nodeTypeOrder.map(type => <button key={type} type="button" className={styles.paletteItem} onClick={() => addNode(type)}>
          <span className={`${styles.nodeIcon} ${styles[`nodeIcon_${type}`]}`} aria-hidden>{nodeTypeIcons[type]}</span>
          <span>{workflowNodeTypeLabels[type]}</span><Plus size={13} aria-hidden />
        </button>)}
        <h4>Связь</h4>
        <label className={styles.edgeKindLabel}>Новые связи<select className={styles.select} value={edgeKind} onChange={event => setEdgeKind(event.target.value as WorkflowEdge["kind"])}>
          <option value="flow">основной маршрут</option>
          <option value="signal">альтернативный</option>
        </select></label>
        <p className={styles.paletteHint}>Соедините выход одного узла со входом другого.</p>
        <div className={styles.paletteActions}>
          <Button size="sm" variant="ghost" disabled={!selectedNodeId && !selectedEdgeId} onClick={removeSelected}><Trash2 size={13} aria-hidden /> Удалить выбранное</Button>
        </div>
      </aside>

      <div className={styles.canvas} ref={canvasRef} tabIndex={-1} onClick={() => { if (canvasMenu) setCanvasMenu(null); }}>
        <ReactFlowProvider key={draft.nodes.length ? "graph" : "empty"}>
          <ReactFlow<FlowNode>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={flowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_event, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); canvasRef.current?.focus({ preventScroll: true }); }}
            onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onNodeContextMenu={(event, node) => openCanvasMenu(event, node.id)}
            onPaneContextMenu={event => openCanvasMenu(event)}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); setCanvasMenu(null); canvasRef.current?.focus({ preventScroll: true }); }}
            deleteKeyCode={["Backspace", "Delete"]}
            minZoom={0.15} maxZoom={2}
            fitView={draft.nodes.length > 0}
            fitViewOptions={{ padding: 0.16, maxZoom: 1, ...(draft.nodes.length === 1 ? { minZoom: 0.9 } : {}) }}
            aria-label="Схема процесса">
            <Background color="color-mix(in srgb, var(--wp-border, #3a3b3c) 70%, transparent)" gap={24} size={1} />
            <Panel position="bottom-center"><WorkflowCanvasToolbar canUndo={canUndo} canRedo={canRedo} miniMapOpen={miniMapOpen} onUndo={undo} onRedo={redo} onToggleMiniMap={() => setMiniMapOpen(open => !open)} /></Panel>
            {miniMapOpen && <MiniMap pannable zoomable position="bottom-right" nodeColor="var(--wp-accent)" maskColor="color-mix(in srgb, var(--wp-canvas) 68%, transparent)" />}
            <WorkflowCanvasMenu menu={canvasMenu} onClose={closeCanvasMenu} onAdd={addNode} onDuplicate={duplicateNode} onDelete={deleteNode} />
          </ReactFlow>
        </ReactFlowProvider>
        {draft.nodes.length === 0 && <div className={styles.canvasEmpty}><Box size={20} /><span>Откройте инструменты процесса, чтобы добавить первый узел.</span></div>}
      </div>

      <aside hidden={!selectedNode && !selectedEdge} className={styles.inspector} aria-label="Свойства узла">
        <Button size="sm" variant="ghost" aria-label="Закрыть свойства узла" onClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}>Закрыть</Button>
        {selectedNode ? <>
          <div className={styles.inspectorHeading}>
            <div className={styles.inspectorTop}><span className={`${styles.nodeIcon} ${styles[`nodeIcon_${selectedNode.type}`]}`} aria-hidden>{nodeTypeIcons[selectedNode.type]}</span><span>{workflowNodeTypeLabels[selectedNode.type]}</span></div>
            <h3>{selectedNode.title}</h3>
          </div>
          <label className={styles.field}>Заголовок<input value={selectedNode.title} maxLength={160} onChange={event => patchNode(selectedNode.id, { title: event.target.value })} /></label>
          <label className={styles.field}>Описание<textarea rows={3} value={selectedNode.description} maxLength={600} onChange={event => patchNode(selectedNode.id, { description: event.target.value })} /></label>
          {selectedNode.type === "agent" && <label className={styles.field}>Агент<input value={selectedNode.agentName} maxLength={120} placeholder="Имя агента" onChange={event => patchNode(selectedNode.id, { agentName: event.target.value })} /></label>}
          <label className={styles.field}>Статус<select className={styles.select} value={selectedNode.status} onChange={event => patchNode(selectedNode.id, { status: event.target.value as WorkflowNode["status"] })}>
            {(Object.keys(workflowNodeStatusLabels) as WorkflowNode["status"][]).map(status => <option key={status} value={status}>{workflowNodeStatusLabels[status]}</option>)}
          </select></label>
          <section className={styles.relationSection} aria-label="Связи узла">
            <h4>Связи <span>{selectedConnections.length}</span></h4>
            {selectedConnections.length ? <ul>{selectedConnections.map(({ edge, neighbor, direction }) => <li key={edge.id}>
              <button type="button" className={styles.relationTarget} onClick={() => { setSelectedNodeId(neighbor.id); setSelectedEdgeId(null); }}>
                {direction === "out" ? <ArrowUpRight size={14} aria-label="Исходящая" /> : <ArrowDownLeft size={14} aria-label="Входящая" />}
                <span>{neighbor.title}</span><small>{edge.kind === "flow" ? "Маршрут" : "Сигнал"}</small>
              </button>
              <button type="button" className={styles.unlinkButton} aria-label={`Удалить связь с «${neighbor.title}»`} title="Удалить связь" onClick={() => patchDraft({ edges: draft.edges.filter(item => item.id !== edge.id) })}><Trash2 size={13} /></button>
            </li>)}</ul> : <p>Пока нет связей. Соедините этот узел с соседним на схеме.</p>}
          </section>
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
        <ScrollText size={14} aria-hidden /> Состояние узлов
        <span className={styles.summaryCount}>{draft.nodes.length}</span>
      </button>
      {traceOpen && <div className={styles.traceBody}>
        {draft.nodes.length ? <ul className={styles.traceList}>{draft.nodes.map(node => <li key={node.id}>
          <button type="button" className={styles.summaryRow} onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}>
            <strong>{node.title}</strong>
            <span className={`${styles.chip} ${styles[`chip_${node.status}`]}`}>{workflowNodeStatusLabels[node.status]}</span>
          </button>
        </li>)}</ul> : <p className={styles.traceEmpty}>Узлов пока нет.</p>}
      </div>}
    </div>
  </section>;
}
