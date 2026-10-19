"use client";

import { useAssistantChat, useAssistantKey, useClearAssistantKey, useSaveAssistantKey } from "@orion/core-react";
import { ASSISTANT_DEFAULT_MODEL, type AssistantAction, type AssistantMessage } from "@orion/shared-types";
import { Button, CallChip, Card, EmptyState, Input, LatticeLoader, PanelBody, PanelHeader, PanelSection, PanelShell, Skeleton, StarBorder, Textarea, useToast } from "@orion/ui";
import { Bot, KeyRound, Send, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { describeAuthError } from "../lib/error-message";
import { useActiveWorkspace } from "../lib/use-active-workspace";

interface ChatLine extends AssistantMessage {
  actions?: AssistantAction[];
}

/**
 * Чат-ассистент внутри ORION (ADR-0017, вариант C). Ключ к модели — ваш, хранится зашифрованным на этом узле и сюда не
 * возвращается. Ассистент действует через те же инструменты, что и внешние агенты: изменения существующего он только
 * предлагает, удалять и трогать финансы не может; всё видно в «Настройки → ИИ-агенты».
 */
export function AssistantPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const key = useAssistantKey();
  const chat = useAssistantChat(workspace?.id);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lines, chat.isPending]);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text || chat.isPending || !workspace) return;
    const next: ChatLine[] = [...lines, { role: "user", content: text }];
    setLines(next);
    setDraft("");
    try {
      const result = await chat.mutateAsync({ messages: next.map(({ role, content }) => ({ role, content })) });
      setLines([...next, { role: "assistant", content: result.reply, actions: result.actions }]);
    } catch (error) {
      setLines(next);
      setDraft(text);
      toast({ title: "Ассистент не ответил", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (key.isLoading) {
    return (
      <PanelShell>
        <PanelHeader icon={Bot} title="Ассистент" subtitle="Чат с вашей языковой моделью" />
        <PanelBody measure="settings">
          <Skeleton className="h-40" />
        </PanelBody>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <PanelHeader icon={Bot} title="Ассистент" subtitle="Чат с вашей языковой моделью" />
      <PanelBody measure="settings">
        {key.isError || !key.data ? (
          <EmptyState icon={TriangleAlert} tone="danger" title="Не удалось проверить настройки ассистента" description="Повторите позже." />
        ) : !key.data.available ? (
          <EmptyState icon={KeyRound} title="Ассистент недоступен на этом узле" description={key.data.reason ?? undefined} />
        ) : !key.data.configured ? (
          <KeyForm />
        ) : (
          <div className="flex min-h-[24rem] flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Модель: {key.data.model}. Ваши сообщения и данные, которые ассистент читает по вашей просьбе, уходят провайдеру модели.
              Изменения существующего он только предлагает; удалять и работать с финансами не может.
            </p>
            <div className="flex-1 space-y-3" aria-live="polite">
              {lines.length === 0 ? (
                <EmptyState icon={Bot} title="Спросите что-нибудь" description="Например: «Запомни идею: купить корм коту» или «Что у меня на сегодня?»" />
              ) : (
                lines.map((line, index) => <Line key={index} line={line} />)
              )}
              {chat.isPending ? <LatticeLoader label="Ассистент думает" /> : null}
              <div ref={endRef} />
            </div>
            <StarBorder active={chat.isPending} className="rounded-xl">
            <form onSubmit={(event) => void send(event)} className="flex items-end gap-2 rounded-xl">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) void send(event);
                }}
                placeholder="Сообщение ассистенту (Enter — отправить, Shift+Enter — перенос)"
                aria-label="Сообщение ассистенту"
                rows={2}
                maxLength={8000}
                className="flex-1"
              />
              <Button type="submit" disabled={!draft.trim() || chat.isPending || !workspace} aria-label="Отправить">
                <Send className="h-4 w-4" aria-hidden />
              </Button>
            </form>
            </StarBorder>
            <div className="flex justify-between">
              <Button size="sm" variant="ghost" disabled={lines.length === 0 || chat.isPending} onClick={() => setLines([])}>
                Новая беседа
              </Button>
              <ClearKeyButton />
            </div>
          </div>
        )}
      </PanelBody>
    </PanelShell>
  );
}

function Line({ line }: { line: ChatLine }): React.ReactElement {
  const mine = line.role === "user";
  return (
    <Card className={mine ? "ml-8 space-y-1 py-2" : "mr-8 space-y-1 py-2"}>
      <p className="text-label text-subtle-foreground">{mine ? "Вы" : "Ассистент"}</p>
      <p className="whitespace-pre-wrap text-sm text-foreground">{line.content}</p>
      {line.actions && line.actions.length > 0 ? (
        <div className="grid gap-1.5 pt-1">
          {line.actions.map((action, index) => (
            <CallChip
              key={index}
              className="shadow-none"
              status={action.ok ? "done" : "error"}
              label={action.tool.replace(/^orion_/, "")}
              sublabel={action.summary}
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function KeyForm(): React.ReactElement {
  const save = useSaveAssistantKey();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(ASSISTANT_DEFAULT_MODEL);
  const { toast } = useToast();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await save.mutateAsync({ apiKey, model });
      setApiKey("");
      toast({ title: "Ключ сохранён", description: "Он хранится зашифрованным на этом узле и больше не показывается.", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить ключ", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <PanelSection title="Подключить языковую модель">
      <form onSubmit={(event) => void submit(event)} className="max-w-md space-y-3">
        <p className="text-xs text-muted-foreground">
          Нужен ваш API-ключ Anthropic. ORION хранит его зашифрованным только на этом компьютере и использует лишь для вашего чата.
          Сообщения и данные, которые ассистент читает по вашей просьбе, уходят провайдеру модели.
        </p>
        <label className="block space-y-1 text-sm">
          <span>API-ключ</span>
          <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-ant-…" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Модель</span>
          <Input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <Button type="submit" disabled={apiKey.trim().length < 20 || save.isPending}>
          Сохранить ключ
        </Button>
      </form>
    </PanelSection>
  );
}

function ClearKeyButton(): React.ReactElement {
  const clear = useClearAssistantKey();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={clear.isPending}
      onClick={() =>
        void clear.mutateAsync().then(
          () => toast({ title: "Ключ удалён", tone: "success" }),
          (error) => toast({ title: "Не удалось удалить ключ", description: describeAuthError(error), tone: "danger" })
        )
      }
    >
      Удалить ключ
    </Button>
  );
}
