"use client";

import { useCore } from "@orion/core-react";
import { architectureCodeNeighborhood, type ArchitectureEdge, type ArchitectureEdgeKind, type ArchitectureNode, type ArchitectEdge, type ArchitectLaunch, type ArchitectNode } from "@orion/shared-types";
import { Button } from "@orion/ui";
import {
  applyEdgeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, ArrowLeft, Box, Check, LoaderCircle, Plus, Trash2, Undo2, Redo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createArchitectureDiagramsClient, updateArchitectureDiagramInputSchema, type ArchitectCodeTarget } from "./architecture-api";
import styles from "./architecture-canvas.module.css";

type GraphDraft = { name: string; description: string; nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; viewport: { x: number; y: number; zoom: number } | null };
type FlowData = { node: ArchitectureNode; origin: "scheme" | "code"; dim: boolean };
type FlowNode = Node<FlowData, "part">;
type FlowEdge = Edge<{ kind: ArchitectureEdgeKind }>;

const EMPTY_CODE_NODES: ArchitectNode[] = [];
const EMPTY_CODE_EDGES: ArchitectEdge[] = [];

const edgeLabels: Record<ArchitectureEdgeKind, string> = { depends: "зависит от", launches: "запускает" };
const repoKey = (workspaceId: string, diagramId: string) => `orion-dev.architecture.repo.v1:${workspaceId}:${diagramId}`;
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `part-${Date.now()}`;
const clone = (value: GraphDraft): GraphDraft => JSON.parse(JSON.stringify(value)) as GraphDraft;

function codeModulesOf(nodes: ArchitectNode[]): ArchitectNode[] {
  return nodes.filter(node => node.kind === "module" || node.kind === "crate" || (node.kind === "dir" && node.depth === 1)).slice(0, 80);
}

function PartCard({ data }: NodeProps<FlowNode>): React.ReactElement {
  const node = data.node;
  const tone = data.origin === "code" ? styles.nodeCode : node.binding ? styles.nodeBound : styles.nodeIntent;
  return <div className={`${styles.nodeCard} ${node.kind === "boundary" ? styles.groupCard : ""} ${tone} ${data.dim ? styles.nodeDim : ""}`} style={{ ["--node-accent" as string]: node.kind === "boundary" ? "#9aa0a6" : "#d7b36b" }}>
    <Handle type="target" position={Position.Left} className={styles.nodeHandle} />
    <div className={styles.nodeTop}><span>{node.kind === "boundary" ? "▢" : "◈"}</span><span>{node.kind === "boundary" ? "Граница" : data.origin === "code" ? "Только в коде" : node.binding ? "Есть привязка" : "Замысел"}</span></div>
    <strong className={styles.nodeTitle}>{node.title}</strong>
    {node.purpose ? <small className={styles.nodeDescription}>{node.purpose}</small> : null}
    <div className={styles.nodeFoot}><code>{node.binding?.path ?? "путь не задан"}</code></div>
    <Handle type="source" position={Position.Right} className={styles.nodeHandle} />
  </div>;
}

const nodeTypes = { part: PartCard };

function linkLabel(path: string): string {
  return path.startsWith("external:") ? path.slice("external:".length) : path;
}

function launchesUnder(root: string, launches: ArchitectLaunch[]): ArchitectLaunch[] {
  return launches.filter(item => item.path === root || item.path.startsWith(`${root}/`)).slice(0, 8);
}

function CodeFacts({ path, repositoryReady, edges, launches }: { path: string; repositoryReady: boolean; edges: ArchitectEdge[]; launches: ArchitectLaunch[] }): React.ReactElement {
  const neighborhood = path && repositoryReady ? architectureCodeNeighborhood(path, edges) : null;
  const depends = neighborhood?.dependsOn.slice(0, 8) ?? [];
  const used = neighborhood?.usedBy.slice(0, 8) ?? [];
  const started = path && repositoryReady ? launchesUnder(path, launches) : [];
  return <section className={styles.connections} aria-label="Факты из кода">
    <h4>В коде</h4>
    {!path ? <p>Укажите путь к части системы.</p> : !repositoryReady ? <p>Данные сверки для этой привязки недоступны.</p> : !neighborhood?.seen ? <p>В прочитанных импортах этот путь не встречается.</p> : <>
      <p>Зависит от</p>
      {depends.length ? depends.map(link => <p key={link.path}>{linkLabel(link.path)}</p>) : <p>В прочитанных файлах внешние импорты не найдены.</p>}
      {(neighborhood?.dependsOn.length ?? 0) > depends.length && <p>Ещё {neighborhood!.dependsOn.length - depends.length}.</p>}
      <p>Кто использует</p>
      {used.length ? used.map(link => <p key={link.path}>{linkLabel(link.path)}</p>) : <p>В прочитанных файлах ссылки на этот путь не найдены.</p>}
      {(neighborhood?.usedBy.length ?? 0) > used.length && <p>Ещё {neighborhood!.usedBy.length - used.length}.</p>}
    </>}
    {repositoryReady && path ? <p>Запускает</p> : null}
    {repositoryReady && path && started.length === 0 ? <p>Анализатор не распознал точки запуска по этому пути.</p> : started.map(item => <p key={`${item.kind}:${item.path}:${item.label}`}>{item.label}</p>)}
  </section>;
}

type CanvasProps = { workspaceId: string; onOpenCode?: (target: ArchitectCodeTarget) => void };

export function ArchitectureCanvas({ workspaceId, onOpenCode }: CanvasProps): React.ReactElement {
  const { api } = useCore();
  const client = useMemo(() => createArchitectureDiagramsClient(api, workspaceId), [api, workspaceId]);
  const [items, setItems] = useState<Array<{ id: string; name: string; description: string; nodeCount: number; edgeCount: number; updatedAt: string; createdAt: string }>>([]);
  const [repositories, setRepositories] = useState<Array<{ id: string; name: string }>>([]);
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GraphDraft | null>(null);
  const [revision, setRevision] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [view, setView] = useState<"structure" | "behavior">("structure");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [edgeKind, setEdgeKind] = useState<ArchitectureEdgeKind>("depends");
  const [repositoryId, setRepositoryId] = useState("");
  const [codeMap, setCodeMap] = useState<{ repositoryId: string; nodes: ArchitectNode[]; edges: ArchitectEdge[]; launches: ArchitectLaunch[] } | null>(null);
  const currentMap = codeMap?.repositoryId === repositoryId ? codeMap : null;
  const codeNodes = currentMap?.nodes ?? EMPTY_CODE_NODES;
  const codeEdges = currentMap?.edges ?? EMPTY_CODE_EDGES;
  const [codeNote, setCodeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("Сохранение автоматически");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [historyTick, setHistoryTick] = useState(0);
  const { screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>();
  const stageRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<GraphDraft | null>(null);
  const revisionRef = useRef(revision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const persistedDraft = useRef<GraphDraft | null>(null);
  const navigationPending = useRef(false);
  const history = useRef<{ past: GraphDraft[]; future: GraphDraft[] }>({ past: [], future: [] });

  const refreshItems = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const [diagrams, repos] = await Promise.all([client.list(), client.repositories().catch(() => [])]);
      setItems(diagrams);
      setRepositories(repos.map(({ id, name }) => ({ id, name })));
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "Не удалось загрузить схемы.");
    } finally { setLoadingList(false); }
  }, [client]);
  useEffect(() => { void refreshItems(); }, [refreshItems]);
  const flushSave = useCallback((id: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    saveQueue.current = saveQueue.current.then(async () => {
      const snapshot = draftRef.current;
      if (!snapshot || snapshot === persistedDraft.current) return true;
      setSaving(true);
      setNotice("Сохраняем…");
      try {
        const { name, description, nodes, edges, viewport } = snapshot;
        const input = updateArchitectureDiagramInputSchema.safeParse({
          name, description, graph: { nodes, edges, viewport }, expectedRevision: revisionRef.current
        });
        if (!input.success) {
          const issue = input.error.issues[0];
          const message = !name.trim() ? "Введите название схемы." :
            nodes.some(node => !node.title.trim()) ? "Заполните названия частей схемы." :
            issue.message;
          throw new Error(message);
        }
        const saved = await client.update(id, input.data);
        persistedDraft.current = snapshot;
        revisionRef.current = saved.revision;
        setRevision(saved.revision);
        setNotice(draftRef.current === snapshot ? "Все изменения сохранены" : "Есть несохранённые изменения");
        setError("");
        return true;
      } catch (cause) {
        setNotice("Не сохранено");
        setError(cause instanceof Error ? cause.message : "Не удалось сохранить схему.");
        return false;
      } finally { setSaving(false); }
    });
    return saveQueue.current;
  }, [client]);

  useEffect(() => {
    if (!diagramId) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (draftRef.current === persistedDraft.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => {
      window.removeEventListener("beforeunload", protectDraft);
      if (timer.current) void flushSave(diagramId);
    };
  }, [diagramId, flushSave]);

  const scheduleSave = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice("Есть несохранённые изменения");
    timer.current = setTimeout(() => { void flushSave(id); }, 450);
  }, [flushSave]);

  const applyDraft = useCallback((next: GraphDraft, track = true) => {
    if (navigationPending.current) return;
    const before = draftRef.current;
    if (track && before) {
      history.current.past = [...history.current.past.slice(-80), clone(before)];
      history.current.future = [];
      setHistoryTick(value => value + 1);
    }
    draftRef.current = next;
    setDraft(next);
    if (diagramId) scheduleSave(diagramId);
  }, [diagramId, scheduleSave]);

  const updateDraft = useCallback((patch: Partial<GraphDraft>, track = true) => {
    const current = draftRef.current;
    if (!current) return;
    applyDraft({ ...current, ...patch }, track);
  }, [applyDraft]);

  const openDiagram = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const value = await client.get(id);
      const next: GraphDraft = { name: value.name, description: value.description, nodes: value.nodes, edges: value.edges, viewport: value.viewport };
      setDiagramId(value.id);
      setRevision(value.revision);
      revisionRef.current = value.revision;
      setDraft(next);
      draftRef.current = next;
      persistedDraft.current = next;
      setNotice("Все изменения сохранены");
      history.current = { past: [], future: [] };
      setSelectedId(null);
      setSelectedEdgeId(null);
      setPaletteOpen(false);
      setView("structure");
      setCodeMap(null);
      setCodeNote("");
      let stored = "";
      try { stored = window.localStorage.getItem(repoKey(workspaceId, id)) ?? ""; } catch { stored = ""; }
      setRepositoryId(stored);

    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть схему."); }
    finally { setBusy(false); }
  };

  const closeDiagram = async () => {
    if (!diagramId || navigationPending.current) return;
    navigationPending.current = true;
    setBusy(true);
    try {
      if (!await flushSave(diagramId)) return;
      draftRef.current = null;
      persistedDraft.current = null;
      setDiagramId(null);
      setDraft(null);
      await refreshItems();
    } finally {
      navigationPending.current = false;
      setBusy(false);
    }
  };

  const createDiagram = async () => {
    setBusy(true);
    try {
      const created = await client.create({ name: "Новая архитектура", description: "" });
      await refreshItems();
      await openDiagram(created.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать схему."); }
    finally { setBusy(false); }
  };

  const addPart = (kind: ArchitectureNode["kind"], at?: { x: number; y: number }) => {
    const current = draftRef.current;
    if (!current) return;
    const count = current.nodes.filter(node => node.kind === kind).length + 1;
    const bounds = stageRef.current?.getBoundingClientRect();
    const center = bounds && screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    let position = at ?? { x: (center?.x ?? 180) - 100, y: (center?.y ?? 160) - 40 };
    if (!at) {
      const { x, y } = position;
      for (let slot = 0; current.nodes.some(node => Math.abs(node.x - position.x) < 260 && Math.abs(node.y - position.y) < 130); slot++) {
        const row = Math.ceil((slot + 1) / 2);
        position = { x, y: y + (slot % 2 === 0 ? row : -row) * 145 };
      }
    }
    const node: ArchitectureNode = {
      id: makeId(), kind, title: kind === "boundary" ? `Граница ${count}` : `Часть ${count}`, purpose: "",
      x: position.x, y: position.y, parentId: null, binding: null
    };
    updateDraft({ nodes: [...current.nodes, node] });
    setSelectedId(node.id);
    setSelectedEdgeId(null);
  };

  const acceptCode = (moduleNode: ArchitectNode) => {
    const current = draftRef.current;
    if (!current || !repositoryId) return;
    const existing = current.nodes.find(node => node.binding?.path === moduleNode.path && node.binding.repositoryId === repositoryId);
    setSelectedEdgeId(null);
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    const node: ArchitectureNode = {
      id: makeId(), kind: "part", title: moduleNode.name, purpose: "",
      x: 80 + (current.nodes.length % 4) * 260, y: 80 + Math.floor(current.nodes.length / 4) * 150,
      parentId: null, binding: { repositoryId, path: moduleNode.path }
    };
    updateDraft({ nodes: [...current.nodes, node] });
    setSelectedId(node.id);
  };

  const rememberRepository = (nextRepositoryId: string) => {
    if (nextRepositoryId === repositoryId) return;
    setCodeMap(null);
    setCodeNote("");
    setRepositoryId(nextRepositoryId);
    if (!diagramId) return;
    try {
      if (nextRepositoryId) window.localStorage.setItem(repoKey(workspaceId, diagramId), nextRepositoryId);
      else window.localStorage.removeItem(repoKey(workspaceId, diagramId));
    } catch { /* сравнение можно выбрать снова */ }
  };

  useEffect(() => {
    if (!diagramId) return;
    if (!repositoryId) {
      setCodeMap(null);
      setCodeNote("");
      return;
    }
    let cancelled = false;
    setCodeNote("Читаем модули…");
    void client.codeModules(repositoryId).then(map => {
      if (cancelled) return;
      const modules = codeModulesOf(map.nodes);
      setCodeMap({ repositoryId, nodes: modules, edges: map.edges, launches: map.launches });
      setCodeNote(map.truncated ? "Карта репозитория обрезана по лимиту файлов. Окрестность считается по уже прочитанным файлам." : modules.length ? "" : "В репозитории не нашлось модулей верхнего уровня.");
    }).catch(cause => {
      if (!cancelled) setCodeNote(cause instanceof Error ? cause.message : "Не удалось прочитать карту кода.");
    });
    return () => { cancelled = true; };
  }, [client, diagramId, repositoryId]);

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const current = draftRef.current;
    if (!current) return;
    const moved = new Map<string, { x: number; y: number }>();
    for (const change of changes) {
      if (change.type === "position" && change.position && !change.id.startsWith("code:")) moved.set(change.id, change.position);
    }
    const selection = changes.find(change => change.type === "select" && change.selected && !change.id.startsWith("code:"));
    if (selection?.type === "select") {
      setSelectedId(selection.id);
      setSelectedEdgeId(null);
    }
    if (moved.size === 0) return;
    updateDraft({ nodes: current.nodes.map(node => moved.has(node.id) ? { ...node, ...moved.get(node.id) } : node) }, false);
  };
  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    const current = draftRef.current;
    if (!current) return;
    const next = applyEdgeChanges(changes, current.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, data: { kind: edge.kind } })));
    if (next.length !== current.edges.length) updateDraft({ edges: current.edges.filter(edge => next.some(item => item.id === edge.id)) });
  };
  const onConnect = (connection: Connection) => {
    const current = draftRef.current;
    if (!current || !connection.source || !connection.target || connection.source === connection.target || connection.source.startsWith("code:") || connection.target.startsWith("code:")) return;
    const edge: ArchitectureEdge = { id: makeId(), source: connection.source, target: connection.target, sourceHandle: "out", targetHandle: "in", kind: edgeKind, label: "" };
    updateDraft({ edges: [...current.edges, edge] });
    setSelectedEdgeId(edge.id);
    setSelectedId(null);
  };

  const selected = draft?.nodes.find(node => node.id === selectedId) ?? null;
  const selectedEdge = draft?.edges.find(edge => edge.id === selectedEdgeId) ?? null;
  const boundPaths = useMemo(() => new Set(
    (draft?.nodes ?? []).flatMap(node => node.binding?.repositoryId === repositoryId ? [node.binding.path] : [])
  ), [draft?.nodes, repositoryId]);
  const neighborIds = useMemo(() => {
    if (!selectedId || !draft) return null;
    const ids = new Set<string>([selectedId]);
    for (const edge of draft.edges) {
      if (view === "behavior" && edge.kind !== "launches") continue;
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    if (view === "behavior") return ids;
    const selectedNode = draft.nodes.find(node => node.id === selectedId);
    const root = selectedNode?.binding?.repositoryId === repositoryId ? selectedNode?.binding?.path : undefined;
    if (!root) return ids;
    const neighborhood = architectureCodeNeighborhood(root, codeEdges);
    const paths = [root, ...neighborhood.dependsOn.filter(link => !link.external).map(link => link.path), ...neighborhood.usedBy.map(link => link.path)];
    const touches = (path: string) => paths.some(item => item === path || item.startsWith(`${path}/`) || path.startsWith(`${item}/`));
    for (const node of draft.nodes) if (node.binding?.repositoryId === repositoryId && touches(node.binding.path)) ids.add(node.id);
    return ids;
  }, [codeEdges, draft, repositoryId, selectedId, view]);

  const flowNodes: FlowNode[] = useMemo(() => {
    const scheme = (draft?.nodes ?? []).map(node => ({
      id: node.id, type: "part" as const, position: { x: node.x, y: node.y },
      data: { node, origin: "scheme" as const, dim: Boolean(neighborIds && !neighborIds.has(node.id)) },
      style: node.kind === "boundary" ? { width: 360, height: 180 } : undefined,
      selected: node.id === selectedId, zIndex: node.kind === "boundary" ? -1 : 1
    }));
    if (view === "behavior") return scheme;
    const code = codeNodes.filter(node => !boundPaths.has(node.path)).map((node, index) => {
      const virtual: ArchitectureNode = { id: `code:${node.path}`, kind: "part", title: node.name, purpose: "", x: 0, y: 0, parentId: null, binding: { repositoryId, path: node.path } };
      return {
        id: virtual.id, type: "part" as const, position: { x: 920, y: 40 + index * 120 }, draggable: false, connectable: false,
        data: { node: virtual, origin: "code" as const, dim: Boolean(neighborIds) }, selected: false, zIndex: 0
      };
    });
    return [...scheme, ...code];
  }, [boundPaths, codeNodes, draft?.nodes, neighborIds, repositoryId, selectedId, view]);

  const visibleEdges = useMemo(() => (draft?.edges ?? []).filter(edge => view === "structure" || edge.kind === "launches"), [draft?.edges, view]);
  const renderedEdges: FlowEdge[] = useMemo(() => visibleEdges.map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.label || edgeLabels[edge.kind], data: { kind: edge.kind }, markerEnd: { type: MarkerType.ArrowClosed }, selected: edge.id === selectedEdgeId
  })), [visibleEdges, selectedEdgeId]);

  const undo = () => {
    const current = draftRef.current;
    const previous = history.current.past.pop();
    if (!current || !previous) return;
    history.current.future = [clone(current), ...history.current.future];
    setHistoryTick(value => value + 1);
    applyDraft(previous, false);
  };
  const redo = () => {
    const current = draftRef.current;
    const next = history.current.future.shift();
    if (!current || !next) return;
    history.current.past = [...history.current.past, clone(current)];
    setHistoryTick(value => value + 1);
    applyDraft(next, false);
  };
  void historyTick;

  const removeSelected = () => {
    const current = draftRef.current;
    if (!current) return;
    if (selectedId) {
      updateDraft({ nodes: current.nodes.filter(node => node.id !== selectedId).map(node => node.parentId === selectedId ? { ...node, parentId: null } : node), edges: current.edges.filter(edge => edge.source !== selectedId && edge.target !== selectedId) });
      setSelectedId(null);
    } else if (selectedEdgeId) {
      updateDraft({ edges: current.edges.filter(edge => edge.id !== selectedEdgeId) });
      setSelectedEdgeId(null);
    }
  };

  const patchNode = (id: string, patch: Partial<ArchitectureNode>) => {
    const current = draftRef.current;
    if (!current) return;
    updateDraft({ nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch } : node) });
  };

  if (!diagramId || !draft) return <section className={styles.library} aria-label="Архитектурные схемы">
    <header className={styles.libraryHeader}>
      <div><span className={styles.kicker}>ORION ARCHITECT</span><h2>Архитектура</h2><p>Части системы и их обязанности. Код можно подключить позже: те же узлы получат путь, а лишнее в репозитории появится рядом.</p></div>
      <Button onClick={() => void createDiagram()} disabled={busy}><Plus size={14} /> Новая схема</Button>
    </header>
    {error && <div role="alert" className={styles.error}><AlertCircle size={16} />{error}</div>}
    {listError && <div role="alert" className={styles.error}>{listError}<Button size="sm" variant="outline" onClick={() => void refreshItems()}>Повторить загрузку</Button></div>}
    {loadingList ? <p role="status">Загружаем схемы…</p> : items.length ? <ul className={styles.diagramList}>{items.map(item => <li key={item.id}>
      <button type="button" className={styles.diagramRow} disabled={busy} onClick={() => void openDiagram(item.id)} aria-label={`Открыть схему «${item.name}»`}>
        <span className={styles.diagramGlyph}><Box size={16} /></span>
        <span className={styles.diagramMain}><strong>{item.name}</strong><small>{item.description || "Схема обязанностей"}</small></span>
        <span className={styles.diagramCount}>{item.nodeCount} частей · {item.edgeCount} связей</span>
      </button>
    </li>)}</ul> : !listError && <div className={styles.libraryEmpty}><span><Box size={22} /></span><h3>Начните с частей системы</h3><p>Назовите части, напишите зачем каждая нужна и проведите зависимости. Репозиторий для этого не нужен.</p><Button onClick={() => void createDiagram()} disabled={busy}><Plus size={14} /> Создать архитектуру</Button></div>}
  </section>;

  const changeView = (next: "structure" | "behavior") => {
    setView(next);
    setSelectedEdgeId(null);
    setEdgeKind(next === "behavior" ? "launches" : "depends");
  };
  const onlyInCode = codeNodes.filter(node => !boundPaths.has(node.path));
  return <section className={styles.editor} aria-label="Редактор архитектуры">
    <header className={styles.editorHeader}>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void closeDiagram()}><ArrowLeft size={14} /> К схемам</Button>
      <div className={styles.titleGroup}>
        <input className={styles.titleInput} disabled={busy} aria-label="Название архитектуры" value={draft.name} maxLength={160} onChange={event => updateDraft({ name: event.target.value })} />
        <input className={styles.descriptionInput} disabled={busy} aria-label="Описание архитектуры" value={draft.description} maxLength={1200} placeholder="Что эта схема объясняет" onChange={event => updateDraft({ description: event.target.value })} />
      </div>
      <span className={styles.saveStatus} data-error={Boolean(error)} role="status">{saving ? <LoaderCircle className={styles.spin} size={13} /> : error ? <AlertCircle size={13} /> : draft === persistedDraft.current ? <Check size={13} /> : null}{notice}</span>
    </header>
    {error && <div role="alert" className={styles.error}><AlertCircle size={15} />{error}<Button size="sm" variant="outline" disabled={saving || busy} onClick={() => void flushSave(diagramId)}>Повторить сохранение</Button></div>}
    <div className={styles.canvasBar}>
      <nav aria-label="Вид схемы">
        <Button size="sm" variant={view === "structure" ? "outline" : "ghost"} aria-pressed={view === "structure"} onClick={() => changeView("structure")}>Структура</Button>
        <Button size="sm" variant={view === "behavior" ? "outline" : "ghost"} aria-pressed={view === "behavior"} onClick={() => changeView("behavior")}>Поведение</Button>
      </nav>
      <Button size="sm" variant="ghost" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(value => !value)}>{paletteOpen ? "Скрыть инструменты" : "Инструменты схемы"}</Button>
    </div>
    <div className={styles.editorLayout} data-palette={paletteOpen} inert={busy}>
      <aside hidden={!paletteOpen} className={styles.palette} aria-label="Части схемы">
        <div className={styles.paletteHead}><span>СХЕМА</span><span>{draft.nodes.length}</span></div>
        <div className={styles.paletteActions}>
          <Button size="sm" onClick={() => addPart("part")}><Plus size={13} /> Часть</Button>
          <Button size="sm" variant="outline" onClick={() => addPart("boundary")}>Граница</Button>
        </div>
        <label className={styles.edgeSelect}>Новая связь
          <select aria-label="Вид новой связи" value={edgeKind} onChange={event => setEdgeKind(event.target.value as ArchitectureEdgeKind)}>
            {view === "structure" && <option value="depends">зависит от</option>}
            <option value="launches">запускает</option>
          </select>
        </label>
        <p className={styles.paletteHint}>Потяните связь от правого порта к левому. Выбранная часть оставляет на холсте только свою окрестность яркой.</p>
        <div className={styles.paletteDivider} />
        <label className={styles.edgeSelect}>Сверять с репозиторием
          <select aria-label="Репозиторий для сверки" value={repositoryId} onChange={event => rememberRepository(event.target.value)}>
            <option value="">Пока без кода</option>
            {repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
          </select>
        </label>
        {codeNote && <p className={styles.paletteHint}>{codeNote}</p>}
        {onlyInCode.length > 0 && <div className={styles.typeList}>{onlyInCode.map(node => <button key={node.path} type="button" className={styles.typeButton} onClick={() => acceptCode(node)}><span><strong>{node.name}</strong><small>{node.path}</small></span><Plus size={13} /></button>)}</div>}
      </aside>
      <div className={styles.stage} ref={stageRef} onKeyDown={event => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        if (!selected && !selectedEdge) return;
        event.preventDefault();
        removeSelected();
      }}>
        {draft.nodes.length === 0 ? <p className={styles.canvasHint}>Откройте инструменты схемы и добавьте первый компонент.</p> :
          view === "behavior" && visibleEdges.length === 0 && <p className={styles.canvasHint}>Соедините две части связью «запускает», чтобы показать последовательность работы.</p>}
        <ReactFlow key={diagramId} nodes={flowNodes} edges={renderedEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          isValidConnection={connection => connection.source !== connection.target}
          onNodeDragStart={() => {
            const current = draftRef.current;
            if (!current) return;
            history.current.past = [...history.current.past.slice(-80), clone(current)];
            history.current.future = [];
            setHistoryTick(value => value + 1);
          }}
          onNodeClick={(_event, node) => { if (node.id.startsWith("code:")) { const found = codeNodes.find(item => `code:${item.path}` === node.id); if (found) acceptCode(found); return; } setSelectedId(node.id); setSelectedEdgeId(null); }}
          onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedId(null); }}
          onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}
          onPaneContextMenu={event => { event.preventDefault(); addPart("part", screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
          onMoveEnd={(event, viewport) => { if (event) updateDraft({ viewport }, false); }}
          defaultViewport={draft.viewport ?? undefined} fitView={!draft.viewport && draft.nodes.length > 0} fitViewOptions={{ padding: 0.22, maxZoom: 1 }} minZoom={0.2} maxZoom={2} deleteKeyCode={null}>
          <Background color="#383a3e" gap={22} />
          <Controls showInteractive={false} position="bottom-left" />
          {flowNodes.length > 6 && <MiniMap pannable zoomable />}
          <Panel position="bottom-center" className={styles.flowToolbar}>
            <button type="button" aria-label="Отменить" disabled={history.current.past.length === 0} onClick={undo}><Undo2 size={14} /></button>
            <button type="button" aria-label="Повторить" disabled={history.current.future.length === 0} onClick={redo}><Redo2 size={14} /></button>
          </Panel>
        </ReactFlow>
      </div>
      {(selected || selectedEdge) && <aside className={styles.inspector} aria-label="Карточка части">
        <div className={styles.drawerHeading}><strong>Свойства</strong><Button size="sm" variant="ghost" aria-label="Закрыть свойства" onClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}>Закрыть</Button></div>
        {selected ? <>
          <div className={styles.inspectorHeading}><span className={styles.inspectorType}>{selected.kind === "boundary" ? "Граница" : selected.binding ? "Часть с привязкой" : "Замысел"}</span><span>{selected.binding ? "привязана к пути" : "код ещё не подключён"}</span></div>
          <label className={styles.field}>Название<input aria-label="Название" value={selected.title} maxLength={160} onChange={event => patchNode(selected.id, { title: event.target.value })} /></label>
          <label className={styles.field}>Зачем<textarea aria-label="Зачем" rows={4} value={selected.purpose} maxLength={1200} placeholder="Какую обязанность несёт эта часть" onChange={event => patchNode(selected.id, { purpose: event.target.value })} /></label>
          {selected.kind === "part" && <label className={styles.field}>Путь в репозитории<input aria-label="Путь в репозитории" value={selected.binding?.path ?? ""} maxLength={2048} placeholder="apps/api/src/…" onChange={event => {
            const path = event.target.value.trim().replace(/\\/g, "/");
            patchNode(selected.id, { binding: path ? { ...(repositoryId ? { repositoryId } : {}), ...(selected.binding?.repositoryId && !repositoryId ? { repositoryId: selected.binding.repositoryId } : {}), path } : null });
          }} /></label>}
          {selected.binding?.repositoryId && onOpenCode && <Button size="sm" variant="outline" onClick={() => {
            const binding = selected.binding;
            if (binding?.repositoryId) onOpenCode({ repositoryId: binding.repositoryId, path: binding.path });
          }}>Показать на карте кода</Button>}
          {selected.kind === "part" && <CodeFacts path={selected.binding?.path ?? ""} repositoryReady={Boolean(currentMap && selected.binding?.repositoryId === repositoryId)} edges={codeEdges} launches={currentMap?.launches ?? []} />}
          <section className={styles.connections}><h4>На схеме <span>{visibleEdges.filter(edge => edge.source === selected.id || edge.target === selected.id).length}</span></h4>
            {visibleEdges.filter(edge => edge.source === selected.id || edge.target === selected.id).map(edge => {
              const otherId = edge.source === selected.id ? edge.target : edge.source;
              const other = draft.nodes.find(node => node.id === otherId);
              return <div key={edge.id} className={styles.connectionRow}><button type="button" onClick={() => setSelectedId(otherId)}><span>{edge.source === selected.id ? "→" : "←"}</span>{other?.title ?? "Часть"}<small>{edgeLabels[edge.kind]}</small></button></div>;
            })}
          </section>
          <Button size="sm" variant="ghost" onClick={removeSelected}><Trash2 size={13} /> Удалить</Button>
        </> : selectedEdge ? <>
          <div className={styles.inspectorHeading}><span className={styles.inspectorType}>Связь</span></div>
          <label className={styles.field}>Отношение<select aria-label="Отношение" value={selectedEdge.kind} onChange={event => updateDraft({ edges: draft.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, kind: event.target.value as ArchitectureEdgeKind } : edge) })}><option value="depends">зависит от</option><option value="launches">запускает</option></select></label>
          <label className={styles.field}>Подпись<input aria-label="Подпись" value={selectedEdge.label} maxLength={120} onChange={event => updateDraft({ edges: draft.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge) })} /></label>
          <Button size="sm" variant="ghost" onClick={removeSelected}><Trash2 size={13} /> Удалить связь</Button>
        </> : null}
      </aside>}
    </div>
    <footer className={styles.editorFooter}><span>{draft.nodes.length} частей · {draft.edges.length} связей{onlyInCode.length ? ` · ${onlyInCode.length} только в коде` : ""}</span><span>Ревизия {revision}</span></footer>
  </section>;
}

export function ArchitectureCanvasWorkspace(props: CanvasProps): React.ReactElement {
  return <div className={styles.workspace}><ReactFlowProvider><ArchitectureCanvas {...props} /></ReactFlowProvider></div>;
}
