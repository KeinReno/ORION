import { Suspense } from "react";
import { panelRegistry } from "../../../lib/panel-registry";
import { PanelWindow } from "./panel-window";

/**
 * The desktop build is a static export (no server) — a dynamic route needs
 * every param it can take enumerated up front. panelRegistry is that fixed
 * set already; nothing to duplicate here.
 */
export function generateStaticParams(): { panelId: string }[] {
  return panelRegistry.map((panel) => ({ panelId: panel.id }));
}

export default function PanelRoute({ params }: { params: { panelId: string } }): React.ReactElement {
  // U04: PanelWindow now reads `?workspaceId=` via `useSearchParams()`, which
  // needs a `<Suspense>` boundary under Next 14's app router (same pattern as
  // login/register/invite — see their page.tsx doc comments) or the desktop
  // `output: "export"` build fails with "should be wrapped in a suspense
  // boundary".
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">Открываю раздел…</div>}>
      <PanelWindow panelId={params.panelId} />
    </Suspense>
  );
}
