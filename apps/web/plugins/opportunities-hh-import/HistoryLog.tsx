"use client";
import { useCore } from "@orion/core-react";
import type { HhHistoryQuery } from "@orion/shared-types";
import { Button, Skeleton } from "@orion/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { describeError } from "../../lib/extensions/host-api";

const OUTCOME_LABEL: Record<string, string> = {
  already_exists: "Отклик уже существовал",
  legacy_claimed_verified: "Старый журнал: «проверено» (ORION не подтверждал)",
  failed: "Ошибка в старом журнале",
  unconfirmed: "Не подтверждено"
};

/** Общий журнал исторических откликов: в том числе записи без карточки вакансии. Это сведения старых журналов, не новые отправки. */
export function HistoryLog({ workspaceId: ws }: { workspaceId: string }) {
  const { api } = useCore();
  const [outcome, setOutcome] = useState<NonNullable<HhHistoryQuery["outcome"]> | "">("");
  const [unlinked, setUnlinked] = useState(false);
  const [duplicates, setDuplicates] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["hh-history", ws, outcome, unlinked, duplicates], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listHhHistory(ws, { cursor: pageParam, ...(outcome ? { outcome } : {}), ...(unlinked ? { unlinked: "true" as const } : {}), ...(duplicates ? { duplicates: "true" as const } : {}) }),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = query.data?.pages[0]?.totals;
  const filtered = outcome !== "" || unlinked || duplicates;

  return <section className="space-y-3" aria-label="Журнал исторических откликов">
    <h2 className="font-medium">Исторические отклики</h2>
    <p className="text-xs text-muted-foreground">Сведения из старых журналов HH. «Проверено» в них — утверждение старого журнала: ORION не считает такие записи подтверждёнными отправками и не учитывает их как новые.</p>
    {totals && <p className="text-sm" aria-live="polite">Всего: {totals.all}; без карточки вакансии: {totals.unlinked}; возможных дублей: {totals.possibleDuplicates}.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">Итог
        <select className="ml-2 min-h-10 rounded-lg border border-border bg-background px-3" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
          <option value="">Все</option>{Object.entries(OUTCOME_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unlinked} onChange={(e) => setUnlinked(e.target.checked)} />Без карточки вакансии</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} />Возможные дубли</label>
    </div>
    {query.isLoading && <Skeleton className="h-16" />}
    {query.isError && <div role="alert" className="text-sm text-destructive">{describeError(query.error)} <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Повторить</Button></div>}
    {!query.isLoading && !query.isError && !items.length && <p className="text-sm text-muted-foreground">{filtered ? "По выбранным условиям записей нет. Сбросьте фильтры, чтобы увидеть весь журнал." : "Исторические отклики ещё не импортировались."}</p>}
    <ul className="space-y-2">
      {items.map((item) => <li key={item.id} className="rounded-lg border border-border p-3 text-sm">
        <p className="break-words font-medium">{item.title || item.externalId || "Без названия"}</p>
        <p className="text-muted-foreground">{OUTCOME_LABEL[item.outcome]}{item.originalStatus ? ` · статус в журнале: ${item.originalStatus}` : ""}{item.sourceTime ? ` · ${item.sourceTime}` : ""}</p>
        <p className="break-words text-xs text-muted-foreground">
          {item.opportunityId ? "Связана с карточкой" : "Карточки вакансии нет"}{item.possibleDuplicate ? " · возможный дубль" : ""}{item.profileId ? "" : " · профиль не указан"} · {item.sourcePath}
        </p>
        {item.reason && <p className="break-words text-xs">Причина в журнале: {item.reason}</p>}
      </li>)}
    </ul>
    {query.hasNextPage && <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Показать ещё записи</Button>}
  </section>;
}
