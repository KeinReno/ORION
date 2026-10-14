"use client";
import { useCore } from "@orion/core-react";
import { useQuery } from "@tanstack/react-query";
import type { OpportunitiesDetailsSlotProps } from "../../lib/extensions/contracts";
import { describeError } from "../../lib/extensions/host-api";
export function SourcesSection({ workspaceId, opportunity, canManage }: OpportunitiesDetailsSlotProps) {
  const { api } = useCore();
  const query = useQuery({ queryKey: ["hh-sources", workspaceId, opportunity.id], queryFn: () => api.getHhOpportunitySources(workspaceId, opportunity.id), enabled: canManage });
  if (!canManage) return null;
  if (query.isError) return <p role="alert" className="text-sm">Источники: {describeError(query.error)}</p>;
  if (!query.data || (!query.data.captures.length && !query.data.history.length)) return null;
  return <details className="rounded-xl border border-border p-4 text-sm"><summary>Источники HH и исторические записи</summary><p className="py-2 text-muted-foreground">Снимки из файлов могут быть устаревшими. Старые журналы не подтверждают новую отправку. Показано до {query.data.limit} записей каждого вида.</p>
    {query.data.captures.map((c) => <div key={c.id} className="space-y-1 border-t border-border py-2"><p>{c.snapshot.title} · {c.snapshot.company}</p><p className="break-words text-xs text-muted-foreground">{c.sourcePath} · загружен {new Date(c.capturedAt).toLocaleString("ru-RU")}</p><pre className="whitespace-pre-wrap break-words text-sm">{c.snapshot.description}</pre></div>)}
    {query.data.history.map((h) => <div key={h.id} className="border-t border-border py-2"><p>{({ already_exists: "Ранее уже откликались — по старому журналу", legacy_claimed_verified: "Старый журнал заявляет verified", failed: "Ошибка — по старому журналу", unconfirmed: "Неподтверждённая запись" })[h.outcome]}{h.possibleDuplicate ? " · Возможный дубль" : ""}</p><p className="text-xs text-muted-foreground">{h.sourceTime || "Дата в источнике не указана"} · {h.sourcePath} · {h.reason}</p></div>)}
  </details>;
}
