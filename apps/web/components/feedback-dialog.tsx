"use client";

import { useCore } from "@orion/core-react";
import type { FeedbackKind } from "@orion/shared-types";
import { Button, IconButton, Modal, SegmentedControl, Textarea, useToast } from "@orion/ui";
import { Bug, Lightbulb, MessageSquareWarning, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { describeAuthError } from "../lib/error-message";
import { dequeueFeedback, enqueueFeedback, loadFeedbackQueue, markFeedbackAttempt, saveFeedbackQueue, type QueuedFeedback } from "../lib/feedback-queue";

const KIND_LABEL: Record<FeedbackKind, string> = { bug: "Баг", idea: "Предложение" };

/**
 * ORION-20: a report used to live only in this component's own state — a failed send (API/БД down,
 * no network) just showed a toast and left the typed text one accidental backdrop-click away from
 * gone, with no way back except retyping it. Now a failed send is saved to a local queue
 * (`feedback-queue.ts`) immediately, so it survives closing the dialog or reloading the app, and the
 * dialog always offers a manual "Отправить снова" for anything still queued, on top of a quiet retry
 * when the dialog opens or the browser comes back online.
 */
export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { api } = useCore();
  const { toast } = useToast();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueuedFeedback[]>([]);
  const flushing = useRef(false);

  useEffect(() => setQueue(loadFeedbackQueue()), []);

  async function attempt(item: Pick<QueuedFeedback, "kind" | "message">): Promise<{ ok: true } | { ok: false; description: string }> {
    try {
      await api.sendFeedback({ kind: item.kind, message: item.message });
      return { ok: true };
    } catch (error) {
      return { ok: false, description: describeAuthError(error) };
    }
  }

  /** Tries every queued report once, quietly — called on open and when the network comes back, never looped or polled. */
  async function flush(current: QueuedFeedback[]): Promise<void> {
    if (flushing.current || current.length === 0) return;
    flushing.current = true;
    let working = current;
    for (const item of current) {
      const result = await attempt(item);
      working = result.ok ? dequeueFeedback(working, item.id) : markFeedbackAttempt(working, item.id, result.description);
      setQueue(working);
      saveFeedbackQueue(working);
    }
    flushing.current = false;
  }

  useEffect(() => {
    if (!open) return;
    const current = loadFeedbackQueue();
    setQueue(current);
    void flush(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const onOnline = () => void flush(loadFeedbackQueue());
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset(): void {
    setMessage("");
    setKind("bug");
  }

  async function send(): Promise<void> {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    const result = await attempt({ kind, message: text });
    if (result.ok) {
      toast({ title: "Отправлено", description: "Спасибо — обращение попало в трекер на GitHub.", tone: "success" });
      reset();
      onClose();
    } else {
      // Saved before the toast: even if the person dismisses the dialog right after reading it, the report is not gone.
      const queued = enqueueFeedback(loadFeedbackQueue(), { id: crypto.randomUUID(), kind, message: text, createdAt: new Date().toISOString() });
      saveFeedbackQueue(queued);
      setQueue(queued);
      reset();
      toast({ title: "Не удалось отправить сейчас", description: `${result.description} Текст сохранён — отправим ещё раз автоматически или по кнопке ниже.`, tone: "danger" });
    }
    setBusy(false);
  }

  async function retryOne(item: QueuedFeedback): Promise<void> {
    const result = await attempt(item);
    const current = loadFeedbackQueue();
    const next = result.ok ? dequeueFeedback(current, item.id) : markFeedbackAttempt(current, item.id, result.description);
    saveFeedbackQueue(next);
    setQueue(next);
    if (result.ok) toast({ title: "Отправлено", description: "Спасибо — обращение попало в трекер на GitHub.", tone: "success" });
    else toast({ title: "Снова не удалось", description: result.description, tone: "danger" });
  }

  function discard(id: string): void {
    const next = dequeueFeedback(loadFeedbackQueue(), id);
    saveFeedbackQueue(next);
    setQueue(next);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Обратная связь"
      description="Нашли баг или есть идея? Напишите — уйдёт в трекер ORION на GitHub."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={() => void send()} disabled={message.trim() === ""} status={busy ? "pending" : "idle"}>
            Отправить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {queue.length > 0 ? (
          <ul className="space-y-2 rounded-lg border border-warning/30 bg-warning/[0.04] p-2">
            {queue.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-label">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{KIND_LABEL[item.kind]}: {item.message}</span>
                  <span className="text-micro text-subtle-foreground">
                    Не отправлено{item.attempts > 0 ? ` · попыток: ${item.attempts}` : ""}
                    {item.lastError ? ` · ${item.lastError}` : ""}
                  </span>
                </span>
                <IconButton label="Отправить снова" size="sm" onClick={() => void retryOne(item)}>
                  <RotateCw className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label="Удалить без отправки" size="sm" onClick={() => discard(item.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        <SegmentedControl
          aria-label="Тип обращения"
          value={kind}
          onChange={setKind}
          options={[
            {
              value: "bug",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Bug className="h-3.5 w-3.5" aria-hidden />
                  Баг
                </span>
              ),
              ariaLabel: "Сообщить о баге"
            },
            {
              value: "idea",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                  Предложение
                </span>
              ),
              ariaLabel: "Предложить идею"
            }
          ]}
        />
        <Textarea
          autoFocus
          rows={6}
          placeholder={kind === "bug" ? "Что произошло? Что вы ожидали увидеть вместо этого?" : "Что предлагаете добавить или изменить?"}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={4000}
        />
      </div>
    </Modal>
  );
}

/** Self-contained launcher — an icon button that owns its own dialog state. Drop it in anywhere. */
export function FeedbackButton({ className }: { className?: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [queued] = useState(() => loadFeedbackQueue().length);
  return (
    <>
      <IconButton
        label={queued > 0 ? `Сообщить о баге или предложить идею — ${queued} не отправлено` : "Сообщить о баге или предложить идею"}
        className={className}
        onClick={() => setOpen(true)}
      >
        <span className="relative">
          <MessageSquareWarning className="h-4 w-4" />
          {queued > 0 ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden /> : null}
        </span>
      </IconButton>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
