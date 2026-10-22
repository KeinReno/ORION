"use client";

import { useCreateAndLink, useUpdateListItem } from "@orion/core-react";
import { type ListItem, type UpdateListItemInput } from "@orion/shared-types";
import { Button, Input, Sheet, Textarea, useToast } from "@orion/ui";
import { ArrowDown, ArrowUp, ListTodo, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fromDateInput, toDateInput } from "../../lib/date-input";
import { describeError } from "../../lib/error-message";
import { fromKopecks, parseMoneyInput } from "../../lib/format";
import { openEntity } from "../../lib/panel-bus";
import { useEnabledModules } from "../../lib/use-enabled-modules";

const UNIT_HINTS = ["шт", "л", "мл", "кг", "г", "уп", "пач", "бут", "пак"];

/**
 * The editor of one entry (opens over the list's tab): text, quantity and unit, group, note, «by when», price.
 * Everything else about an entry — the stock link, the finance mark — is drawn by the plugins that own it.
 * «В задачу» turns the entry into a real task and links it to the list in one server transaction.
 */
export function ItemEditor({
  workspaceId,
  listId,
  item,
  sections,
  canMoveUp,
  canMoveDown,
  onMove,
  onDelete,
  onClose
}: {
  workspaceId: string;
  listId: string;
  item: ListItem | null;
  /** Groups that already exist in the list, offered as suggestions. */
  sections: string[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
}): React.ReactElement {
  const update = useUpdateListItem(workspaceId);
  const createTask = useCreateAndLink(workspaceId);
  const { isEnabled } = useEnabledModules();
  const { toast } = useToast();

  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [section, setSection] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [price, setPrice] = useState("");

  // Re-seed when a different entry is opened — not when the same one is re-read (moving it with ↑↓ touches it
  // on the server, and that must not wipe what is being typed).
  const itemId = item?.id;
  useEffect(() => {
    if (!item) return;
    setLabel(item.label);
    setQuantity(String(item.quantity));
    setUnit(item.unit ?? "");
    setSection(item.section ?? "");
    setNote(item.note);
    setDue(item.dueAt ? toDateInput(item.dueAt) : "");
    setPrice(fromKopecks(item.priceMinor ?? undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const parsedQuantity = Number.parseInt(quantity, 10);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 100_000;
  const parsedPrice = price.trim() === "" ? null : parseMoneyInput(price);
  const priceValid = price.trim() === "" || (parsedPrice !== null && parsedPrice >= 0);
  const valid = label.trim().length > 0 && quantityValid && priceValid;

  function save(): void {
    if (!item || !valid) return;
    const input: UpdateListItemInput = {
      label: label.trim(),
      quantity: parsedQuantity,
      unit: unit.trim() || null,
      section: section.trim() || null,
      note,
      dueAt: due ? fromDateInput(due) : null,
      priceMinor: price.trim() === "" ? null : parsedPrice
    };
    update.mutate(
      { listId, itemId: item.id, input },
      {
        onSuccess: onClose,
        onError: (error) => toast({ title: "Не удалось сохранить пункт", description: describeError(error), tone: "danger" })
      }
    );
  }

  function toTask(): void {
    if (!item) return;
    createTask.mutate(
      {
        targetType: "list",
        targetId: listId,
        kind: "related_to",
        entity: {
          type: "task",
          input: { title: item.label.slice(0, 200), description: item.note, priority: "normal", dueAt: item.dueAt, checklist: [] }
        }
      },
      {
        onSuccess: (result) =>
          toast({
            title: "Задача создана",
            description: "Она связана с этим списком",
            action: { label: "Открыть", onClick: () => openEntity("task", result.entityId) },
            tone: "success"
          }),
        onError: (error) => toast({ title: "Не удалось создать задачу", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title="Пункт списка"
      width="26rem"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Удалить
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={save} disabled={!valid || update.isPending}>
              Сохранить
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Текст</span>
          <Input autoFocus value={label} maxLength={500} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Количество</span>
            <Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} aria-invalid={!quantityValid} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Единица</span>
            <Input value={unit} list="list-units" maxLength={20} placeholder="л, кг, шт…" onChange={(e) => setUnit(e.target.value)} />
            <datalist id="list-units">
              {UNIT_HINTS.map((hint) => (
                <option key={hint} value={hint} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Группа</span>
          <Input value={section} list="list-sections" maxLength={60} placeholder="Например, «Овощи»" onChange={(e) => setSection(e.target.value)} />
          <datalist id="list-sections">
            {sections.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Срок</span>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Цена, ₽</span>
            <Input inputMode="decimal" value={price} placeholder="не указана" onChange={(e) => setPrice(e.target.value)} aria-invalid={!priceValid} />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Заметка</span>
          <Textarea value={note} rows={4} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Марка, магазин, размер…" />
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={() => onMove(-1)} disabled={!canMoveUp}>
            <ArrowUp className="h-3.5 w-3.5" /> Выше
          </Button>
          <Button size="sm" variant="outline" onClick={() => onMove(1)} disabled={!canMoveDown}>
            <ArrowDown className="h-3.5 w-3.5" /> Ниже
          </Button>
          {isEnabled("tasks") ? (
            <Button size="sm" variant="outline" onClick={toTask} disabled={createTask.isPending}>
              <ListTodo className="h-3.5 w-3.5" /> В задачу
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
