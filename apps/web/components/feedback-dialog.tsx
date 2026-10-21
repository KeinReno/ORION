"use client";

import { useCore } from "@orion/core-react";
import type { FeedbackKind } from "@orion/shared-types";
import { Button, IconButton, Modal, SegmentedControl, Textarea, useToast } from "@orion/ui";
import { Bug, Lightbulb, MessageSquareWarning } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../lib/error-message";

/**
 * Один чат-пузырёк для бага/предложения: пишешь текст, жмёшь «Отправить» — летит issue'ем в
 * GitHub ORION (см. `FeedbackService` на сервере), владелец разбирает их там. Ничего не
 * сохраняется и не синхронизируется внутри самого ORION.
 */
export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { api } = useCore();
  const { toast } = useToast();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function reset(): void {
    setMessage("");
    setKind("bug");
  }

  async function send(): Promise<void> {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.sendFeedback({ kind, message: text });
      toast({ title: "Отправлено", description: "Спасибо — обращение попало в трекер на GitHub.", tone: "success" });
      reset();
      onClose();
    } catch (error) {
      toast({ title: "Не удалось отправить", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusy(false);
    }
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
  return (
    <>
      <IconButton label="Сообщить о баге или предложить идею" className={className} onClick={() => setOpen(true)}>
        <MessageSquareWarning className="h-4 w-4" />
      </IconButton>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
