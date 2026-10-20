"use client";

import {
  useAgentProposals,
  useAssistantConversation,
  useAssistantConversations,
  useAssistantKey,
  useDecideAgentProposal,
  useDeleteAssistantConversation,
  useSendToAssistant
} from "@orion/core-react";
import { AGENT_PROPOSAL_ACTION_LABEL, type AssistantStoredMessage } from "@orion/shared-types";
import { Button, CallChip, Card, EmptyState, IconButton, LatticeLoader, MarkdownView, PanelBody, PanelHeader, PanelSection, PanelShell, Skeleton, StarBorder, Textarea, cx, useToast } from "@orion/ui";
import { Bot, KeyRound, MessageSquarePlus, Send, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { describePresence, useAgentPresenceNow } from "../lib/agent-presence";
import { currentAssistantView, describeAssistantView } from "../lib/assistant-context";
import { describeAuthError } from "../lib/error-message";
import { relativeTime } from "../lib/format";
import { openInBrowser, openSettings, useAssistantRequest } from "../lib/panel-bus";
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

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text || send.isPending || !workspaceId) return;
    const screen = useScreen ? currentAssistantView() : null;
    setPending(text);
    setDraft("");
    try {
      const result = await send.mutateAsync({ conversationId: openId, message: text, context: screen });
      choose(result.conversationId);
    } catch (error) {
      setDraft(text);
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

          <section className="flex min-w-0 flex-col gap-3" aria-label="Беседа">
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
            <StarBorder active={send.isPending} className="rounded-xl">
              <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2 rounded-xl">
                <Textarea
                  id={COMPOSER_ID}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={() => setView(currentAssistantView())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) void submit(event);
                  }}
                  placeholder="Сообщение ассистенту (Enter — отправить, Shift+Enter — перенос)"
                  aria-label="Сообщение ассистенту"
                  rows={2}
                  maxLength={8000}
                  className="flex-1"
                />
                <Button type="submit" disabled={!draft.trim() || send.isPending || !workspaceId} aria-label="Отправить">
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
        <p className="whitespace-pre-wrap text-sm text-foreground">{message.content}</p>
      ) : (
        <MarkdownView source={message.content} className="text-sm" onExternalLink={openInBrowser} />
      )}
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
