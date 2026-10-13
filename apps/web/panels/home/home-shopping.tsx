"use client";

import { useClearCheckedItems, useCreateList, useCreateListItem, useLists, useRefreshHome, useUpdateListItem } from "@orion/core-react";
import { Button, CheckToggle, cx, useToast } from "@orion/ui";
import { ShoppingCart } from "lucide-react";
import { useMemo } from "react";
import { describeError } from "../../lib/error-message";
import { EmptyLine, QuickAdd, SectionCard, type HomeSectionProps } from "./shared";

/** What to buy for the home. The first list of the home takes new lines; the first line creates «Купить» if there is none. */
export function HomeShopping({ workspaceId, home, overview }: HomeSectionProps): React.ReactElement {
  const { toast } = useToast();
  const { data: lists } = useLists(workspaceId);
  const createList = useCreateList(workspaceId);
  const createItem = useCreateListItem(workspaceId);
  const updateItem = useUpdateListItem(workspaceId);
  const clearChecked = useClearCheckedItems(workspaceId);
  const refresh = useRefreshHome(workspaceId);

  const mine = useMemo(() => new Set(overview.listIds), [overview.listIds]);
  const homeLists = useMemo(() => (lists ?? []).filter((l) => mine.has(l.id)), [lists, mine]);
  const toBuy = homeLists.reduce((sum, l) => sum + l.items.filter((i) => !i.checked).length, 0);
  const bought = homeLists.reduce((sum, l) => sum + l.items.filter((i) => i.checked).length, 0);

  async function add(label: string): Promise<void> {
    try {
      let listId = homeLists[0]?.id;
      if (!listId) {
        const created = await createList.mutateAsync({ name: "Купить", homeId: home.id });
        listId = created.id;
        await refresh();
      }
      await createItem.mutateAsync({ listId, input: { label } });
    } catch (error) {
      toast({ title: "Не удалось добавить в список", description: describeError(error), tone: "danger" });
      throw error;
    }
  }

  return (
    <SectionCard title="Купить" icon={ShoppingCart} summary={toBuy ? `в списке: ${toBuy}` : undefined}>
      <QuickAdd placeholder="Что купить, например «молоко»" busy={createItem.isPending || createList.isPending} onAdd={add} />
      {homeLists.length === 0 ? (
        <EmptyLine>Список пока пуст.</EmptyLine>
      ) : (
        homeLists.map((list) => {
          const items = [...list.items].sort((a, b) => Number(a.checked) - Number(b.checked));
          return (
            <div key={list.id} className="space-y-1">
              {homeLists.length > 1 ? <h3 className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{list.name}</h3> : null}
              <ul className="flex flex-col">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5">
                    <CheckToggle
                      checked={item.checked}
                      onClick={() => updateItem.mutate({ listId: list.id, itemId: item.id, input: { checked: !item.checked } })}
                      label={item.checked ? "Вернуть в список" : "Куплено"}
                      size="sm"
                    />
                    <span className={cx("min-w-0 flex-1 truncate text-label", item.checked && "text-subtle-foreground line-through")}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      {bought > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => homeLists.forEach((list) => clearChecked.mutate(list.id, { onError: (error) => toast({ title: "Не удалось очистить", description: describeError(error), tone: "danger" }) }))}
        >
          Убрать купленное ({bought})
        </Button>
      ) : null}
    </SectionCard>
  );
}
