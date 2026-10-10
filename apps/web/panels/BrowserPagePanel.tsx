"use client";

import { PanelShell } from "@orion/ui";
import { useEffect, useState } from "react";
import { BrowserPage } from "../components/browser-page";
import { readPages, savePage } from "../lib/browser-pages";
import { tabLabel } from "../lib/browser-url";
import type { PanelComponentProps } from "../lib/panel-registry";

/**
 * One page of the built-in browser as a dock panel of its own (`browsertab:<id>`): a tab torn out of the browser panel, so it
 * can sit beside notes and tasks, be split, or go to a second window. Its address is kept under the panel's id
 * (`lib/browser-pages.ts`); navigating inside it updates that, and the dock tab is renamed after the site.
 */
export function BrowserPagePanel({ params, api }: PanelComponentProps): React.ReactElement {
  const id = params?.instanceId ?? "";
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (id) setUrl(readPages(localStorage)[id] ?? null);
  }, [id]);
  useEffect(() => {
    api?.setTitle(tabLabel(url));
  }, [api, url]);

  return (
    <PanelShell>
      <BrowserPage
        url={url}
        autoFocusBar={url === null}
        onNavigate={(next) => {
          setUrl(next);
          if (id) savePage(localStorage, id, next);
        }}
      />
    </PanelShell>
  );
}
