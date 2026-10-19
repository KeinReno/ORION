"use client";

import { useCreateNote } from "@orion/core-react";
import { Button, IconButton, Select, useToast } from "@orion/ui";
import { ArrowLeft, ArrowRight, ClipboardCopy, ExternalLink, FileText, Globe, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { readEngine, saveEngine } from "../lib/browser-pages";
import { isSameOrigin, resolveBrowserInput, SEARCH_ENGINES, searchEngine, tabLabel, type SearchEngineId } from "../lib/browser-url";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { isTauri } from "../lib/is-tauri";
import { NativeBrowserView, type BrowserAction } from "./native-browser-view";

/**
 * Shared by browser tabs and torn-out dock pages. Desktop uses an isolated native child WebView;
 * the web client keeps a sandboxed frame and its explicit separate-page fallback.
 */
export function BrowserPage({
  url,
  onNavigate,
  autoFocusBar = false
}: {
  /** The page shown; null = an empty page. */
  url: string | null;
  onNavigate: (url: string) => void;
  autoFocusBar?: boolean;
}): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const createNote = useCreateNote(workspace?.id);
  const { toast } = useToast();
  const [draft, setDraft] = useState(url ?? "");
  const [reload, setReload] = useState(0);
  const [engine, setEngine] = useState<SearchEngineId>("google");
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [action, setAction] = useState<BrowserAction | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // localStorage is read after mount, so the server render and the first client render agree.
  useEffect(() => setEngine(readEngine(localStorage)), []);
  useEffect(() => setDesktop(isTauri()), []);
  useEffect(() => setDraft(url ?? ""), [url]);
  useEffect(() => {
    if (autoFocusBar) input.current?.focus();
  }, [autoFocusBar]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const target = resolveBrowserInput(draft, engine);
    if (target.kind === "refused") {
      toast({ title: target.reason, tone: "danger" });
      return;
    }
    if (isSameOrigin(target.url, window.location.origin)) {
      toast({ title: "Это адрес самого ORION", description: "Страницы приложения во встроенном браузере не открываются.", tone: "default" });
      return;
    }
    onNavigate(target.url);
  }

  async function clip(): Promise<void> {
    if (!url) return;
    try {
      await createNote.mutateAsync({ title: tabLabel(url), summary: "", body: `[${tabLabel(url)}](${url})\n`, tags: ["веб"] });
      toast({ title: "Ссылка сохранена заметкой", tone: "success" });
    } catch {
      toast({ title: "Не удалось создать заметку", description: "Модуль «Заметки» может быть выключен.", tone: "danger" });
    }
  }

  const current = searchEngine(engine);

  return (
    <>
      <form onSubmit={submit} className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
        {desktop ? <>
          <IconButton label="Назад" size="sm" disabled={!url} onClick={() => setAction((prev) => ({ sequence: (prev?.sequence ?? 0) + 1, name: "back" }))}><ArrowLeft className="h-4 w-4" /></IconButton>
          <IconButton label="Вперёд" size="sm" disabled={!url} onClick={() => setAction((prev) => ({ sequence: (prev?.sequence ?? 0) + 1, name: "forward" }))}><ArrowRight className="h-4 w-4" /></IconButton>
        </> : null}
        <IconButton label="Обновить" size="sm" disabled={!url} onClick={() => desktop ? setAction((prev) => ({ sequence: (prev?.sequence ?? 0) + 1, name: "reload" })) : setReload((n) => n + 1)}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
        <input
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Адрес или запрос"
          placeholder={`Адрес сайта или запрос — поиск в ${current.label}`}
          className="min-w-[10rem] flex-1 rounded-lg border border-border bg-white/[0.03] px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent/70"
        />
        <Select
          aria-label="Поисковая система"
          title={`Искать в ${current.label}`}
          value={engine}
          onChange={(event) => {
            const next = event.target.value as SearchEngineId;
            setEngine(next);
            saveEngine(localStorage, next);
          }}
          className="w-auto"
        >
          {SEARCH_ENGINES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="outline">
          Перейти
        </Button>
        <IconButton
          label="Скопировать адрес"
          size="sm"
          disabled={!url}
          onClick={() => void navigator.clipboard?.writeText(url ?? "").then(() => toast({ title: "Адрес скопирован", tone: "success" }))}
        >
          <ClipboardCopy className="h-4 w-4" />
        </IconButton>
        <IconButton label="Сохранить ссылку заметкой" size="sm" disabled={!url || createNote.isPending} onClick={() => void clip()}>
          <FileText className="h-4 w-4" />
        </IconButton>
        {url && !desktop ? (
          <Button
            size="sm"
            variant="subtle"
            title="Если сайт не показывает страницу внутри ORION, откройте её отдельно"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="h-4 w-4" /> Открыть отдельно
          </Button>
        ) : null}
      </form>

      <div className="relative min-h-0 flex-1 bg-background">
        {url && desktop === true ? <NativeBrowserView url={url} onNavigate={onNavigate} action={action} /> : url && desktop === false ? (
          <iframe
            key={`${reload}:${url}`}
            src={url}
            title={tabLabel(url)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-muted-foreground">
            <Globe className="h-8 w-8" aria-hidden />
            <p className="text-foreground">Введите адрес сайта или запрос в строке выше</p>
            <p className="max-w-md text-xs">
              {desktop ? `Поиск в ${current.label}. Страница откроется здесь, внутри ORION.` : `Поиск в ${current.label}. В веб-версии некоторые сайты запрещают встроенный просмотр. Полноценный браузер доступен в приложении ORION для Windows.`}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
