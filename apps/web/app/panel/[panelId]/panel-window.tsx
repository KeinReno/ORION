"use client";

import { ObjectContextScope, useSession } from "@orion/core-react";
import { isPluginEnabled } from "@orion/shared-types";
import { LoadingScreen } from "@orion/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { getPanelDefinition, instancePanelId } from "../../../lib/panel-registry";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../../lib/use-active-workspace";
import { PanelDraftScope } from "../../../lib/unsaved-drafts";
import { useTaskProjectRouting } from "../../../lib/task-project-routing";
import { AgentPanelFrame, AgentPresenceFeed } from "../../../lib/agent-presence";
import { useEnabledModules } from "../../../lib/use-enabled-modules";

/**
 * Renders exactly one panel with no sidebar/Workbench chrome — the
 * destination for a Tauri "detach to window" WebviewWindow (see
 * app/(app)/layout.tsx's DetachHeaderAction). A fresh window is a fresh JS
 * runtime, so this re-checks the session itself; the auth token is shared
 * via localStorage (same origin), so a logged-in user stays logged in here.
 *
 * U04: this window's active workspace is its OWN `sessionStorage`-scoped
 * choice (`use-active-workspace.ts`), not inherited from whatever window
 * opened it. `DetachHeaderAction` carries the opener's current workspace id
 * as a `?workspaceId=` query param specifically so this brand-new window has
 * something to seed itself with instead of finding nothing and bouncing to
 * `/spaces`; after that one-time seed it's an independent window context.
 */
export function PanelWindow({ panelId }: { panelId: string }): React.ReactElement {
  useTaskProjectRouting();
  const router = useRouter();
  const searchParams = useSearchParams();
  // sessionStorage starts empty in a new webview, and a useState initializer
  // does not run again on hydration. Seed during this client render so the
  // hook below sees the id. On the server `window` is missing, so the HTML
  // stays the loading screen and hydration matches.
  if (typeof window !== "undefined" && !getActiveWorkspaceId()) {
    const seed = searchParams.get("workspaceId");
    if (seed) setActiveWorkspaceId(seed);
  }
  const { user, isLoading, status, retry: retrySession } = useSession();
  const { workspace, workspaces, isLoading: workspacesLoading } = useActiveWorkspace();
  // An instanced panel (a project) arrives as `/panel/project?instance=<id>` — see `panelWindowUrl`.
  const instanceId = searchParams.get("instance");
  const definition = getPanelDefinition(instanceId ? instancePanelId(panelId, instanceId) : panelId);
  const { isEnabled } = useEnabledModules();

  useEffect(() => {
    // "unavailable" must not redirect to /login — a detached panel window
    // losing the API for a moment is not the same as being logged out.
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    // The seeded id can already be in sessionStorage while this render still holds the store's
    // previous (empty) snapshot — the next render picks it up. Redirecting on that stale frame sent
    // every freshly opened panel window to /spaces, so a stored id that names one of the user's
    // workspaces is trusted here, synchronously.
    const storedId = getActiveWorkspaceId();
    const storedIsKnown = storedId !== null && workspaces.some((item) => item.id === storedId);
    if (status === "authenticated" && !workspacesLoading && !workspace && !storedIsKnown) {
      router.replace("/spaces");
    }
  }, [status, workspacesLoading, workspace, workspaces, router]);

  if (status === "unavailable") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <p>Не удаётся связаться с сервером.</p>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-white/5"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (isLoading || !user || workspacesLoading || !workspace) {
    return <LoadingScreen />;
  }

  if (!definition) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Неизвестная панель: {panelId}
      </div>
    );
  }

  if (!definition.surfaces.includes("window")) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Панель «{definition.label}» нельзя открыть в отдельном окне.
      </div>
    );
  }

  if ((definition.moduleId && !isEnabled(definition.moduleId)) || (definition.pluginId && !isPluginEnabled(workspace?.pluginOverrides ?? [], definition.pluginId))) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {definition.moduleId && !isEnabled(definition.moduleId) ? "Модуль" : "Плагин"} «{definition.label}» выключен в этом пространстве. Данные
        сохранены — включите его в Настройках.
      </div>
    );
  }

  const Component = definition.component;
  const scopeId = instanceId ? instancePanelId(panelId, instanceId) : panelId;
  return (
    <div className="h-screen overflow-hidden">
      <AgentPresenceFeed />
      <AgentPanelFrame moduleId={definition.moduleId ?? null}>
        <PanelDraftScope panelId={scopeId}><ObjectContextScope panelId={scopeId}><Component params={instanceId ? { instanceId } : undefined} /></ObjectContextScope></PanelDraftScope>
      </AgentPanelFrame>
    </div>
  );
}
