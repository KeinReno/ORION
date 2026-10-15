"use client";

import { useWorkspaces } from "@orion/core-react";
import { parseOrionLink } from "@orion/shared-types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { openEntity, openPanel } from "../../../lib/panel-bus";
import { setActiveWorkspaceId } from "../../../lib/use-active-workspace";

/**
 * `/open?type=note&id=…&workspace=…` — the web form of an `orion://open?…` link that an agent returned (TZ-02,
 * ADR-0014). The desktop shell forwards `orion://` links here. Navigation only: it switches to the workspace if the
 * signed-in person is a member, focuses the object in its own panel (which loads it through the access-checked API),
 * and lands on the dashboard. A static route with query parameters because the desktop build is a static export.
 */
function OpenLink(): React.ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const workspaces = useWorkspaces();
  const [message, setMessage] = useState("Открываю…");
  const done = useRef(false);

  useEffect(() => {
    if (done.current || workspaces.isLoading) return;
    const link = parseOrionLink(params.toString());
    if (!link) {
      setMessage("Ссылка не распознана.");
      return;
    }
    if (!(workspaces.data ?? []).some((workspace) => workspace.id === link.workspaceId)) {
      setMessage("Эта ссылка ведёт в пространство, к которому у вас нет доступа.");
      return;
    }
    done.current = true;
    setActiveWorkspaceId(link.workspaceId);
    router.replace("/dashboard");
    // After the dock exists: the layout mounts on /dashboard and consumes the pending intent.
    window.setTimeout(() => {
      if (link.type === "inbox") openPanel("inbox", "Инбокс");
      else openEntity(link.type, link.id);
    }, 400);
  }, [params, router, workspaces.data, workspaces.isLoading]);

  return <p className="p-6 text-label text-muted-foreground">{message}</p>;
}

export default function OpenPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <OpenLink />
    </Suspense>
  );
}
