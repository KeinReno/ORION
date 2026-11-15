"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  architectLayoutSchema,
  architectMapSchema,
  architectProjectSchemaSchema,
  architectComparisonSchema,
  developmentGitGraphSchema,
  developmentRepositoryRemovedSchema,
  developmentRepositoryRootsSchema,
  developmentRepositorySchema,
  type ArchitectMap,
  type ArchitectNode,
  type ArchitectProjectSchema,
  type ArchitectComparison,
  type DevelopmentGitGraph,
  type DevelopmentRepository
} from "@orion/shared-types";
import { Button } from "@orion/ui";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type OnMoveEnd
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, ArrowLeft, Box, CircleDot, Code2, GitBranch, Globe, LayoutGrid, LoaderCircle, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import styles from "./architect-workbench.module.css";

type Props = { workspaceId: string };
type Surface = "map" | "git" | "compare";
type FlowNodeData = { source: ArchitectNode | null; title: string; subtitle: string; kind: string };
type FlowNode = Node<FlowNodeData>;

function ArchitectureFlowNode({ data }: NodeProps<FlowNode>): React.ReactElement {
  return <div className={styles.flowCard}>
    <Handle type="target" position={Position.Left} className={styles.flowHandle} />
    <span className={styles.flowKind} style={{ color: kindColors[data.kind] ?? kindColors.file }}><i style={{ background: kindColors[data.kind] ?? kindColors.file }} />{kindLabels[data.kind] ?? data.kind}</span>
    <strong className={styles.flowTitle}>{data.title}</strong>
    <small className={styles.flowMeta}>{data.subtitle}</small>
    <Handle type="source" position={Position.Right} className={styles.flowHandle} />
  </div>;
}

const flowNodeTypes = { default: ArchitectureFlowNode };

const kindLabels: Record<string, string> = { file: "Файл", dir: "Папка", module: "Модуль", crate: "Крейт", external: "Внешняя зависимость" };
const kindColors: Record<string, string> = {
  file: "var(--orion-color-secondary, #b2b0a9)",
  dir: "rgb(var(--orion-accent, 201 168 106))",
  module: "#60a5fa",
  crate: "rgb(var(--orion-success, 16 185 129))",
  external: "rgb(var(--orion-warning, 245 158 11))"
};
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} Б` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
const apiError = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить запрос к ORION.";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function ArchitectWorkbench({ workspaceId }: Props): React.ReactElement {
  const { api } = useCore();
  const client = useMemo(() => createModuleClient(api, workspaceModuleBase(workspaceId, "development")), [api, workspaceId]);
  const [repositories, setRepositories] = useState<DevelopmentRepository[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [surface, setSurface] = useState<Surface>("map");
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [repositoryLoadFailed, setRepositoryLoadFailed] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [registering, setRegistering] = useState(false);
  const [map, setMap] = useState<ArchitectMap | null>(null);
  const [git, setGit] = useState<DevelopmentGitGraph | null>(null);
  const [projectSchemaText, setProjectSchemaText] = useState("");
  const [comparison, setComparison] = useState<ArchitectComparison | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaSaving, setSchemaSaving] = useState(false);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [schemaMessage, setSchemaMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"local" | "global">("local");
  const [fullMap, setFullMap] = useState<ArchitectMap | null>(null);
  const [fullMapLoading, setFullMapLoading] = useState(false);
  const [allowedRoots, setAllowedRoots] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const [selected, setSelected] = useState<ArchitectNode | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [layoutViewport, setLayoutViewport] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [flowNodeOverrides, setFlowNodeOverrides] = useState<FlowNode[] | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitCursorLoading, setGitCursorLoading] = useState(false);
  const revision = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const requestSequence = useRef(0);
  const nodeSnapshot = useRef<FlowNode[]>([]);
  const layoutPositions = useRef(new Map<string, { x: number; y: number }>());
  const viewportSnapshot = useRef<{ x: number; y: number; zoom: number } | null>(null);

  const loadRepositories = useCallback(async (preferredId?: string) => {
    setLoadingRepos(true);
    setRepositoryLoadFailed(false);
    setError("");
    try {
      const rows = await client.get("/git/repositories", developmentRepositorySchema.array());
      setRepositories(rows);
      setRepositoryId(current => preferredId && rows.some(row => row.id === preferredId) ? preferredId : rows.some(row => row.id === current) ? current : rows[0]?.id ?? "");
    } catch (cause) { setRepositoryLoadFailed(true); setError(apiError(cause)); }
    finally { setLoadingRepos(false); }
  }, [client]);

  useEffect(() => { void loadRepositories(); }, [loadRepositories]);

  useEffect(() => {
    let live = true;
    client.get("/git/repositories/allowed-roots", developmentRepositoryRootsSchema)
      .then(result => { if (live) setAllowedRoots(result.roots); })
      .catch(() => { /* Подсказка необязательна: форма работает и без списка корней. */ });
    return () => { live = false; };
  }, [client]);

  /** Полная карта грузится один раз на репозиторий и служит глобальным поиском. */
  useEffect(() => { setFullMap(null); }, [repositoryId]);

  const ensureFullMap = useCallback(async () => {
    if (!repositoryId || fullMap) return fullMap;
    setFullMapLoading(true);
    try {
      const loaded = await client.get(`/architect/${encodeURIComponent(repositoryId)}/map`, architectMapSchema);
      setFullMap(loaded);
      return loaded;
    } catch (cause) { setError(apiError(cause)); return null; }
    finally { setFullMapLoading(false); }
  }, [client, fullMap, repositoryId]);

  useEffect(() => {
    if (scope === "global" && search.trim() && repositoryId && !fullMap) void ensureFullMap();
  }, [scope, search, repositoryId, fullMap, ensureFullMap]);

  const loadMap = useCallback(async (repoId: string, subPath: string) => {
    if (!repoId) return;
    const request = ++requestSequence.current;
    setLoading(true); setError(""); setNotice("");
    try {
      const [nextMap, layout] = await Promise.all([
        client.get(`/architect/${encodeURIComponent(repoId)}/map?path=${encodeURIComponent(subPath)}`, architectMapSchema),
        client.get(`/architect/${encodeURIComponent(repoId)}/layout`, architectLayoutSchema)
      ]);
      if (request !== requestSequence.current) return;
      setMap(nextMap);
      nodeSnapshot.current = [];
      setFlowNodeOverrides(null);
      revision.current = layout.revision;
      layoutPositions.current = new Map(layout.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
      setLayoutViewport(layout.viewport);
      setSelected(null);
    } catch (cause) { if (request === requestSequence.current) setError(apiError(cause)); }
    finally { if (request === requestSequence.current) setLoading(false); }
  }, [client]);

  useEffect(() => {
    setPath(""); setMap(null); setGit(null); setSelected(null);
    if (repositoryId && surface === "map") void loadMap(repositoryId, "");
  }, [repositoryId, surface, loadMap]);

  const loadGit = useCallback(async (repoId = repositoryId, selectedBranch = branch, cursor?: string) => {
    if (!repoId) return;
    const query = new URLSearchParams({ limit: "50" });
    if (selectedBranch) query.set("branch", selectedBranch);
    if (cursor) query.set("cursor", cursor);
    if (cursor) setGitCursorLoading(true);
    else setGitLoading(true);
    setError("");
    try {
      const next = await client.get(`/git/${encodeURIComponent(repoId)}/graph?${query}`, developmentGitGraphSchema);
      setGit(current => cursor && current ? { ...next, commits: [...current.commits, ...next.commits] } : next);
    } catch (cause) { setError(apiError(cause)); }
    finally {
      if (cursor) setGitCursorLoading(false);
      else setGitLoading(false);
    }
  }, [branch, client, repositoryId]);

  const loadProjectSchema = useCallback(async (repoId: string) => {
    setSchemaLoading(true); setSchemaMessage("");
    try {
      const schema = await client.get(`/architect/${encodeURIComponent(repoId)}/project-schema`, architectProjectSchemaSchema.nullable());
      setProjectSchemaText(schema ? JSON.stringify(schema, null, 2) : "");
      setComparison(null);
    } catch (cause) { setError(apiError(cause)); }
    finally { setSchemaLoading(false); }
  }, [client]);

  const compareSchema = useCallback(async (repoId = repositoryId) => {
    if (!repoId) return;
    setComparisonLoading(true); setError(""); setSchemaMessage("");
    try {
      setComparison(await client.get(`/architect/${encodeURIComponent(repoId)}/compare`, architectComparisonSchema));
    } catch (cause) { setError(apiError(cause)); }
    finally { setComparisonLoading(false); }
  }, [client, repositoryId]);

  useEffect(() => {
    if (surface === "compare" && repositoryId) void loadProjectSchema(repositoryId);
  }, [loadProjectSchema, repositoryId, surface]);

  useEffect(() => {
    if (surface === "git" && repositoryId) void loadGit(repositoryId, branch);
  }, [branch, loadGit, repositoryId, surface]);

  const visibleNodes = useMemo(() => {
    if (!map) return [];
    const direct = map.nodes.filter(node => {
      const parent = node.parentId?.replace(/\\/g, "/") ?? "";
      return parent === path.replace(/\\/g, "/");
    });
    return direct;
  }, [map, path]);

  const searchMatches = useMemo(() => {
    const value = search.trim().toLocaleLowerCase("ru-RU");
    return value ? visibleNodes.filter(node => `${node.name} ${node.path}`.toLocaleLowerCase("ru-RU").includes(value)) : visibleNodes;
  }, [search, visibleNodes]);

  /** Глобальные совпадения по полной карте; ограничиваем, чтобы список не превращался в простыню. */
  const globalMatches = useMemo(() => {
    const value = search.trim().toLocaleLowerCase("ru-RU");
    if (!value || scope !== "global" || !fullMap) return [];
    return fullMap.nodes
      .filter(node => `${node.name} ${node.path}`.toLocaleLowerCase("ru-RU").includes(value))
      .slice(0, 200);
  }, [fullMap, scope, search]);

  /** Соседи выбранного узла: при выборе остальное затемняется, чтобы не мешало. */
  const focusIds = useMemo(() => {
    if (!selected || !map) return null;
    const set = new Set<string>([selected.id]);
    for (const edge of map.edges) {
      if (edge.from === selected.id) set.add(edge.to);
      if (edge.to === selected.id) set.add(edge.from);
    }
    return set;
  }, [map, selected]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    const count = Math.max(1, Math.ceil(Math.sqrt(visibleNodes.length)));
    const filteredNodes = search.trim() ? searchMatches : visibleNodes;
    const nodes: FlowNode[] = filteredNodes.map((node, index) => {
      const incoming = map?.edges.filter(edge => edge.to === node.id).length ?? 0;
      const outgoing = map?.edges.filter(edge => edge.from === node.id).length ?? 0;
      return {
        id: node.id,
        type: "default",
        position: node.x !== null && node.y !== null ? { x: node.x, y: node.y } : { x: (index % count) * 260, y: Math.floor(index / count) * 126 },
        className: focusIds && !focusIds.has(node.id) ? styles.dimmed : undefined,
        data: { source: node, title: node.name, subtitle: `${node.fileCount} файлов · ${incoming} входящих · ${outgoing} исходящих`, kind: node.kind },
        style: { width: 228, minHeight: 74, padding: 12, borderRadius: 10, border: `1px solid color-mix(in srgb, ${kindColors[node.kind] ?? kindColors.file} 45%, transparent)`, background: "var(--orion-color-elevated, #1d1e22)", color: "var(--orion-color-text, #f2f0ea)", boxShadow: "0 8px 22px color-mix(in srgb, var(--orion-color-canvas, #0f1012) 22%, transparent)" }
      };
    });
    const shownIds = new Set(nodes.map(node => node.id));
    const externalNames = new Set(map?.edges.filter(edge => edge.external && shownIds.has(edge.from)).map(edge => edge.to) ?? []);
    for (const [index, id] of [...externalNames].entries()) {
      nodes.push({ id, type: "default", position: { x: 280 + count * 260, y: index * 126 }, className: focusIds && !focusIds.has(id) ? styles.dimmed : undefined, data: { source: null, title: id.replace(/^external:/, ""), subtitle: "Внешняя зависимость", kind: "external" }, style: { width: 205, padding: 12, borderRadius: 10, border: `1px dashed ${kindColors.external}`, background: "var(--orion-color-elevated, #1d1e22)", color: "var(--orion-color-text, #f2f0ea)" } });
    }
    return nodes;
  }, [focusIds, map, search, searchMatches, visibleNodes]);

  const displayedFlowNodes = useMemo(() => {
    const visibleIds = new Set(flowNodes.map(node => node.id));
    return (flowNodeOverrides ?? flowNodes).filter(node => visibleIds.has(node.id));
  }, [flowNodeOverrides, flowNodes]);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!map) return [];
    const ids = new Set(flowNodes.map(node => node.id));
    return map.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => {
      const blurred = Boolean(focusIds && edge.from !== selected?.id && edge.to !== selected?.id);
      return {
        id: edge.id, source: edge.from, target: edge.to, type: "smoothstep", label: edge.external ? "зависимость" : "импорт", animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: edge.external ? kindColors.external : "rgb(var(--orion-accent, 201 168 106))" },
        style: { stroke: edge.external ? kindColors.external : "rgb(var(--orion-accent, 201 168 106))", strokeWidth: focusIds && !blurred ? 2.4 : 1.5, opacity: blurred ? 0.16 : 1 },
        labelStyle: { fill: "var(--orion-color-secondary, #b2b0a9)", fontSize: "var(--font-micro)" },
        labelBgStyle: { fill: "var(--orion-color-elevated, #1d1e22)", fillOpacity: 0.9 }
      };
    });
  }, [flowNodes, focusIds, map, selected]);

  const queueLayoutSave = useCallback((nodes: FlowNode[], viewport?: { x: number; y: number; zoom: number }) => {
    if (!repositoryId) return;
    nodeSnapshot.current = nodes;
    if (viewport) viewportSnapshot.current = viewport;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveChain.current = saveChain.current.then(async () => {
        setSaving(true);
        try {
          const body = {
            nodes: (() => {
              const merged = new Map(layoutPositions.current);
              for (const node of nodeSnapshot.current) if (node.data.source) merged.set(node.id, { x: node.position.x, y: node.position.y });
              return [...merged].map(([id, position]) => ({ id, ...position }));
            })(),
            ...(viewportSnapshot.current ? { viewport: viewportSnapshot.current } : {}),
            expectedRevision: revision.current
          };
          const saved = await client.put(`/architect/${encodeURIComponent(repositoryId)}/layout`, body, architectLayoutSchema);
          revision.current = saved.revision;
          layoutPositions.current = new Map(saved.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
          setNotice("Раскладка сохранена");
        } catch (cause) {
          const status = isRecord(cause) && typeof cause.status === "number" ? cause.status : 0;
          if (status === 409 || status === 412) {
            setNotice("Раскладка изменилась в другом окне. Загружаю последнюю версию.");
            void loadMap(repositoryId, path);
          } else setError(`Не удалось сохранить расположение: ${apiError(cause)}`);
        } finally { setSaving(false); }
      });
    }, 500);
  }, [client, loadMap, path, repositoryId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onMoveEnd: OnMoveEnd = useCallback((event, viewport) => {
    if (event) queueLayoutSave(nodeSnapshot.current.length ? nodeSnapshot.current : flowNodes, viewport);
  }, [flowNodes, queueLayoutSave]);

  /**
   * Авто-раскладка без внешних зависимостей: глубина узла — длина самой длинной цепочки импортов
   * к нему (DFS с мемоизацией, циклы обрываются). Каждый слой выстраивается вертикально,
   * слои идут слева направо по направлению зависимостей.
   */
  const autoLayout = useCallback(() => {
    const base = flowNodeOverrides ?? flowNodes;
    if (!map || base.length === 0) return;
    const ids = new Set(base.map(node => node.id));
    const incoming = new Map<string, string[]>();
    for (const edge of map.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
      const list = incoming.get(edge.to) ?? [];
      list.push(edge.from);
      incoming.set(edge.to, list);
    }
    const depthCache = new Map<string, number>();
    const visiting = new Set<string>();
    const depthOf = (id: string): number => {
      const cached = depthCache.get(id);
      if (cached !== undefined) return cached;
      if (visiting.has(id)) return 0; // цикл — не даём рекурсии завернуться
      visiting.add(id);
      let depth = 0;
      for (const from of incoming.get(id) ?? []) depth = Math.max(depth, depthOf(from) + 1);
      visiting.delete(id);
      depthCache.set(id, depth);
      return depth;
    };
    const layers = new Map<number, FlowNode[]>();
    for (const node of base) {
      const depth = depthOf(node.id);
      const layer = layers.get(depth) ?? [];
      layer.push(node);
      layers.set(depth, layer);
    }
    const positioned: FlowNode[] = [];
    for (const [depth, nodes] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
      nodes.forEach((node, index) => { positioned.push({ ...node, position: { x: depth * 300, y: index * 136 } }); });
    }
    nodeSnapshot.current = positioned;
    setFlowNodeOverrides(positioned);
    queueLayoutSave(positioned);
    setNotice("Раскладка выровнена по уровням зависимостей");
  }, [flowNodeOverrides, flowNodes, map, queueLayoutSave]);

  /** Убирает только запись в ORION: каталог на диске и привязки коммитов не трогаем. */
  const removeRepository = async () => {
    if (!repositoryId || removing) return;
    const repo = repositories.find(row => row.id === repositoryId);
    if (!window.confirm(`Убрать репозиторий «${repo?.name ?? repositoryId}» из ORION?\nКаталог на диске и привязки коммитов к задачам не удаляются.`)) return;
    setRemoving(true); setError("");
    try {
      await client.delete(`/git/repositories/${encodeURIComponent(repositoryId)}`, developmentRepositoryRemovedSchema);
      setMap(null); setGit(null); setSelected(null); setFullMap(null); setComparison(null); setPath("");
      await loadRepositories();
    } catch (cause) { setError(apiError(cause)); }
    finally { setRemoving(false); }
  };

  const register = async (event: FormEvent) => {
    event.preventDefault();
    if (!repoName.trim() || !repoPath.trim() || registering) return;
    setRegistering(true); setError("");
    try {
      const body = { name: repoName.trim(), path: repoPath.trim(), taskRefPrefix: "#" };
      const created = await client.post("/git/repositories", body, developmentRepositorySchema);
      setRepoName(""); setRepoPath("");
      await loadRepositories(created.id);
    } catch (cause) { setError(apiError(cause)); }
    finally { setRegistering(false); }
  };

  const makeSchemaDraft = async () => {
    if (!repositoryId) return;
    setSchemaLoading(true); setError(""); setSchemaMessage("");
    try {
      const fullMap = await client.get(`/architect/${encodeURIComponent(repositoryId)}/map`, architectMapSchema);
      const schema: ArchitectProjectSchema = {
        nodes: fullMap.nodes.map(node => ({ id: node.id, name: node.name, kind: node.kind, path: node.path })),
        edges: fullMap.edges.map(edge => ({ from: edge.from, to: edge.to, kind: edge.kind }))
      };
      setProjectSchemaText(JSON.stringify(schema, null, 2));
      setSchemaMessage("Черновик заполнен по текущей карте. Уточните его и сохраните как замысел.");
    } catch (cause) { setError(apiError(cause)); }
    finally { setSchemaLoading(false); }
  };

  const saveProjectSchema = async () => {
    let value: unknown;
    try { value = JSON.parse(projectSchemaText); }
    catch { setSchemaMessage("Проверьте формат JSON: в тексте есть синтаксическая ошибка."); return; }
    const parsed = architectProjectSchemaSchema.safeParse(value);
    if (!parsed.success) { setSchemaMessage("Схема не подходит формату ORION. Проверьте узлы, пути и связи."); return; }
    setSchemaSaving(true); setError(""); setSchemaMessage("");
    try {
      const saved = await client.put(`/architect/${encodeURIComponent(repositoryId)}/project-schema`, parsed.data, architectProjectSchemaSchema);
      setProjectSchemaText(JSON.stringify(saved, null, 2));
      setSchemaMessage("Проектный замысел сохранён.");
      setComparison(null);
    } catch (cause) { setError(apiError(cause)); }
    finally { setSchemaSaving(false); }
  };

  const updateMapPath = (nextPath: string) => { setPath(nextPath); setSelected(null); setFlowNodeOverrides(null); void loadMap(repositoryId, nextPath); };
  const crumbs = path ? path.split("/").filter(Boolean) : [];
  const currentRepo = repositories.find(repo => repo.id === repositoryId);
  const globalActive = scope === "global" && search.trim().length > 0;

  if (loadingRepos) return <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} /> Загружаем репозитории…</div>;

  return <section className={styles.root} aria-label="Архитектура и Git">
    <header className={styles.toolbar}>
      <div className={styles.tabs} role="group" aria-label="Инструменты разработки">
        <button type="button" aria-pressed={surface === "map"} className={surface === "map" ? styles.activeTab : ""} onClick={() => setSurface("map")}><Code2 size={15} /> Архитектура</button>
        <button type="button" aria-pressed={surface === "git"} className={surface === "git" ? styles.activeTab : ""} onClick={() => setSurface("git")}><GitBranch size={15} /> История Git</button>
        <button type="button" aria-pressed={surface === "compare"} className={surface === "compare" ? styles.activeTab : ""} onClick={() => setSurface("compare")}><CircleDot size={15} /> Сверка замысла</button>
      </div>
      {repositories.length > 0 && <label className={styles.repoSelect}><span>Репозиторий</span><select value={repositoryId} onChange={event => setRepositoryId(event.target.value)} aria-label="Выбрать репозиторий">{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>}
      {repositories.length > 0 && <Button size="sm" variant="ghost" disabled={removing || loadingRepos} title="Убрать репозиторий из ORION (каталог на диске не трогаем)" onClick={() => void removeRepository()}><Trash2 size={14} aria-hidden /> {removing ? "Убираем…" : "Удалить"}</Button>}
      {repositoryId && <Button size="sm" variant="ghost" disabled={loading || gitLoading || schemaLoading} onClick={() => surface === "map" ? void loadMap(repositoryId, path) : surface === "git" ? void loadGit() : void loadProjectSchema(repositoryId)}><RefreshCw size={14} aria-hidden /> Обновить</Button>}
    </header>

    {error && <div role="alert" className={styles.alert}><AlertCircle size={16} /><span>{error}</span></div>}
    {repositories.length === 0 && repositoryLoadFailed ? <div className={styles.emptyState}>
      <span className={styles.emptyIcon}><AlertCircle size={22} /></span><h3>Не удалось загрузить репозитории</h3>
      <p>Проверьте подключение и повторите загрузку. После успешной проверки можно будет добавить разрешённый сервером репозиторий.</p>
      <Button variant="outline" disabled={loadingRepos} onClick={() => void loadRepositories()}>{loadingRepos ? "Загружаем…" : "Повторить загрузку"}</Button>
    </div> : repositories.length === 0 ? <div className={styles.emptyState}>
      <span className={styles.emptyIcon}><Box size={22} /></span><h3>Добавьте рабочий репозиторий</h3>
      <p>ORION построит карту структуры и связей, а также покажет локальную историю Git. Репозиторий можно добавить только из каталогов, разрешённых администратором сервера.</p>
      <form className={styles.registerForm} onSubmit={event => void register(event)}>
        <label>Название<input required maxLength={120} value={repoName} onChange={event => setRepoName(event.target.value)} placeholder="Например, ORION-Rust" /></label>
        <label>Путь на сервере<input required maxLength={4096} value={repoPath} onChange={event => setRepoPath(event.target.value)} placeholder="Путь внутри разрешённого корня" /></label>
        <Button type="submit" disabled={registering || !repoName.trim() || !repoPath.trim()}>{registering ? "Проверяем…" : "Проверить и добавить"}</Button>
      </form>
      {allowedRoots.length > 0 && <div className={styles.rootsHint}><strong>Разрешённые корни сервера</strong><ul>{allowedRoots.map(root => <li key={root}><code>{root}</code></li>)}</ul></div>}
    </div> : surface === "map" ? <>
      <div className={styles.summary}>
        <div className={styles.repoName}><span className={styles.statusDot} /> <strong>{currentRepo?.name}</strong><span className={styles.pathLabel}>{currentRepo?.path}</span></div>
        <div className={styles.metrics}>
          <span><b>{map?.metrics.files ?? "—"}</b> файлов</span><span><b>{map?.metrics.modules ?? "—"}</b> модулей</span><span><b>{map?.metrics.crates ?? "—"}</b> crates</span><span><b>{map?.metrics.internalEdges ?? "—"}</b> внутренних связей</span>
        </div>
      </div>
      <div className={styles.breadcrumbs}>
        <Button size="sm" variant="ghost" disabled={!path || loading} onClick={() => updateMapPath(path.split("/").slice(0, -1).join("/"))}><ArrowLeft size={14} aria-hidden /> Назад</Button>
        <button type="button" className={styles.crumb} onClick={() => updateMapPath("")}>{currentRepo?.name ?? "Корень"}</button>
        {crumbs.map((part, index) => <span className={styles.crumbGroup} key={`${part}-${index}`}><span className={styles.slash}>/</span><button type="button" className={styles.crumb} onClick={() => updateMapPath(crumbs.slice(0, index + 1).join("/"))}>{part}</button></span>)}
        <label className={styles.search}><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти файл или модуль" aria-label="Поиск по карте" /></label>
        <button type="button" className={`${styles.scopeToggle}${scope === "global" ? ` ${styles.scopeActive}` : ""}`} aria-pressed={scope === "global"} title={scope === "global" ? "Поиск идёт по всему репозиторию" : "Поиск в текущем каталоге"} onClick={() => setScope(current => current === "global" ? "local" : "global")}><Globe size={14} aria-hidden /> {scope === "global" ? "Весь репозиторий" : "Каталог"}</button>
        <Button size="sm" variant="ghost" disabled={!map || loading || displayedFlowNodes.length === 0} onClick={autoLayout} title="Выровнять карточки по уровням зависимостей"><LayoutGrid size={14} aria-hidden /> Авто-раскладка</Button>
        <span className={styles.saveState} role="status" aria-live="polite">{saving ? <><LoaderCircle className={styles.spin} size={13} /> Сохраняем…</> : notice || "Изменения раскладки сохраняются автоматически"}</span>
      </div>
      {map?.truncated && <p className={styles.warning} role="status">Карта ограничена лимитом анализа и может быть неполной. Уточните каталог или фильтр, чтобы исследовать структуру подробнее.</p>}
      <div className={styles.mapLayout}>
        <aside className={styles.explorer} aria-label="Содержимое текущего каталога">
          <div className={styles.explorerHeading}>{globalActive ? "Найдено в репозитории" : "Элементы каталога"} <span>{globalActive ? globalMatches.length : searchMatches.length}</span></div>
          <div className={styles.explorerList}>{globalActive ? <>
            {fullMapLoading && <p className={styles.noResults}><LoaderCircle className={styles.spin} size={13} /> Строим карту репозитория…</p>}
            {!fullMapLoading && globalMatches.map(node => <button key={node.id} type="button" className={selected?.id === node.id ? styles.selectedItem : ""} onClick={() => setSelected(node)} onDoubleClick={() => { if (node.kind === "file") return; const parent = (node.parentId ?? "").replace(/\\/g, "/"); updateMapPath(parent); setSelected(node); }}>
              <span className={styles.kindMark} style={{ background: kindColors[node.kind] }} /><span className={styles.itemText}><strong>{node.name}</strong><small>{kindLabels[node.kind]} · {(node.parentId ?? "").replace(/\\/g, "/") || "корень репозитория"}</small></span>{node.kind !== "file" && <span className={styles.openHint}>Открыть</span>}
            </button>)}
            {!fullMapLoading && globalMatches.length === 0 && <p className={styles.noResults}>По всему репозиторию ничего не найдено.</p>}
          </> : searchMatches.map(node => <button key={node.id} type="button" className={selected?.id === node.id ? styles.selectedItem : ""} onClick={() => setSelected(node)} onDoubleClick={() => node.kind !== "file" && updateMapPath(node.path)}>
            <span className={styles.kindMark} style={{ background: kindColors[node.kind] }} /><span className={styles.itemText}><strong>{node.name}</strong><small>{kindLabels[node.kind]} · {node.fileCount} файлов</small></span>{node.kind !== "file" && <span className={styles.openHint}>Открыть</span>}
          </button>)}{!globalActive && searchMatches.length === 0 && <p className={styles.noResults}>В этом каталоге ничего не найдено.</p>}</div>
          <p className={styles.explorerHint}>Дважды нажмите папку или модуль, чтобы открыть его. Перетаскивайте карточки на схеме — расположение сохранится.</p>
        </aside>
        <div className={styles.canvas}>
          {loading && <div className={styles.overlay}><LoaderCircle className={styles.spin} size={18} /> Строим карту…</div>}
          {!loading && displayedFlowNodes.length === 0 ? <div className={styles.canvasEmpty}>В этом каталоге нет непосредственных элементов.</div> : <ReactFlowProvider key={`${repositoryId}:${map?.path ?? "loading"}`}><ReactFlow<FlowNode>
            nodes={displayedFlowNodes}
            edges={flowEdges}
            nodeTypes={flowNodeTypes}
            onInit={flow => { if (layoutViewport) void flow.setViewport(layoutViewport, { duration: 0 }); else if (flowNodes.length) void flow.fitView({ padding: 0.18, duration: 180 }); }}
            onNodesChange={changes => {
              const updated = applyNodeChanges(changes, nodeSnapshot.current.length ? nodeSnapshot.current : displayedFlowNodes);
              nodeSnapshot.current = updated;
              setFlowNodeOverrides(updated);
            }}
            onNodeDragStop={(_event, node) => {
              const next = (nodeSnapshot.current.length ? nodeSnapshot.current : displayedFlowNodes).map(item => item.id === node.id ? { ...item, position: node.position } : item);
              nodeSnapshot.current = next; queueLayoutSave(next);
            }}
            onNodeClick={(_event, node) => setSelected(node.data.source)}
            onNodeDoubleClick={(_event, node) => node.data.source && node.data.source.kind !== "file" && updateMapPath(node.data.source.path)}
            onPaneClick={() => setSelected(null)}
            onMoveEnd={onMoveEnd}
            minZoom={0.12} maxZoom={2.4} nodesConnectable={false} nodesDraggable nodesFocusable edgesFocusable onlyRenderVisibleElements
            selectionOnDrag selectionMode={SelectionMode.Partial} multiSelectionKeyCode="Shift" aria-label="Карта файлов и импортов репозитория">
            <Background color="color-mix(in srgb, var(--orion-color-border, #414248) 70%, transparent)" gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" nodeColor={node => kindColors[String(node.data?.kind)] ?? kindColors.file} maskColor="color-mix(in srgb, var(--orion-color-canvas, #0f1012) 68%, transparent)" />
          </ReactFlow></ReactFlowProvider>}
        </div>
        <aside className={`${styles.inspector}${selected ? ` ${styles.mobileInspectorSelected}` : ""}`} aria-label="Сведения об элементе">
          {selected ? <><div className={styles.inspectorTop}><CircleDot size={16} style={{ color: kindColors[selected.kind] }} /><span>{kindLabels[selected.kind]}</span></div><h3>{selected.name}</h3><code>{selected.path || "."}</code><dl><div><dt>Файлов</dt><dd>{selected.fileCount}</dd></div><div><dt>Размер</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div><div><dt>Уровень</dt><dd>{selected.depth}</dd></div><div><dt>Входящие связи</dt><dd>{map?.edges.filter(edge => edge.to === selected.id).length ?? 0}</dd></div><div><dt>Исходящие связи</dt><dd>{map?.edges.filter(edge => edge.from === selected.id).length ?? 0}</dd></div></dl>{selected.kind !== "file" && <Button variant="outline" size="sm" onClick={() => updateMapPath(selected.path)}>Открыть каталог</Button>}<p className={styles.provenance}>Карта вычислена по доступным исходным файлам. Связи импорта определяются анализатором и требуют проверки.</p></> : <div className={styles.inspectorEmpty}><Box size={20} /><span>Выберите элемент схемы, чтобы увидеть его свойства.</span></div>}
        </aside>
      </div>
      <div className={styles.disclaimer}>Карта отражает структуру, которую распознал анализатор ORION. Она не подтверждает полноту кода или соответствие проектному замыслу.</div>
    </> : surface === "git" ? <div className={styles.gitView}>
      <div className={styles.gitSummary}><div><span className={styles.statusDot} /><strong>{git?.repository.name ?? currentRepo?.name}</strong><span className={styles.branch}><GitBranch size={14} /> {git?.branch ?? "Ветка не определена"}</span></div>
        <label>Ветка<select value={branch} onChange={event => setBranch(event.target.value)}><option value="">Все ветки</option>{git?.branches.map(item => <option key={item.name} value={item.name}>{item.name}{item.isCurrent ? " · текущая" : ""}</option>)}</select></label></div>
      {gitLoading ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} /> Загружаем историю…</div> : git?.commits.length ? <><div className={styles.gitMeta}>Показано {git.commits.length} из {git.total} коммитов{git.truncated ? " · история ограничена" : ""} · {git.tags.length} тегов</div><ol className={styles.commitList}>{git.commits.map(commit => <li key={commit.sha}><span className={styles.commitMarker} /><div className={styles.commitBody}><div className={styles.commitTitle}>{commit.subject || "Без описания"}{commit.isMerge && <span className={styles.mergeBadge}>Слияние</span>}</div><div className={styles.commitMeta}><code>{commit.sha.slice(0, 8)}</code><span>{commit.author || "Автор не указан"}</span><time dateTime={commit.date}>{new Date(commit.date).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</time></div>{commit.refs.length > 0 && <div className={styles.refs}>{commit.refs.map(ref => <span key={ref}>{ref}</span>)}</div>}<p>{commit.message}</p></div></li>)}</ol>{git.nextCursor && <Button variant="outline" disabled={gitCursorLoading} onClick={() => void loadGit(repositoryId, branch, git.nextCursor ?? undefined)}>{gitCursorLoading ? "Загружаем…" : "Загрузить ещё"}</Button>}</> : !error && <div className={styles.canvasEmpty}>В этом репозитории пока нет истории Git.</div>}
      <p className={styles.disclaimer}>История загружается только для чтения из зарегистрированного локального репозитория. Получение изменений, переключение веток и запись в Git через этот экран недоступны.</p>
    </div> : <div className={styles.compareView}>
      <div className={styles.compareIntro}><div><h3>Замысел и фактическая карта</h3><p>Проектная схема хранится отдельно от исходного кода. Сверка показывает, какие узлы и связи описаны не полностью или расходятся с тем, что распознал анализатор.</p></div>
        <div className={styles.compareActions}><Button variant="outline" size="sm" disabled={schemaLoading || schemaSaving} onClick={() => void makeSchemaDraft()}>{schemaLoading ? "Загружаем…" : "Черновик из карты"}</Button><Button variant="outline" size="sm" disabled={schemaLoading || schemaSaving || !projectSchemaText.trim()} onClick={() => void compareSchema()}>{comparisonLoading ? "Сверяем…" : "Сверить с кодом"}</Button></div>
      </div>
      <label className={styles.schemaLabel}>Проектная схема в формате JSON<textarea spellCheck={false} value={projectSchemaText} onChange={event => { setProjectSchemaText(event.target.value); setComparison(null); setSchemaMessage(""); }} placeholder={'{\n  "nodes": [],\n  "edges": []\n}'} aria-label="Проектная схема JSON" /></label>
      <div className={styles.schemaFooter}><span role={error || schemaMessage ? "status" : undefined} className={error ? styles.errorText : styles.schemaMessage}>{error || schemaMessage || "Сначала загрузите схему или создайте черновик. Сохранение обновляет только проектную схему."}</span><Button disabled={schemaSaving || schemaLoading || !projectSchemaText.trim()} onClick={() => void saveProjectSchema()}>{schemaSaving ? "Сохраняем…" : "Сохранить замысел"}</Button></div>
      {comparison && <section className={styles.comparison} aria-label="Результаты сверки">
        <div className={styles.comparisonCounts}><span><b>{comparison.project.nodes}</b> узлов в замысле</span><span><b>{comparison.actual.nodes}</b> узлов в коде</span><span><b>{comparison.project.edges}</b> связей в замысле</span><span><b>{comparison.actual.edges}</b> связей в коде</span></div>
        <div className={styles.issueCounts}><span>Не описано: {comparison.counts.missingNodes + comparison.counts.missingEdges}</span><span>Не найдено в коде: {comparison.counts.extraNodes + comparison.counts.extraEdges}</span></div>
        {comparison.issues.length ? <ul className={styles.issueList}>{comparison.issues.slice(0, 100).map(issue => <li key={`${issue.kind}:${issue.id}`}><span className={issue.kind.startsWith("missing") ? styles.issueMissing : styles.issueExtra}>{issue.kind.startsWith("missing") ? "Не описано" : "Не найдено"}</span><span>{issue.title}</span></li>)}</ul> : <p className={styles.noIssues}>Распознанные узлы и связи совпадают с сохранённым замыслом.</p>}
        {comparison.issues.length > 100 && <p className={styles.gitMeta}>Показаны первые 100 из {comparison.issues.length} расхождений.</p>}
      </section>}
      <p className={styles.disclaimer}>Сверка основана на ограниченном анализе TypeScript/Rust. Совпадение не является доказательством семантической полноты или работоспособности архитектуры.</p>
    </div>}
  </section>;
}
