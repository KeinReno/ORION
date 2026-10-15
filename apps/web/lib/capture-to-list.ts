"use client";

import { useCore } from "@orion/core-react";
import { parseListText, type List } from "@orion/shared-types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * `/купить молоко, 2 л` from the quick-capture field: the text goes to the shopping list — the first active
 * list of kind «Покупки», created on first use. Several lines add several entries. Returns the list so the
 * caller can say where it went.
 */
export function useCaptureToList(workspaceId: string | undefined): (text: string) => Promise<{ list: List; added: number }> {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useCallback(
    async (text: string) => {
      if (!workspaceId) throw new Error("Нет рабочего пространства");
      const entries = parseListText(text);
      if (entries.length === 0) throw new Error("Укажите, что добавить в список");
      const lists = await api.listLists(workspaceId);
      const list = lists.find((candidate) => candidate.kind === "shopping") ?? (await api.createList(workspaceId, { name: "Покупки", kind: "shopping" }));
      const added = await api.createListItemsBulk(workspaceId, list.id, {
        items: entries.map((entry) => ({
          label: entry.label.slice(0, 500),
          ...(entry.quantity ? { quantity: entry.quantity } : {}),
          ...(entry.unit ? { unit: entry.unit } : {}),
          ...(entry.section ? { section: entry.section } : {})
        }))
      });
      void queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] });
      return { list, added: added.length };
    },
    [api, queryClient, workspaceId]
  );
}
