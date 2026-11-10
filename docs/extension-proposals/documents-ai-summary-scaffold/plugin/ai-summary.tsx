import React, { useEffect, useState } from "react";
import type { DocumentItem } from "@orion/shared-types";
import { Button, Modal, Skeleton, useToast } from "@orion/ui";

/**
 * Scaffold for EP-DOCUMENTS-ITEM-ACTIONS (docs/extension-proposals/).
 * Compiles against a local structural props type until the typed
 * `documents.item.actions` slot lands in `lib/extensions/contracts.ts`;
 * then this file switches to `SlotContracts["documents.item.actions"]`.
 */
export interface DocumentsItemActionsSlotProps {
  workspaceId: string;
  doc: DocumentItem;
  open: boolean;
  onClose: () => void;
}

type Phase = "idle" | "loading" | "ready" | "error";

const TEXTUAL = /^(text\/|application\/(json|xml|pdf))/;

export function DocumentsAiSummaryAction({ workspaceId, doc, open, onClose }: DocumentsItemActionsSlotProps): React.ReactElement | null {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState<string>("");
  const [problem, setProblem] = useState<string>("");

  const textual = TEXTUAL.test(doc.mimeType ?? "");

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setSummary("");
      setProblem("");
      return;
    }
    if (!textual) {
      setProblem("Этот тип файла пока не поддерживается суммаризацией");
      setPhase("error");
      return;
    }
    setPhase("loading");
    let cancelled = false;
    // TODO(EP-DOCUMENTS-ITEM-ACTIONS): read text via the public
    // DocumentContentReader contract, then POST to
    // `/workspaces/${workspaceId}/assistant/chat` with the fixed
    // summarization instruction (ADR-0017 owner key). No keys here.
    void (async () => {
      try {
        throw new Error("Слот documents.item.actions ещё не подключён — см. extension proposal");
      } catch (e) {
        if (cancelled) return;
        setProblem((e as Error).message);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, textual, workspaceId, doc.id]);

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Суммаризация: ${doc.name}`}>
      {phase === "loading" && <Skeleton />}
      {phase === "error" && <p>{problem}</p>}
      {phase === "ready" && <p>{summary}</p>}
      {phase === "ready" && (
        <Button
          onClick={() => {
            // TODO: create the note through the public Notes API, linked to doc.id.
            toast({ title: "Сохранение появится после утверждения слота", tone: "default" });
          }}
        >
          Сохранить как заметку
        </Button>
      )}
    </Modal>
  );
}
