"use client";

import { useCore } from "@orion/core-react";
import { CHAT_ARCHIVE_SOURCE_LABELS, type ChatArchiveConversation, type ChatArchiveLine, type ChatArchiveSource } from "@orion/shared-types";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  MarkdownView,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Skeleton,
  useToast
} from "@orion/ui";
import { ArrowLeft, Download, FileUp, MessagesSquare, Pencil, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import {
  downloadChatArchiveOriginal,
  fetchChatArchiveRawLine,
  useChatArchiveConversations,
  useChatArchiveLines,
  useChatArchiveSearch,
  useDeleteChatArchiveConversation,
  useImportChatArchiveFile,
  useRenameChatArchiveConversation
} from "./use-chat-archive";

type SourceFilter = "all" | ChatArchiveSource;

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "claude-code", label: CHAT_ARCHIVE_SOURCE_LABELS["claude-code"] },
  { value: "codex", label: CHAT_ARCHIVE_SOURCE_LABELS.codex }
];

const lastFolder = (path: string | null) => (path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : null);

/**
 * Архив чатов: разговоры с ИИ-агентами в исходном виде. Слева — список (или найденное), справа — разговор: реплики
 * по порядку, вызовы инструментов и служебные строки свёрнуты, у любой строки можно открыть исходник, весь файл —
 * выгрузить байт в байт. Архив личный: другие участники пространства его не видят.
 */
export function ChatArchivePanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const [source, setSource] = useState<SourceFilter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<{ id: string; seq?: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const conversations = useChatArchiveConversations(workspaceId, source === "all" ? undefined : source);
  const search = useChatArchiveSearch(workspaceId, q);
  const importFile = useImportChatArchiveFile(workspaceId, (done, total) => setProgress({ done, total }));
  const searching = q.trim().length >= 2;
  const current = (conversations.data ?? []).find((item) => item.id === selected?.id);

  async function onFiles(files: FileList | null): Promise<void> {
    for (const file of Array.from(files ?? [])) {
      try {
        const result = await importFile.mutateAsync(file);
        toast({
          title: result.appended > 0 ? `Сохранено: «${result.title}»` : "Этот разговор уже в архиве",
          description: [
            result.appended > 0 ? `Добавлено строк: ${result.appended}.` : null,
            result.tornTail ? "Последняя строка ещё дописывается — она попадёт в архив при следующем импорте." : null
          ].filter(Boolean).join(" ") || undefined,
          tone: "success"
        });
        if (result.conversationId) setSelected({ id: result.conversationId });
      } catch (error) {
        toast({ title: `Не удалось импортировать ${file.name}`, description: describeError(error), tone: "danger" });
      }
    }
    setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const header = (
    <PanelHeader
      icon={MessagesSquare}
      title="Архив чатов"
      subtitle="Разговоры с агентами в исходном виде · видите только вы"
      actions={
        <>
          <input ref={fileInput} type="file" accept=".jsonl,application/x-ndjson" multiple hidden onChange={(event) => void onFiles(event.target.files)} />
          <Button size="sm" variant="outline" disabled={!workspaceId || importFile.isPending} status={importFile.isPending ? "pending" : "idle"} onClick={() => fileInput.current?.click()}>
            <FileUp className="h-4 w-4" />
            {progress && importFile.isPending ? `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` : "Импорт файла"}
          </Button>
        </>
      }
    />
  );

  if (workspaceId === undefined) {
    return (
      <PanelShell>
        {header}
        <PanelBody measure="wide">
          {workspaceLoading ? <Skeleton className="h-16 w-full" /> : <EmptyState icon={MessagesSquare} title="Нет рабочего пространства" description="Архив живёт внутри пространства — создайте его или войдите заново." />}
        </PanelBody>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      {header}
      <PanelBody measure="wide">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <aside className={`min-w-0 space-y-3 ${selected ? "hidden lg:block" : ""}`} aria-label="Разговоры">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Найти фразу в разговорах" aria-label="Поиск по архиву" />
            </div>
            {!searching && <SegmentedControl size="sm" aria-label="Источник" options={SOURCE_OPTIONS} value={source} onChange={setSource} />}
            {searching ? (
              search.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (search.data ?? []).length === 0 ? (
                <EmptyState icon={Search} title="Ничего не найдено" description="Ищутся реплики и ответы, без вызовов инструментов." />
              ) : (
                <ul className="space-y-2">
                  {(search.data ?? []).map((hit) => (
                    <li key={`${hit.conversationId}-${hit.seq}`}>
                      <button type="button" className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-accent" onClick={() => setSelected({ id: hit.conversationId, seq: hit.seq })}>
                        <div className="truncate text-sm font-medium">{hit.title}</div>
                        <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{hit.snippet}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {hit.role === "user" ? "Вы" : CHAT_ARCHIVE_SOURCE_LABELS[hit.source]}
                          {hit.at ? ` · ${shortDateTime(hit.at)}` : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : conversations.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : conversations.isError ? (
              <EmptyState
                icon={MessagesSquare}
                tone="danger"
                title="Не удалось загрузить архив"
                description={describeError(conversations.error)}
                action={<Button size="sm" variant="outline" onClick={() => void conversations.refetch()}>Повторить</Button>}
              />
            ) : (conversations.data ?? []).length === 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title="Архив пуст"
                description="Импортируйте файл транскрипта (.jsonl из ~/.claude/projects или ~/.codex/sessions) или включите автосохранение: scripts/chat-archive-push.mjs."
              />
            ) : (
              <ul className="space-y-2">
                {(conversations.data ?? []).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === selected?.id}
                      className={`w-full rounded-lg border p-3 text-left ${item.id === selected?.id ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent"}`}
                      onClick={() => setSelected({ id: item.id })}
                    >
                      <div className="truncate text-sm font-medium">{item.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Badge>{CHAT_ARCHIVE_SOURCE_LABELS[item.source]}</Badge>
                        {lastFolder(item.projectPath) && <span className="min-w-0 max-w-full truncate">{lastFolder(item.projectPath)}</span>}
                        <span>· {item.messageCount} сообщ.</span>
                        {item.lastAt && <span>· {shortDateTime(item.lastAt)}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <section className={`min-w-0 ${selected ? "" : "hidden lg:block"}`} aria-label="Разговор">
            {selected ? (
              <ConversationReader
                workspaceId={workspaceId}
                conversation={current}
                conversationId={selected.id}
                focusSeq={selected.seq}
                onBack={() => setSelected(null)}
              />
            ) : (
              <EmptyState icon={MessagesSquare} title="Выберите разговор" description="Слева — сохранённые разговоры и поиск по ним." />
            )}
          </section>
        </div>
      </PanelBody>
    </PanelShell>
  );
}

function ConversationReader({
  workspaceId,
  conversation,
  conversationId,
  focusSeq,
  onBack
}: {
  workspaceId: string;
  conversation: ChatArchiveConversation | undefined;
  conversationId: string;
  focusSeq?: number;
  onBack: () => void;
}): React.ReactElement {
  const { api } = useCore();
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const lines = useChatArchiveLines(workspaceId, conversationId, !showAll);
  const rename = useRenameChatArchiveConversation(workspaceId);
  const remove = useDeleteChatArchiveConversation(workspaceId);
  const all = useMemo(() => (lines.data?.pages ?? []).flatMap((page) => page.lines), [lines.data]);

  // Переход из поиска: догрузить страницы до найденной строки и прокрутить к ней.
  useEffect(() => {
    if (focusSeq === undefined || lines.isFetching) return;
    if (all.some((line) => line.seq === focusSeq)) {
      document.querySelector(`[data-chat-seq="${conversationId}-${focusSeq}"]`)?.scrollIntoView({ block: "center" });
    } else if (lines.hasNextPage) {
      void lines.fetchNextPage();
    }
  }, [focusSeq, all, lines, conversationId]);

  async function download(): Promise<void> {
    if (!conversation) return;
    setDownloading(true);
    try {
      await downloadChatArchiveOriginal(api, workspaceId, conversation);
    } catch (error) {
      toast({ title: "Не удалось выгрузить оригинал", description: describeError(error), tone: "danger" });
    } finally {
      setDownloading(false);
    }
  }

  async function saveTitle(): Promise<void> {
    if (renaming === null || renaming.trim() === "") return setRenaming(null);
    try {
      await rename.mutateAsync({ id: conversationId, title: renaming.trim() });
      setRenaming(null);
    } catch (error) {
      toast({ title: "Не удалось переименовать", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="lg:hidden" onClick={onBack} aria-label="К списку">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {renaming !== null ? (
          <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
            <Input className="flex-1" value={renaming} autoFocus maxLength={300} onChange={(event) => setRenaming(event.target.value)} aria-label="Название разговора" />
            <Button size="sm" type="submit" status={rename.isPending ? "pending" : "idle"}>Сохранить</Button>
          </form>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{conversation?.title ?? "Разговор"}</h2>
        )}
        {conversation && renaming === null && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(conversation.title)} aria-label="Переименовать"><Pencil className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => void download()} disabled={downloading} aria-label="Скачать оригинал (.jsonl)" title="Скачать оригинал (.jsonl)"><Download className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Удалить из архива"><Trash2 className="h-4 w-4" /></Button>
          </>
        )}
      </div>
      {conversation && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge>{CHAT_ARCHIVE_SOURCE_LABELS[conversation.source]}</Badge>
          {conversation.projectPath && <span className="min-w-0 max-w-full truncate" title={conversation.projectPath}>{conversation.projectPath}</span>}
          {conversation.startedAt && <span>· {shortDateTime(conversation.startedAt)}</span>}
          <span>· строк в оригинале: {conversation.lineCount}</span>
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            Инструменты и служебное
          </label>
        </div>
      )}
      {lines.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : lines.isError ? (
        <EmptyState icon={MessagesSquare} tone="danger" title="Не удалось открыть разговор" description={describeError(lines.error)} />
      ) : all.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Реплик нет" description="Включите «Инструменты и служебное», чтобы увидеть все строки файла." />
      ) : (
        <ol className="space-y-2">
          {all.map((line) => (
            <LineView key={line.seq} line={line} source={conversation?.source} highlighted={line.seq === focusSeq} anchor={`${conversationId}-${line.seq}`} loadRaw={() => fetchChatArchiveRawLine(api, workspaceId, conversationId, line.seq)} />
          ))}
        </ol>
      )}
      {lines.hasNextPage && (
        <Button size="sm" variant="outline" onClick={() => void lines.fetchNextPage()} status={lines.isFetchingNextPage ? "pending" : "idle"}>
          Показать дальше
        </Button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить разговор из архива?"
        description="Удалится копия в ORION. Исходный файл на диске не трогается — его можно импортировать снова."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove.mutate(conversationId, {
            onSuccess: onBack,
            onError: (error) => toast({ title: "Не удалось удалить", description: describeError(error), tone: "danger" })
          });
        }}
      />
    </div>
  );
}

function LineView({
  line,
  source,
  highlighted,
  anchor,
  loadRaw
}: {
  line: ChatArchiveLine;
  source: ChatArchiveSource | undefined;
  highlighted: boolean;
  anchor: string;
  loadRaw: () => Promise<string>;
}): React.ReactElement {
  const [raw, setRaw] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const time = line.at ? shortDateTime(line.at) : "";

  async function toggleRaw(): Promise<void> {
    if (raw !== null) return setRaw(null);
    try {
      setRawError(null);
      setRaw(await loadRaw());
    } catch (error) {
      setRawError(describeError(error));
    }
  }

  const rawBlock = (
    <>
      <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => void toggleRaw()}>
        {raw === null ? `исходная строка (${line.rawLength.toLocaleString("ru-RU")} симв.)` : "скрыть исходную строку"}
      </button>
      {rawError && <div className="text-[11px] text-destructive">{rawError}</div>}
      {raw !== null && <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-2 text-[11px]">{raw}</pre>}
    </>
  );
  const frame = `rounded-lg border p-3 ${highlighted ? "border-accent ring-1 ring-accent" : "border-border"}`;

  if (line.kind === "text" && (line.role === "user" || line.role === "assistant")) {
    return (
      <li data-chat-seq={anchor} className={`${frame} ${line.role === "user" ? "bg-accent/5" : "bg-card"}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{line.role === "user" ? "Вы" : source ? CHAT_ARCHIVE_SOURCE_LABELS[source] : "Агент"}</span>
          {time && <span>{time}</span>}
        </div>
        {line.role === "assistant" ? <MarkdownView source={line.text} /> : <div className="whitespace-pre-wrap break-words text-sm">{line.text}</div>}
        <div className="mt-1">{rawBlock}</div>
      </li>
    );
  }

  const label =
    line.kind === "tool_call" ? "Вызов инструмента" :
    line.kind === "tool_result" ? "Результат инструмента" :
    line.kind === "thinking" ? "Рассуждение" :
    line.role === "system" ? "Инструкции" : "Служебная строка";
  const preview = line.text.split("\n")[0]?.slice(0, 120) ?? "";
  return (
    <li data-chat-seq={anchor} className={`${frame} bg-panel text-xs`}>
      <details>
        <summary className="cursor-pointer select-none text-muted-foreground">
          <span className="font-medium">{label}</span>
          {preview && <span className="ml-2">{preview}</span>}
          {!preview && line.kind === "thinking" && <span className="ml-2">(скрыто источником)</span>}
          {time && <span className="ml-2">{time}</span>}
        </summary>
        {line.text && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px]">{line.text}</pre>}
        <div className="mt-1">{rawBlock}</div>
      </details>
    </li>
  );
}
