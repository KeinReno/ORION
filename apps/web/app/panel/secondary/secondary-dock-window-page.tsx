"use client";

import { useSession } from "@orion/core-react";
import { LoadingScreen, Workbench, type DockviewApi, type DockviewReadyEvent } from "@orion/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AgentPresenceFeed } from "../../../lib/agent-presence";
import { dockLayoutStorageKey } from "../../../lib/dock-layout-key";
import { sanitizeDockLayout } from "../../../lib/dock-layout-sanitize";
import { useEnabledModules } from "../../../lib/use-enabled-modules";
import { buildPanelComponents } from "../../../lib/panel-components";
import { getPanelDefinition, isPanelAvailable, panelInstanceId } from "../../../lib/panel-registry";
import { registerPanelBus } from "../../../lib/panel-bus";
import { objectViewPanel } from "../../../lib/object-view";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../../lib/use-active-workspace";
import { useSecondaryDockGuest } from "../../../lib/secondary-dock-window";

const panelComponents = buildPanelComponents();

/**
 * Renders the second dock standalone — the destination for ORION-11's
 * "Открепить на другой экран". Same window-bootstrap pattern as
 * `app/panel/[panelId]/panel-window.tsx` (fresh JS runtime, re-check the
 * session, seed the active workspace from `?workspaceId=` once), but hosts
 * a full `<Workbench>` instead of a single panel — this window's own
 * `DockviewApi`, loading/saving the SAME `dockLayoutStorageKey(..., "secondary")`
 * the docked copy in the main window reads, so whichever one is currently
 * rendering it picks up exactly where the other left off.
 */
export function SecondaryDockWindow(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, status, retry: retrySession } = useSession();
  const { workspace, workspaces, isLoading: workspacesLoading } = useActiveWorkspace();
  const { disabledModules } = useEnabledModules();
  const pluginOverrides = useMemo(() => workspace?.pluginOverrides ?? [], [workspace]);
  const apiRef = useRef<DockviewApi | null>(null);
  useSecondaryDockGuest();

  useEffect(() => {
    if (getActiveWorkspaceId()) return;
    const seed = searchParams.get("workspaceId");
    if (seed) setActiveWorkspaceId(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    const storedId = getActiveWorkspaceId();
    const storedIsKnown = storedId !== null && workspaces.some((item) => item.id === storedId);
    if (status === "authenticated" && !workspacesLoading && !workspace && !storedIsKnown) {
      router.replace("/spaces");
    }
  }, [status, workspacesLoading, workspace, workspaces, router]);

  const openPanel = useCallback((panelId: string, title?: string) => {
    const api = apiRef.current;
    const definition = getPanelDefinition(panelId);
    if (!api || !definition || !isPanelAvailable(definition, disabledModules, pluginOverrides)) return;
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const instanceId = panelInstanceId(panelId);
    api.addPanel({
      id: panelId,
      component: definition.id,
      title: title ?? definition.label,
      ...(instanceId ? { params: { instanceId } } : {})
    });
  }, [disabledModules, pluginOverrides]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    if (user && workspace) {
      const key = dockLayoutStorageKey(user.id, workspace.id, "secondary");
      try {
        const raw = window.localStorage.getItem(key);
        const clean = raw ? sanitizeDockLayout(JSON.parse(raw), (id) => Boolean(getPanelDefinition(id)), { width: window.innerWidth, height: window.innerHeight }) : null;
        if (clean) event.api.fromJSON(clean.layout as unknown as Parameters<DockviewApi["fromJSON"]>[0]);
      } catch {
        /* a corrupt saved layout just starts this dock empty */
      }
      event.api.onDidLayoutChange(() => {
        try {
          window.localStorage.setItem(key, JSON.stringify(event.api.toJSON()));
        } catch {
          /* a lost save just means the next change tries again */
        }
      });
    }
  }, [user, workspace]);

  useEffect(() => registerPanelBus({
    openPanel,
    openObject: (view, mode, title) => {
      const panelId = objectViewPanel(view, getActiveWorkspaceId());
      if (panelId) openPanel(panelId, title);
    }
  }), [openPanel]);

  if (status === "unavailable") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <p>Не удаётся связаться с сервером.</p>
        <button type="button" onClick={retrySession} className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-white/5">
          Повторить
        </button>
      </div>
    );
  }

  if (isLoading || !user || workspacesLoading || !workspace) {
    return <LoadingScreen />;
  }

  return (
    <div className="h-screen overflow-hidden">
      <AgentPresenceFeed />
      <Workbench components={panelComponents} onReady={onReady} onRequestClose={(panelId) => { apiRef.current?.getPanel(panelId)?.api.close(); }} />
    </div>
  );
}
