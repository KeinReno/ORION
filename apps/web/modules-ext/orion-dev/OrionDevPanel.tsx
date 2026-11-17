"use client";

import { Badge, Button, EmptyState, PanelBody, PanelHeader, PanelShell } from "@orion/ui";
import { Code2, Compass, GitBranch, Workflow as WorkflowIcon } from "lucide-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import styles from "./orion-dev.module.css";

const ArchitectWorkbench = dynamic(() => import("./ArchitectWorkbench").then(module => module.ArchitectWorkbench), { ssr: false, loading: () => <p role="status">Загружаем рабочую поверхность Architect…</p> });
const WorkflowsPanel = dynamic(() => import("./WorkflowsPanel").then(module => module.WorkflowsPanel), { ssr: false, loading: () => <p role="status">Загружаем процессы…</p> });

type Tab = "processes" | "architecture" | "git";

export function OrionDevPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  return <PanelShell>
    <PanelHeader icon={Compass} title="Architect" subtitle={workspace ? `Рабочее пространство · ${workspace.name}` : "Процессы, архитектура и Git"} />
    <PanelBody measure="wide">
      {!workspace ? <EmptyState icon={Compass} title="Выберите пространство" description="Откройте пространство, в котором хотите работать." /> :
        workspace.role !== "owner" && workspace.role !== "lead" ? <p role="status">Рабочее пространство доступно владельцу и руководителю пространства.</p> :
          <ArchitectWorkspace key={workspace.id} workspaceId={workspace.id} />}
    </PanelBody>
  </PanelShell>;
}

function ArchitectWorkspace({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const [tab, setTab] = useState<Tab>("processes");
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ processes: true, architecture: false, git: false });
  const open = (next: Tab) => { setVisited(current => ({ ...current, [next]: true })); setTab(next); };

  return <div className={styles.workspace}>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <nav aria-label="Разделы Architect" className="flex flex-wrap gap-2">
        <Button variant={tab === "processes" ? "primary" : "ghost"} size="sm" aria-pressed={tab === "processes"} onClick={() => open("processes")}><WorkflowIcon size={14} aria-hidden /> Процессы</Button>
        <Button variant={tab === "architecture" ? "primary" : "ghost"} size="sm" aria-pressed={tab === "architecture"} onClick={() => open("architecture")}><Code2 size={14} aria-hidden /> Архитектура</Button>
        <Button variant={tab === "git" ? "primary" : "ghost"} size="sm" aria-pressed={tab === "git"} onClick={() => open("git")}><GitBranch size={14} aria-hidden /> Git</Button>
      </nav>
      <Badge tone="neutral">Проектно-нейтральное пространство</Badge>
    </div>
    <div hidden={tab !== "processes"}><WorkflowsPanel workspaceId={workspaceId} /></div>
    {visited.architecture && <div hidden={tab !== "architecture"}><ArchitectWorkbench workspaceId={workspaceId} surface="map" hideTabs /></div>}
    {visited.git && <div hidden={tab !== "git"}><ArchitectWorkbench workspaceId={workspaceId} surface="git" hideTabs /></div>}
  </div>;
}
