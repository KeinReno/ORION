"use client";

import { useCreateListItem, useCreateListItemsBulk } from "@orion/core-react";
import { parseListLine, parseListText, type CreateListItemInput, type ParsedListEntry } from "@orion/shared-types";
import { Button, IconButton, Input, Modal, Textarea, useToast } from "@orion/ui";
import { ClipboardPaste, Plus } from "lucide-react";
import { useState, type ClipboardEvent } from "react";
import { describeError } from "../../lib/error-message";

function toInput(entry: ParsedListEntry, section?: string | null): CreateListItemInput {
  return {
    label: entry.label.slice(0, 500),
    ...(entry.quantity ? { quantity: entry.quantity } : {}),
    ...(entry.unit ? { unit: entry.unit } : {}),
    ...(entry.checked ? { checked: true } : {}),
    ...((entry.section ?? section) ? { section: entry.section ?? section } : {})
  };
}

/**
 * The «add an entry» line. «Молоко, 2 л» becomes an entry with a quantity; pasting several lines (a recipe,
 * a note, a message from the family chat) opens the multi-line dialog instead of dumping them into one entry.
 */
export function ItemAdder({
  workspaceId,
  listId,
  section,
  compact = false,
  autoFocus = false
}: {
  workspaceId: string | undefined;
  listId: string;
  /** New entries land in this group (the group whose «+» was used). */
  section?: string | null;
  compact?: boolean;
  autoFocus?: boolean;
}): React.ReactElement {
  const createItem = useCreateListItem(workspaceId);
  const createBulk = useCreateListItemsBulk(workspaceId);
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const entries = parseListText(bulkText);

  function add(): void {
    const entry = parseListLine(draft);
    if (!entry) return;
    createItem.mutate(
      { listId, input: toInput(entry, section) },
      {
        onSuccess: () => setDraft(""),
        onError: (error) => toast({ title: "Не удалось добавить пункт", description: describeError(error), tone: "danger" })
      }
    );
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    const text = event.clipboardData.getData("text");
    if (!/\r?\n/.test(text.trim())) return;
    event.preventDefault();
    setBulkText(text);
    setBulkOpen(true);
  }

  function addBulk(): void {
    if (entries.length === 0) return;
    createBulk.mutate(
      { listId, input: { items: entries.map((entry) => toInput(entry, section)) } },
      {
        onSuccess: (created) => {
          setBulkOpen(false);
          setBulkText("");
          toast({ title: `Добавлено: ${created.length}`, tone: "success" });
        },
        onError: (error) => toast({ title: "Не удалось добавить пункты", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onPaste={onPaste}
          placeholder={section ? `Добавить в «${section}»` : "Добавить пункт — «Молоко, 2 л»"}
          className={compact ? "h-8 text-xs" : undefined}
          maxLength={500}
        />
        <IconButton label="Добавить пункт" size="sm" onClick={add} disabled={!draft.trim() || createItem.isPending}>
          <Plus className="h-4 w-4" />
        </IconButton>
        {!compact ? (
          <IconButton label="Вставить списком" size="sm" onClick={() => setBulkOpen(true)}>
            <ClipboardPaste className="h-4 w-4" />
          </IconButton>
        ) : null}
      </div>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Вставить списком"
        description="По пункту в строке. «Молоко, 2 л» — с количеством, «# Овощи» — новая группа, «[x]» — уже отмечено."
        footer={
          <>
            <Button variant="subtle" size="sm" onClick={() => setBulkOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" onClick={addBulk} disabled={entries.length === 0 || createBulk.isPending}>
              {entries.length > 0 ? `Добавить (${entries.length})` : "Добавить"}
            </Button>
          </>
        }
      >
        <Textarea autoFocus rows={10} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"Молоко, 2 л\nХлеб\n# Овощи\nМорковь, 1 кг"} />
        {bulkText.trim() && entries.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Нет ни одной строки.</p> : null}
      </Modal>
    </>
  );
}
