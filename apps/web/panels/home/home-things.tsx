"use client";

import { useAttachToHome, useCreateInventoryItem, useInventoryItems, useRecordInventoryMovement, useRefreshHome } from "@orion/core-react";
import { Badge, IconButton, useToast } from "@orion/ui";
import { Boxes, Minus, Plus } from "lucide-react";
import { useMemo } from "react";
import { describeError } from "../../lib/error-message";
import { AttachPicker, EmptyLine, QuickAdd, SectionCard, type HomeSectionProps } from "./shared";

/** Things and supplies of the home, from «Склад»: what there is and how much is left. */
export function HomeThings({ workspaceId, home, overview }: HomeSectionProps): React.ReactElement {
  const { toast } = useToast();
  const { data: items } = useInventoryItems(workspaceId);
  const createItem = useCreateInventoryItem(workspaceId);
  const record = useRecordInventoryMovement(workspaceId);
  const refresh = useRefreshHome(workspaceId);
  const attach = useAttachToHome(workspaceId);

  const mine = useMemo(() => new Set(overview.inventoryIds), [overview.inventoryIds]);
  const rows = useMemo(() => (items ?? []).filter((i) => mine.has(i.id)).sort((a, b) => a.name.localeCompare(b.name, "ru")), [items, mine]);
  const elsewhere = useMemo(() => new Set(overview.elsewhere.inventoryIds), [overview.elsewhere.inventoryIds]);
  const attachable = useMemo(
    () => (items ?? []).filter((i) => !mine.has(i.id) && !elsewhere.has(i.id) && !i.archivedAt).map((i) => ({ id: i.id, label: i.name })),
    [items, mine, elsewhere]
  );
  const low = rows.filter((i) => i.lowStock).length;

  async function add(name: string): Promise<void> {
    try {
      await createItem.mutateAsync({ name, unit: "шт", homeId: home.id });
      await refresh();
    } catch (error) {
      toast({ title: "Не удалось добавить вещь", description: describeError(error), tone: "danger" });
      throw error;
    }
  }

  function move(itemId: string, type: "receipt" | "issue"): void {
    record.mutate(
      { itemId, input: { type, quantity: 1, direction: "+", note: "", unitCostMinor: null } },
      { onError: (error) => toast({ title: type === "issue" ? "Нельзя списать больше, чем есть" : "Не удалось записать", description: describeError(error), tone: "danger" }) }
    );
  }

  return (
    <SectionCard title="Вещи и запасы" icon={Boxes} summary={low ? `заканчивается: ${low}` : undefined}>
      <QuickAdd placeholder="Вещь или запас, например «стиральный порошок»" busy={createItem.isPending} onAdd={add} />
      <AttachPicker label="Привязать вещь со склада" options={attachable} busy={attach.isPending} onPick={(id) => attach.mutate({ homeId: home.id, input: { type: "inventory", id }, attach: true })} />
      {rows.length === 0 ? (
        <EmptyLine>Вещей пока нет.</EmptyLine>
      ) : (
        <ul className="flex flex-col">
          {rows.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5">
              <span className="min-w-0 flex-1 truncate text-label">{item.name}</span>
              {item.lowStock ? <Badge tone="warning">мало</Badge> : null}
              <IconButton label="Взять 1" size="sm" onClick={() => move(item.id, "issue")} disabled={item.balance <= 0}>
                <Minus className="h-3.5 w-3.5" />
              </IconButton>
              <span className="w-14 text-center font-mono text-label tabular-nums">
                {item.balance} {item.unit}
              </span>
              <IconButton label="Добавить 1" size="sm" onClick={() => move(item.id, "receipt")}>
                <Plus className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
