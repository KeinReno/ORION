"use client";

import { useCreateNote } from "@orion/core-react";
import { Button, IconButton, PanelShell, useToast } from "@orion/ui";
import { ClipboardCopy, ExternalLink, FileText, Globe, Plus, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { resolveBrowserInput, tabLabel } from "../lib/browser-url";
import { useBrowserRequest } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";

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
 * Встроенный браузер (как «Веб-просмотр» в Obsidian): страницы открываются вкладкой рабочего пространства, рядом
 * с заметками и задачами. Страница показывается во фрейме — сайты, запрещающие встраивание, останутся пустыми;
 * для них есть «Открыть во внешнем браузере». Принимаются только http(s)-адреса; фрейм песочный и без реферера.
 */
export function BrowserPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const createNote = useCreateNote(workspace?.id);
  const { toast } = useToast();
  const [state, setState] = useState<BrowserState>(() => ({ tabs: [{ id: "init", url: null }], active: "init" }));
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const input = useRef<HTMLInputElement>(null);

  // localStorage is read after mount, so server and first client render agree.
  useEffect(() => {
    const loaded = load();
    setState(loaded);
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
  useEffect(() => setDraft(active.url ?? ""), [active.id, active.url]);

  const navigate = useCallback((url: string, inNewTab = false) => {
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
  }, []);

  // A link someone clicked elsewhere in ORION ("open in the built-in browser").
  const request = useBrowserRequest();
  const handled = useRef(0);
  useEffect(() => {
    if (!request || !hydrated || request.nonce <= handled.current) return;
    handled.current = request.nonce;
    const target = resolveBrowserInput(request.url);
    if (target.kind === "url") navigate(target.url, true);
  }, [request, hydrated, navigate]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const target = resolveBrowserInput(draft);
    if (target.kind === "refused") {
      toast({ title: target.reason, tone: "danger" });
      return;
    }
    navigate(target.url);
  }

  function addTab(): void {
    if (state.tabs.length >= MAX_TABS) {
      toast({ title: `Не больше ${MAX_TABS} вкладок`, tone: "default" });
      return;
    }
    const tab = newTab();
    setState({ tabs: [...state.tabs, tab], active: tab.id });
    setTimeout(() => input.current?.focus(), 0);
  }

  function closeTab(id: string): void {
    const rest = state.tabs.filter((tab) => tab.id !== id);
    if (rest.length === 0) {
      const tab = newTab();
      setState({ tabs: [tab], active: tab.id });
      return;
    }
    setState({ tabs: rest, active: state.active === id ? rest[Math.max(0, state.tabs.findIndex((tab) => tab.id === id) - 1)]!.id : state.active });
  }

  async function clip(): Promise<void> {
    if (!active.url) return;
    try {
      await createNote.mutateAsync({ title: tabLabel(active.url), summary: "", body: `[${tabLabel(active.url)}](${active.url})\n`, tags: ["веб"] });
      toast({ title: "Ссылка сохранена заметкой", tone: "success" });
    } catch {
      toast({ title: "Не удалось создать заметку", description: "Модуль «Заметки» может быть выключен.", tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 pt-1.5" role="tablist" aria-label="Вкладки браузера">
        {state.tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === state.active}
            tabIndex={0}
            onClick={() => setState({ ...state, active: tab.id })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setState({ ...state, active: tab.id });
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                closeTab(tab.id);
              }
            }}
            className={`group flex max-w-[11rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1 text-xs ${
              tab.id === state.active ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{tabLabel(tab.url)}</span>
            <button
              type="button"
              aria-label={`Закрыть вкладку ${tabLabel(tab.url)}`}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              className="rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <IconButton label="Новая вкладка" size="sm" onClick={addTab}>
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>

      <form onSubmit={submit} className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <IconButton label="Обновить" size="sm" disabled={!active.url} onClick={() => setReloads({ ...reloads, [active.id]: (reloads[active.id] ?? 0) + 1 })}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
        <input
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Адрес или запрос"
          placeholder="Адрес сайта или запрос для поиска"
          className="min-w-0 flex-1 rounded-lg border border-border bg-white/[0.03] px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent/70"
        />
        <Button type="submit" size="sm" variant="outline">
          Перейти
        </Button>
        <IconButton label="Скопировать адрес" size="sm" disabled={!active.url} onClick={() => void navigator.clipboard?.writeText(active.url ?? "").then(() => toast({ title: "Адрес скопирован", tone: "success" }))}>
          <ClipboardCopy className="h-4 w-4" />
        </IconButton>
        <IconButton label="Сохранить ссылку заметкой" size="sm" disabled={!active.url || createNote.isPending} onClick={() => void clip()}>
          <FileText className="h-4 w-4" />
        </IconButton>
        <IconButton label="Открыть во внешнем браузере" size="sm" disabled={!active.url} onClick={() => active.url && window.open(active.url, "_blank", "noopener,noreferrer")}>
          <ExternalLink className="h-4 w-4" />
        </IconButton>
      </form>

      <div className="relative min-h-0 flex-1 bg-white">
        {active.url ? (
          <iframe
            key={`${active.id}:${reloads[active.id] ?? 0}:${active.url}`}
            src={active.url}
            title={tabLabel(active.url)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-muted-foreground">
            <Globe className="h-8 w-8" aria-hidden />
            <p className="text-foreground">Введите адрес сайта или запрос в строке выше</p>
            <p className="max-w-md text-xs">
              Страница откроется здесь, во вкладке ORION. Некоторые сайты запрещают встраивание — тогда область останется пустой: нажмите «Открыть во внешнем браузере».
            </p>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
