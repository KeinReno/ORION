"use client";

import { useInventoryItems, useLinkListItemInventory } from "@orion/core-react";
import type { ListItem } from "@orion/shared-types";
import { Button, IconButton, Input, Modal, Select, cx, useToast } from "@orion/ui";
import { Boxes } from "lucide-react";
import { useState } from "react";
import type { ListsItemApi } from "../../lib/extensions/contracts";
import { describeError, useEnabledModules } from "../../lib/extensions/host-api";

/**
 * Plugin «Покупки → Склад» (lists-inventory), the Lists side (ADR-0009).
 *
 * `ItemExtra` marks an entry linked to a stock item («×3 · на складе») and opens
 * the link dialog; `completeItem` turns ticking a linked entry into «Куплено»,
 * which writes the stock receipt once on the server. With the plugin or the
 * Inventory module off the host ticks entries exactly as before and stored
 * links stay untouched.
 */
export const listsItemApi: ListsItemApi = {
  ItemExtra,
  completeItem({ api, queryClient, workspaceId, listId, item, isModuleEnabled }) {
    if (!item.inventoryItemId || !isModuleEnabled("inventory")) return null;
    return (async () => {
      await api.purchaseListItem(workspaceId, listId, item.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-items", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] })
      ]);
    })();
  }
};

function ItemExtra({ workspaceId, listId, item }: { workspaceId: string; listId: string; item: ListItem }): React.ReactElement | null {
  const { isEnabled } = useEnabledModules();
  const [open, setOpen] = useState(false);
  if (!isEnabled("inventory")) return null;

  return (
    <>
      {item.inventoryItemId ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={item.stocked ? "Связано со складом — приход уже записан" : "Связано со складом — «Куплено» запишет приход"}
          className={cx(
            "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-micro hover:bg-white/5",
            item.stocked ? "text-success" : "text-muted-foreground"
          )}
        >
          <Boxes className="h-3 w-3" aria-hidden />
          {`×${item.quantity}`}
          {item.stocked ? " · на складе" : null}
        </button>
      ) : (
        <IconButton
          label="Связать со складом"
          size="sm"
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100"
          onClick={() => setOpen(true)}
        >
          <Boxes className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {open ? <LinkDialog workspaceId={workspaceId} listId={listId} item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function LinkDialog({
  workspaceId,
  listId,
  item,
  onClose
}: {
  workspaceId: string;
  listId: string;
  item: ListItem;
  onClose: () => void;
}): React.ReactElement {
  const stock = useInventoryItems(workspaceId);
  const link = useLinkListItemInventory(workspaceId);
  const { toast } = useToast();
  const [inventoryItemId, setInventoryItemId] = useState(item.inventoryItemId ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const items = (stock.data ?? []).filter((candidate) => !candidate.archivedAt || candidate.id === item.inventoryItemId);
  const parsed = Number.parseInt(quantity, 10);
  const quantityValid = Number.isInteger(parsed) && parsed > 0;

  function save(nextId: string | null): void {
    link.mutate(
      { listId, itemId: item.id, input: { inventoryItemId: nextId, ...(nextId ? { quantity: parsed } : {}) } },
      {
        onSuccess: () => {
          toast({ title: nextId ? "Пункт связан со складом" : "Связь со складом снята", tone: "success" });
          onClose();
        },
        onError: (error) => toast({ title: "Не удалось сохранить связь", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Связь со складом"
      description={`«${item.label}»: при отметке «Куплено» на склад запишется приход — один раз, повторная отметка его не дублирует.`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {item.inventoryItemId ? (
            <Button variant="ghost" onClick={() => save(null)} disabled={link.isPending}>
              Отвязать
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={() => save(inventoryItemId)} disabled={!inventoryItemId || !quantityValid || link.isPending}>
              Сохранить
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Позиция склада
          <Select value={inventoryItemId} onChange={(event) => setInventoryItemId(event.target.value)} disabled={stock.isLoading}>
            <option value="">{stock.isLoading ? "Загрузка…" : items.length ? "Выберите позицию" : "На складе пока нет позиций"}</option>
            {items.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {`${candidate.name} — остаток ${candidate.balance} ${candidate.unit}`}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Сколько добавить на склад при покупке
          <Input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-invalid={!quantityValid} />
        </label>
        {item.stocked ? <p className="text-2xs text-muted-foreground">Приход по этому пункту уже записан; изменение количества его не пересчитывает.</p> : null}
      </div>
    </Modal>
  );
}
