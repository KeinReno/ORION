"use client";

import { useAddInventoryToList, useLists } from "@orion/core-react";
import { Button, Input, Modal, Select, useToast } from "@orion/ui";
import { ListPlus } from "lucide-react";
import { useState } from "react";
import { restockQuantity } from "@orion/shared-types";
import type { InventoryItemActionsSlotProps } from "../../lib/extensions/contracts";
import { describeError } from "../../lib/extensions/host-api";

/**
 * Plugin «Покупки → Склад», the Inventory side: «В список покупок» in a stock
 * item's window. The suggested quantity brings the balance back above the
 * low-stock threshold; an entry already open in that list is reused, not doubled.
 */
export function AddToShoppingList({ workspaceId, item }: InventoryItemActionsSlotProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListPlus className="h-4 w-4" aria-hidden />
        В список покупок
      </Button>
      {open ? <ToListDialog workspaceId={workspaceId} item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ToListDialog({ workspaceId, item, onClose }: InventoryItemActionsSlotProps & { onClose: () => void }): React.ReactElement {
  const lists = useLists(workspaceId);
  const add = useAddInventoryToList(workspaceId);
  const { toast } = useToast();
  const active = (lists.data ?? []).filter((list) => !list.archivedAt);
  const [listId, setListId] = useState("");
  const chosen = listId || active[0]?.id || "";
  const [quantity, setQuantity] = useState(String(restockQuantity(item.balance, item.minStock)));
  const parsed = Number.parseInt(quantity, 10);
  const quantityValid = Number.isInteger(parsed) && parsed > 0;

  function submit(): void {
    const listName = active.find((list) => list.id === chosen)?.name ?? "список";
    add.mutate(
      { inventoryItemId: item.id, input: { listId: chosen, quantity: parsed } },
      {
        onSuccess: (entry) => {
          toast({ title: `В «${listName}»: ${entry.label} ×${entry.quantity}`, tone: "success" });
          onClose();
        },
        onError: (error) => toast({ title: "Не удалось добавить в список", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="В список покупок"
      description={`«${item.name}»: остаток ${item.balance} ${item.unit}. Когда пункт отметят «Куплено», приход запишется на склад.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!chosen || !quantityValid || add.isPending}>
            Добавить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Список
          <Select value={chosen} onChange={(event) => setListId(event.target.value)} disabled={lists.isLoading || active.length === 0}>
            {active.length === 0 ? <option value="">{lists.isLoading ? "Загрузка…" : "Сначала создайте список в «Списках»"}</option> : null}
            {active.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          {`Сколько купить, ${item.unit}`}
          <Input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-invalid={!quantityValid} />
        </label>
      </div>
    </Modal>
  );
}
