"use client";

import { IconButton, PanelShell, useToast } from "@orion/ui";
import { Globe, PanelRightOpen, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserPage } from "../components/browser-page";
import { browserPanelId, savePage } from "../lib/browser-pages";
import { isSameOrigin, resolveBrowserInput, tabLabel } from "../lib/browser-url";
import { openPanel, useBrowserRequest } from "../lib/panel-bus";
import { ORION_PANEL_DRAG_MIME } from "../lib/panel-drop";

interface BrowserTab {
  id: string;
  /** The page shown; null = a new, empty tab. */
  url: string | null;
}

interface BrowserState {
  tabs: BrowserTab[];
  active: string;
}

const KEY = "orion.browser.tabs.v1";
const MAX_TABS = 8;

function newTab(url: string | null = null): BrowserTab {
  return { id: `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, url };
}

function load(): BrowserState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as BrowserState | null;
    if (raw && Array.isArray(raw.tabs) && raw.tabs.length > 0) {
      // Whatever was stored, only web pages come back: a hand-edited or damaged value never reaches an iframe.
      const tabs = raw.tabs
        .slice(0, MAX_TABS)
        .filter((tab) => typeof tab?.id === "string")
        .map((tab) => ({ id: tab.id, url: typeof tab.url === "string" && resolveBrowserInput(tab.url).kind === "url" ? tab.url : null }));
      if (tabs.length > 0) return { tabs, active: tabs.some((tab) => tab.id === raw.active) ? raw.active : tabs[0]!.id };
    }
  } catch {
    /* a convenience only */
  }
  const first = newTab();
  return { tabs: [first], active: first.id };
}

/**
 * Встроенный браузер (как «Веб-просмотр» в Obsidian): страницы открываются вкладками внутри панели. Вкладку можно
 * перетащить за её название в рабочую область ORION — она станет отдельной вкладкой дока (рядом, сверху или снизу
 * от других панелей), как и разделы из меню; то же делает кнопка «Вынести во вкладку ORION». Принимаются только
 * http(s)-адреса; desktop использует отдельный WebView, веб-версия — sandboxed iframe без реферера.
 */
export function BrowserPanel(): React.ReactElement {
  const { toast } = useToast();
  const [state, setState] = useState<BrowserState>(() => ({ tabs: [{ id: "init", url: null }], active: "init" }));
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // localStorage is read after mount, so server and first client render agree.
  useEffect(() => {
    setState(load());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* a convenience only */
    }
  }, [state, hydrated]);

  const active = state.tabs.find((tab) => tab.id === state.active) ?? state.tabs[0]!;

  const navigate = useCallback((url: string, inNewTab = false) => {
    if (isSameOrigin(url, window.location.origin)) {
      toast({ title: "Это адрес самого ORION", description: "Страницы приложения во встроенном браузере не открываются.", tone: "default" });
      return;
    }
    setState((current) => {
      const target = current.tabs.find((tab) => tab.id === current.active) ?? current.tabs[0]!;
      // A request from outside (a link in a note) fills an empty tab, otherwise opens a new one.
      if (inNewTab && target.url !== null) {
        if (current.tabs.length >= MAX_TABS) return { ...current, tabs: current.tabs.map((tab) => (tab.id === target.id ? { ...tab, url } : tab)) };
        const tab = newTab(url);
        return { tabs: [...current.tabs, tab], active: tab.id };
      }
      return { ...current, tabs: current.tabs.map((tab) => (tab.id === target.id ? { ...tab, url } : tab)) };
    });
  }, [toast]);

  // A link someone clicked elsewhere in ORION ("open in the built-in browser").
  const request = useBrowserRequest();
  const handled = useRef(0);
  useEffect(() => {
    if (!request || !hydrated || request.nonce <= handled.current) return;
    handled.current = request.nonce;
    const target = resolveBrowserInput(request.url);
    if (target.kind === "url") navigate(target.url, true);
  }, [request, hydrated, navigate]);

  function addTab(): void {
    if (state.tabs.length >= MAX_TABS) {
      toast({ title: `Не больше ${MAX_TABS} вкладок`, tone: "default" });
      return;
    }
    const tab = newTab();
    setState({ tabs: [...state.tabs, tab], active: tab.id });
  }

  function closeTab(id: string): void {
    const current = stateRef.current;
    const rest = current.tabs.filter((tab) => tab.id !== id);
    if (rest.length === 0) {
      const tab = newTab();
      setState({ tabs: [tab], active: tab.id });
      return;
    }
    const index = current.tabs.findIndex((tab) => tab.id === id);
    setState({ tabs: rest, active: current.active === id ? rest[Math.max(0, index - 1)]!.id : current.active });
  }

  /** Make a tab a dock panel of its own: the page is remembered under the tab's id, the dock opens `browsertab:<id>`. */
  function tearOut(tab: BrowserTab): void {
    if (!tab.url) return;
    savePage(localStorage, tab.id, tab.url);
    openPanel(browserPanelId(tab.id), tabLabel(tab.url));
    closeTab(tab.id);
  }

  return (
    <PanelShell>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 pt-1.5">
        {/* Plain buttons in a labelled group (the buttons beside a tab cannot live inside a tab role). */}
        <div role="group" aria-label="Вкладки браузера" className="flex items-center gap-1">
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(tab.id);
                }
              }}
              className={`group flex max-w-[13rem] shrink-0 items-center rounded-t-lg border border-b-0 text-xs ${
                tab.id === state.active ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <button
                type="button"
                aria-current={tab.id === state.active ? "true" : undefined}
                draggable={Boolean(tab.url)}
                title={tab.url ? "Перетащите в рабочую область, чтобы открыть отдельной вкладкой ORION" : undefined}
                onDragStart={(event) => {
                  if (!tab.url) return;
                  // The same drag the sidebar uses: the dock recognises the payload and opens `browsertab:<id>` where it is dropped.
                  savePage(localStorage, tab.id, tab.url);
                  event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, browserPanelId(tab.id));
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={(event) => {
                  // Accepted by the dock → the page now lives in its own panel, so it leaves this strip.
                  if (event.dataTransfer.dropEffect !== "none" && tab.url) closeTab(tab.id);
                }}
                onClick={() => setState({ ...state, active: tab.id })}
                className="flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Globe className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{tabLabel(tab.url)}</span>
              </button>
              {tab.url ? (
                <button
                  type="button"
                  aria-label={`Вынести во вкладку ORION: ${tabLabel(tab.url)}`}
                  title="Вынести во вкладку ORION"
                  onClick={() => tearOut(tab)}
                  className="rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <PanelRightOpen className="h-3 w-3" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`Закрыть вкладку ${tabLabel(tab.url)}`}
                onClick={() => closeTab(tab.id)}
                className="mr-1 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <IconButton label="Новая вкладка" size="sm" onClick={addTab}>
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>

      <BrowserPage
        key={active.id}
        url={active.url}
        autoFocusBar={active.url === null}
        onNavigate={(url) => setState((current) => ({ ...current, tabs: current.tabs.map((tab) => (tab.id === current.active ? { ...tab, url } : tab)) }))}
      />
    </PanelShell>
  );
}
