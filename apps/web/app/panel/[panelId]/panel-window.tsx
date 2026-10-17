"use client";

import { ObjectContextScope, useSession } from "@orion/core-react";
import { isPluginEnabled } from "@orion/shared-types";
import { LoadingScreen } from "@orion/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { getPanelDefinition, instancePanelId } from "../../../lib/panel-registry";
import { getActiveWorkspaceId, setActiveWorkspaceId, useActiveWorkspace } from "../../../lib/use-active-workspace";
import { PanelDraftScope } from "../../../lib/unsaved-drafts";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, status, retry: retrySession } = useSession();
  const { workspace, isLoading: workspacesLoading } = useActiveWorkspace();
  // An instanced panel (a project) arrives as `/panel/project?instance=<id>` — see `panelWindowUrl`.
  const instanceId = searchParams.get("instance");
  const definition = getPanelDefinition(instanceId ? instancePanelId(panelId, instanceId) : panelId);
  const { isEnabled } = useEnabledModules();

  useEffect(() => {
    // Seed once, and only when this window's own sessionStorage-scoped
    // choice is truly empty (a synchronous check — not the `workspace`
    // hook result, which is still `undefined` mid-fetch regardless). An
    // already-detached window that reloads keeps its own prior choice
    // rather than snapping back to whatever the opener had at reload time.
    if (getActiveWorkspaceId()) return;
    const seed = searchParams.get("workspaceId");
    if (seed) setActiveWorkspaceId(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // "unavailable" must not redirect to /login — a detached panel window
    // losing the API for a moment is not the same as being logged out.
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated" && !workspacesLoading && !workspace) {
      router.replace("/spaces");
    }
  }, [status, workspacesLoading, workspace, router]);

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
      <PanelDraftScope panelId={scopeId}><ObjectContextScope panelId={scopeId}><Component params={instanceId ? { instanceId } : undefined} /></ObjectContextScope></PanelDraftScope>
    </div>
  );
}
