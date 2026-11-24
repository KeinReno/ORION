"use client";

import { Button, EmptyState, PanelBody, PanelHeader, PanelShell } from "@orion/ui";
import { Code2, Compass, GitBranch, Workflow as WorkflowIcon, FolderTree, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import type { ArchitectCodeTarget } from "./architecture-api";
import styles from "./orion-dev.module.css";

const ArchitectWorkbench = dynamic(() => import("./ArchitectWorkbench").then(module => module.ArchitectWorkbench), { ssr: false, loading: () => <p role="status">Загружаем рабочую поверхность Architect…</p> });
const WorkflowsPanel = dynamic(() => import("./WorkflowsPanel").then(module => module.WorkflowsPanel), { ssr: false, loading: () => <p role="status">Загружаем процессы…</p> });
const ArchitectureCanvasWorkspace = dynamic(() => import("./ArchitectureCanvas").then(module => module.ArchitectureCanvasWorkspace), { ssr: false, loading: () => <p role="status">Загружаем редактор архитектуры…</p> });

type Mode = "processes" | "architecture" | "codebase";
type CodebaseView = "map" | "git";

export function OrionDevPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  return <PanelShell>
  <PanelHeader icon={Compass} title="Architect" subtitle={workspace ? `Рабочее пространство · ${workspace.name}` : "Кодовая база, архитектура и процессы"} />
    <PanelBody className={styles.body}>
      {!workspace ? <EmptyState icon={Compass} title="Выберите пространство" description="Откройте пространство, в котором хотите работать." /> :
        workspace.role !== "owner" && workspace.role !== "lead" ? <p role="status">Рабочее пространство доступно владельцу и руководителю пространства.</p> :
          <ArchitectWorkspace key={workspace.id} workspaceId={workspace.id} workspaceName={workspace.name} />}
    </PanelBody>
  </PanelShell>;
}

function ArchitectWorkspace({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }): React.ReactElement {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [focusError, setFocusError] = useState("");
  const [codeTarget, setCodeTarget] = useState<ArchitectCodeTarget | null>(null);
  const [returnToModel, setReturnToModel] = useState(false);
  useEffect(() => {
    const update = () => setFocused(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFocus = async () => {
    setFocusError("");
    try {
      if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch { setFocusError("Полноэкранный режим недоступен в этом окне."); }
  };
  const [mode, setMode] = useState<Mode>("architecture");
  const [codebaseView, setCodebaseView] = useState<CodebaseView>("map");
  const [visited, setVisited] = useState<Record<Mode, boolean>>({ processes: false, architecture: true, codebase: false });
  const open = (next: Mode) => { setVisited(current => ({ ...current, [next]: true })); setMode(next); };

  const openCode = (target: ArchitectCodeTarget) => {
    setCodeTarget(target);
    setCodebaseView("map");
    setReturnToModel(true);
    open("codebase");
  };

  return <div className={styles.workspace} ref={workspaceRef}>
    <div className={styles.workspaceBar}>
      <nav aria-label="Режимы Architect" className="flex flex-wrap gap-2">
        <Button variant={mode === "codebase" ? "primary" : "ghost"} size="sm" aria-pressed={mode === "codebase"} onClick={() => open("codebase")}><FolderTree size={14} aria-hidden /> Кодовая база</Button>
        <Button variant={mode === "architecture" ? "primary" : "ghost"} size="sm" aria-pressed={mode === "architecture"} onClick={() => open("architecture")}><Code2 size={14} aria-hidden /> Архитектура</Button>
      </nav>
      <div className={styles.workspaceActions}>
        {focused && <span className={styles.focusContext}>{workspaceName}</span>}
        <Button variant={mode === "processes" ? "primary" : "ghost"} size="sm" aria-pressed={mode === "processes"} onClick={() => open("processes")}><WorkflowIcon size={14} aria-hidden /> Процессы команды</Button>
        {returnToModel && mode === "codebase" && <Button size="sm" variant="outline" onClick={() => { setReturnToModel(false); open("architecture"); }}>Вернуться к схеме</Button>}
        <Button size="sm" variant="ghost" aria-pressed={focused} onClick={() => void toggleFocus()}>{focused ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}{focused ? "Выйти из фокуса" : "Режим фокуса"}</Button>
      </div>
    </div>
    {focusError && <p role="alert">{focusError}</p>}
    {visited.codebase && <div hidden={mode !== "codebase"}>
      <nav aria-label="Представления кодовой базы" className={styles.codeBar}>
        <Button size="sm" variant={codebaseView === "map" ? "outline" : "ghost"} aria-pressed={codebaseView === "map"} onClick={() => setCodebaseView("map")}><Code2 size={13} aria-hidden /> Карта проекта</Button>
        <Button size="sm" variant={codebaseView === "git" ? "outline" : "ghost"} aria-pressed={codebaseView === "git"} onClick={() => setCodebaseView("git")}><GitBranch size={13} aria-hidden /> История Git</Button>
      </nav>
      <ArchitectWorkbench workspaceId={workspaceId} surface={codebaseView} hideTabs codeTarget={codeTarget} />
    </div>}
    {visited.architecture && <div hidden={mode !== "architecture"}><ArchitectureCanvasWorkspace workspaceId={workspaceId} onOpenCode={openCode} /></div>}
    {visited.processes && <div hidden={mode !== "processes"}><WorkflowsPanel workspaceId={workspaceId} /></div>}
  </div>;
}
