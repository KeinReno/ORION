"use client";

import {
  useAgentProposals,
  useAssistantConversation,
  useAssistantConversations,
  useAssistantKey,
  useDecideAgentProposal,
  useDeleteAssistantConversation,
  useSendToAssistant,
  useUploadToAssistant
} from "@orion/core-react";
import { AGENT_PROPOSAL_ACTION_LABEL, type AssistantAttachmentInput, type AssistantStoredMessage } from "@orion/shared-types";
import { Button, CallChip, Card, EmptyState, IconButton, LatticeLoader, MarkdownView, PanelBody, PanelHeader, PanelSection, PanelShell, Skeleton, StarBorder, Textarea, cx, useToast } from "@orion/ui";
import { Bot, FileText, KeyRound, Loader2, MessageSquarePlus, Paperclip, Send, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { describePresence, useAgentPresenceNow } from "../lib/agent-presence";
import { attachmentFor, fitImages, imageForModel } from "../lib/assistant-attachments";
import { currentAssistantView, describeAssistantView } from "../lib/assistant-context";
import { describeAuthError } from "../lib/error-message";
import { relativeTime } from "../lib/format";
import { openEntity, openInBrowser, openSettings, useAssistantRequest } from "../lib/panel-bus";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { AssistantKeyForm } from "./assistant-key";
import { DiffTable } from "./settings/agents-proposals";

const OPEN_CONVERSATION_KEY = "orion.assistant.conversation";
const COMPOSER_ID = "assistant-composer";

function rememberedConversation(workspaceId: string | undefined): string | null {
  if (!workspaceId) return null;
  try {
    return localStorage.getItem(`${OPEN_CONVERSATION_KEY}.${workspaceId}`);
  } catch {
    return null;
  }
}

function rememberConversation(workspaceId: string | undefined, id: string | null): void {
  if (!workspaceId) return;
  try {
    if (id) localStorage.setItem(`${OPEN_CONVERSATION_KEY}.${workspaceId}`, id);
    else localStorage.removeItem(`${OPEN_CONVERSATION_KEY}.${workspaceId}`);
  } catch {
    /* a remembered conversation is a convenience only */
  }
}

/**
 * Чат-ассистент внутри ORION (ADR-0017, вариант C). Ключ к модели — ваш, хранится зашифрованным на этом узле и сюда не
 * возвращается. Беседы сохраняются на сервере (личные, в этом пространстве); с каждым сообщением уходит, что было на экране
 * («эта задача»). Ассистент действует через те же инструменты, что и внешние агенты: изменения существующего он только
 * предлагает — подтвердить можно прямо в ответе; удалять и трогать финансы не может; всё видно в «Настройки → ИИ и агенты».
 */
export function AssistantPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const key = useAssistantKey();
  const conversations = useAssistantConversations(key.data?.configured ? workspaceId : undefined);
  const [openId, setOpenId] = useState<string | null>(() => rememberedConversation(workspaceId));
  const conversation = useAssistantConversation(workspaceId, openId);
  const send = useSendToAssistant(workspaceId);
  const remove = useDeleteAssistantConversation(workspaceId);
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Files attached to the next message: already saved in «Ассистент — входящие» (uploaded when picked). */
  const [attached, setAttached] = useState<AssistantAttachmentInput[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const upload = useUploadToAssistant(workspaceId);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const documentsOn = useEnabledModules().isEnabled("documents");
  const [useScreen, setUseScreen] = useState(true);
  const [view, setView] = useState(currentAssistantView);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();
  const request = useAssistantRequest();
  const { agents } = useAgentPresenceNow();
  const working = agents.find((event) => event.assistant);

  // «Спросить ассистента» from Ctrl+K: the question lands in the composer of a new conversation.
  useEffect(() => {
    if (!request) return;
    setOpenId(null);
    setDraft(request.text);
    document.getElementById(COMPOSER_ID)?.focus();
  }, [request]);

  // A conversation from another workspace is not ours to show.
  useEffect(() => {
    if (conversation.isError) setOpenId(null);
  }, [conversation.isError]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [conversation.data?.messages.length, pending, send.isPending]);

  function choose(id: string | null): void {
    setOpenId(id);
    rememberConversation(workspaceId, id);
  }

  /** Picked, dropped or pasted files: saved right away (so a send never waits on an upload), pictures downsized for the model. */
  async function attach(files: File[]): Promise<void> {
    if (files.length === 0 || !workspaceId || !documentsOn) return;
    setUploading((count) => count + files.length);
    try {
      const [documents, images] = await Promise.all([upload.mutateAsync(files), Promise.all(files.map((file) => imageForModel(file)))]);
      setAttached((current) => [...current, ...documents.map((document, index) => attachmentFor(document, images[index] ?? null))]);
    } catch (error) {
      toast({ title: "Не удалось прикрепить файл", description: describeAuthError(error), tone: "danger" });
    } finally {
      setUploading((count) => count - files.length);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && attached.length === 0) || send.isPending || uploading > 0 || !workspaceId) return;
    const screen = useScreen ? currentAssistantView() : null;
    const files = attached;
    setPending(text || files.map((item) => item.name).join(", "));
    setDraft("");
    setAttached([]);
    try {
      const result = await send.mutateAsync({ conversationId: openId, message: text, context: screen, attachments: fitImages(files) });
      choose(result.conversationId);
    } catch (error) {
      setDraft(text);
      setAttached(files);
      toast({ title: "Ассистент не ответил", description: describeAuthError(error), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  const header = <PanelHeader icon={Bot} title="Ассистент" subtitle="Чат с вашей языковой моделью" />;
  if (key.isLoading) {
    return (
      <PanelShell>
        {header}
        <PanelBody measure="wide">
          <Skeleton className="h-40" />
        </PanelBody>
      </PanelShell>
    );
  }
  if (key.isError || !key.data || !key.data.available || !key.data.configured) {
    return (
      <PanelShell>
        {header}
        <PanelBody measure="settings">
          {key.isError || !key.data ? (
            <EmptyState icon={TriangleAlert} tone="danger" title="Не удалось проверить настройки ассистента" description="Повторите позже." />
          ) : !key.data.available ? (
            <EmptyState icon={KeyRound} title="Ассистент недоступен на этом узле" description={key.data.reason ?? undefined} />
          ) : (
            <PanelSection title="Подключить языковую модель">
              <AssistantKeyForm />
            </PanelSection>
          )}
        </PanelBody>
      </PanelShell>
    );
  }

  const messages = openId ? conversation.data?.messages ?? [] : [];
  const screenLabel = describeAssistantView(view);

  return (
    <PanelShell>
      {header}
      <PanelBody measure="wide">
        <div className="grid min-h-[28rem] gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="space-y-2" aria-label="Беседы">
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => choose(null)}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden /> Новая беседа
            </Button>
            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {(conversations.data ?? []).map((item) => (
                <li key={item.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => choose(item.id)}
                    aria-current={item.id === openId ? "true" : undefined}
                    className={cx(
                      "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-card-hover",
                      item.id === openId ? "bg-card-hover text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <span className="block truncate text-label">{item.title}</span>
                    <span className="block text-2xs text-subtle-foreground">{relativeTime(item.updatedAt)}</span>
                  </button>
                  <IconButton
                    label={`Удалить беседу «${item.title}»`}
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(item.id, {
                        onSuccess: () => {
                          if (item.id === openId) choose(null);
                        },
                        onError: (error) => toast({ title: "Не удалось удалить беседу", description: describeAuthError(error), tone: "danger" })
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </aside>

          <section
            className={cx("flex min-w-0 flex-col gap-3 rounded-xl", dragOver && "outline outline-2 outline-dashed outline-accent/60")}
            aria-label="Беседа"
            onDragOver={(event) => {
              if (!documentsOn || !event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              if (!documentsOn || event.dataTransfer.files.length === 0) return;
              event.preventDefault();
              setDragOver(false);
              void attach([...event.dataTransfer.files]);
            }}
          >
            <div className="flex-1 space-y-3" aria-live="polite">
              {messages.length === 0 && !pending ? (
                <EmptyState
                  icon={Bot}
                  title="Спросите что-нибудь"
                  description="Например: «Что у меня горит на этой неделе?», «Разбей эту задачу на шаги» или «Сделай заметку по итогам встречи»."
                />
              ) : (
                messages.map((message, index) => <Line key={`${message.at}-${index}`} message={message} workspaceId={workspaceId} />)
              )}
              {pending ? <Line message={{ role: "user", content: pending, actions: [], at: "", truncated: false }} workspaceId={workspaceId} /> : null}
              {send.isPending ? <LatticeLoader label={working ? `Ассистент ${describePresence(working)}` : "Ассистент думает"} /> : null}
              <div ref={endRef} />
            </div>
            {attached.length > 0 || uploading > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Прикреплённые файлы">
                {attached.map((item) => (
                  <li key={item.documentId} className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-foreground">
                    <FileText className="h-3 w-3 text-muted-foreground" aria-hidden />
                    <span className="max-w-[14rem] truncate">{item.name}</span>
                    <IconButton label={`Убрать «${item.name}» из сообщения`} size="sm" onClick={() => setAttached((current) => current.filter((entry) => entry.documentId !== item.documentId))}>
                      <X className="h-3 w-3" />
                    </IconButton>
                  </li>
                ))}
                {uploading > 0 ? (
                  <li className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Сохраняю файл…
                  </li>
                ) : null}
              </ul>
            ) : null}
            <StarBorder active={send.isPending} className="rounded-xl">
              <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2 rounded-xl">
                {documentsOn ? (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      hidden
                      aria-label="Файлы для ассистента"
                      onChange={(event) => {
                        void attach([...(event.target.files ?? [])]);
                        event.target.value = "";
                      }}
                    />
                    <IconButton label="Прикрепить файл" onClick={() => fileInput.current?.click()} disabled={!workspaceId}>
                      <Paperclip className="h-4 w-4" />
                    </IconButton>
                  </>
                ) : null}
                <Textarea
                  id={COMPOSER_ID}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={() => setView(currentAssistantView())}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.files];
                    if (files.length > 0 && documentsOn) {
                      event.preventDefault();
                      void attach(files);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) void submit(event);
                  }}
                  placeholder={documentsOn ? "Сообщение или файл — перетащите, вставьте или нажмите скрепку (Enter — отправить)" : "Сообщение ассистенту (Enter — отправить, Shift+Enter — перенос)"}
                  aria-label="Сообщение ассистенту"
                  rows={2}
                  maxLength={8000}
                  className="flex-1"
                />
                <Button type="submit" disabled={(!draft.trim() && attached.length === 0) || uploading > 0 || send.isPending || !workspaceId} aria-label="Отправить">
                  <Send className="h-4 w-4" aria-hidden />
                </Button>
              </form>
            </StarBorder>
            <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-subtle-foreground">
              {screenLabel ? (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" className="accent-accent" checked={useScreen} onChange={(event) => setUseScreen(event.target.checked)} />
                  Учитывать открытое: {screenLabel}
                </label>
              ) : (
                <span>Откройте раздел или запись — ассистент поймёт, о чём «это».</span>
              )}
              <span className="flex items-center gap-2">
                Модель: {key.data.model} ·
                <Button size="sm" variant="ghost" onClick={() => openSettings("agents", "agents")}>
                  Настройки ИИ
                </Button>
              </span>
            </div>
          </section>
        </div>
      </PanelBody>
    </PanelShell>
  );
}

function Line({ message, workspaceId }: { message: AssistantStoredMessage; workspaceId: string | undefined }): React.ReactElement {
  const mine = message.role === "user";
  return (
    <Card className={mine ? "ml-8 space-y-1 py-2" : "mr-8 space-y-1 py-2"}>
      <p className="text-label text-subtle-foreground">{mine ? "Вы" : "Ассистент"}</p>
      {mine ? (
        message.content ? <p className="whitespace-pre-wrap text-sm text-foreground">{message.content}</p> : null
      ) : (
        <MarkdownView source={message.content} className="text-sm" onExternalLink={openInBrowser} />
      )}
      {message.attachments && message.attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {message.attachments.map((item) => (
            <li key={item.documentId}>
              <button
                type="button"
                onClick={() => openEntity("document", item.documentId, item.name)}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-foreground hover:bg-card-hover"
                title="Открыть в «Документах»"
              >
                <FileText className="h-3 w-3 text-muted-foreground" aria-hidden />
                <span className="max-w-[14rem] truncate">{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message.truncated ? <p className="text-2xs text-warning">Ответ обрезан по длине — напишите «продолжи».</p> : null}
      {message.actions.length > 0 ? (
        <div className="grid gap-1.5 pt-1">
          {message.actions.map((action, index) => (
            <CallChip
              key={index}
              className="shadow-none"
              status={action.ok ? "done" : "error"}
              label={action.tool.replace(/^orion_/, "")}
              sublabel={action.summary}
            />
          ))}
          {message.actions.flatMap((action) => (action.proposalId ? [<ProposalDecision key={action.proposalId} workspaceId={workspaceId} proposalId={action.proposalId} />] : []))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * A change the assistant may only propose (edit of an existing note/task): the before/after and «Применить / Отклонить»
 * right in its answer, instead of a trip to Settings → ИИ и агенты. Decided elsewhere — shows the outcome.
 */
function ProposalDecision({ workspaceId, proposalId }: { workspaceId: string | undefined; proposalId: string }): React.ReactElement | null {
  const proposals = useAgentProposals(workspaceId);
  const decide = useDecideAgentProposal(workspaceId);
  const { toast } = useToast();
  const proposal = proposals.data?.find((item) => item.id === proposalId);
  if (!proposal) return proposals.isLoading ? null : <p className="text-2xs text-subtle-foreground">Запрос на изменение уже обработан.</p>;
  const label = `${AGENT_PROPOSAL_ACTION_LABEL[proposal.action]} «${proposal.targetTitle}»`;
  if (proposal.status !== "pending") {
    const outcome = proposal.status === "approved" ? "применено" : proposal.status === "rejected" ? "отклонено" : "срок подтверждения истёк";
    return <p className="text-2xs text-subtle-foreground">{label}: {outcome}.</p>;
  }
  function run(decision: "approve" | "reject"): void {
    decide.mutate(
      { proposalId, decision },
      {
        onSuccess: () => toast({ title: decision === "approve" ? "Изменение применено" : "Изменение отклонено", tone: "success" }),
        onError: (error) => toast({ title: "Не удалось", description: describeAuthError(error), tone: "danger" })
      }
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/[0.06] p-2" role="group" aria-label={`Подтверждение: ${label}`}>
      <p className="text-label font-medium text-foreground">Нужно ваше подтверждение: {label}</p>
      {proposal.diff.length > 0 ? <DiffTable diff={proposal.diff} /> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={decide.isPending} onClick={() => run("approve")}>
          Применить
        </Button>
        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => run("reject")}>
          Отклонить
        </Button>
      </div>
    </div>
  );
}
