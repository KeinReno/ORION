"use client";

import { ApiError } from "@orion/core";
import { useAgentProposals, useDecideAgentProposal, useDecideAgentProposalsBulk, useRefreshAgentProposal } from "@orion/core-react";
import { AGENT_PROPOSAL_ACTION_LABEL, AGENT_PROPOSAL_STALE_CODE, type AgentProposalDiffEntry } from "@orion/shared-types";
import { Badge, Button, useToast } from "@orion/ui";
import { useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";

/** The 409 "object changed after the request": the diff of the request against the object as it is now. */
function staleDiff(error: unknown): AgentProposalDiffEntry[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.details as { code?: unknown; currentDiff?: unknown } | undefined;
  if (body?.code !== AGENT_PROPOSAL_STALE_CODE) return null;
  return Array.isArray(body.currentDiff) ? (body.currentDiff as AgentProposalDiffEntry[]) : [];
}

function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

export function DiffTable({ diff }: { diff: AgentProposalDiffEntry[] }): React.ReactElement {
  return (
    <table className="w-full table-fixed border-collapse rounded-lg border border-border bg-background text-2xs">
      <tbody>
        {diff.map((d) => (
          <tr key={d.field} className="border-b border-border last:border-0 align-top">
            <th scope="row" className="w-28 px-2 py-1 text-left font-medium text-muted-foreground">{d.label}</th>
            <td className="break-words px-2 py-1 text-danger line-through decoration-danger/50">{d.before ?? "—"}</td>
            <td className="break-words px-2 py-1 text-success">{d.after ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Requests an agent may only PROPOSE (TZ-03): deletions and — in assistant mode — changes to existing objects, each with a
 * before/after preview. Approving runs the change under YOUR rights, once; a request nobody decided lapses after 7 days.
 */
export function AgentProposals({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement | null {
  const { toast } = useToast();
  const proposals = useAgentProposals(workspaceId);
  const decide = useDecideAgentProposal(workspaceId);
  const bulk = useDecideAgentProposalsBulk(workspaceId);
  const refresh = useRefreshAgentProposal(workspaceId);
  const [picked, setPicked] = useState<string[]>([]);
  // Requests whose object changed after they were filed: id → what the request would change NOW.
  const [stale, setStale] = useState<Record<string, AgentProposalDiffEntry[]>>({});

  const pending = (proposals.data ?? []).filter((p) => p.status === "pending");
  const lapsed = (proposals.data ?? []).filter((p) => p.status === "expired");
  if (pending.length === 0 && lapsed.length === 0) return null;

  const toggle = (id: string): void => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const chosen = picked.filter((id) => pending.some((p) => p.id === id));

  function approve(id: string, force: boolean): void {
    decide.mutate(
      { proposalId: id, decision: "approve", force },
      {
        onSuccess: () => setStale((cur) => withoutKey(cur, id)),
        onError: (error) => {
          const diff = staleDiff(error);
          if (diff) setStale((cur) => ({ ...cur, [id]: diff }));
          else toast({ title: "Не удалось выполнить", description: describeError(error), tone: "danger" });
        }
      }
    );
  }

  function recheck(id: string): void {
    refresh.mutate(id, {
      onSuccess: () => setStale((cur) => withoutKey(cur, id)),
      onError: (error) => toast({ title: "Не удалось перепроверить", description: describeError(error), tone: "danger" })
    });
  }

  function run(ids: string[], decision: "approve" | "reject"): void {
    bulk.mutate(
      { ids, decision },
      {
        onSuccess: (result) => {
          const failed = result.results.filter((r) => !r.ok);
          setPicked([]);
          toast({
            title: failed.length === 0 ? "Готово" : `Выполнено ${result.results.length - failed.length} из ${result.results.length}`,
            description: failed[0]?.error ?? undefined,
            tone: failed.length === 0 ? "success" : "danger"
          });
        },
        onError: (error) => toast({ title: "Не удалось выполнить", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <section aria-label="Запросы агентов" className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-label font-medium">Агенты просят подтвердить действие ({pending.length})</h3>
        {pending.length > 1 ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPicked(chosen.length === pending.length ? [] : pending.map((p) => p.id))}>
              {chosen.length === pending.length ? "Снять выбор" : "Выбрать все"}
            </Button>
            <Button size="sm" variant="outline" disabled={chosen.length === 0 || bulk.isPending} onClick={() => run(chosen, "reject")}>
              Отклонить выбранные
            </Button>
            <Button size="sm" disabled={chosen.length === 0 || bulk.isPending} onClick={() => run(chosen, "approve")}>
              Подтвердить выбранные
            </Button>
          </span>
        ) : null}
      </div>
      <ul className="space-y-3">
        {pending.map((p) => (
          <li key={p.id} className="space-y-1 text-label">
            <div className="flex flex-wrap items-center gap-2">
              {pending.length > 1 ? (
                <input type="checkbox" aria-label="Выбрать запрос" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} className="accent-accent" />
              ) : null}
              <span>
                <b>{p.tokenName}</b>: {AGENT_PROPOSAL_ACTION_LABEL[p.action].toLowerCase()} «{p.targetTitle}»
                {p.reason ? <span className="text-muted-foreground"> — {p.reason}</span> : null}
              </span>
              {p.expiresAt ? <span className="text-2xs text-muted-foreground">до {shortDateTime(p.expiresAt)}</span> : null}
              <span className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ proposalId: p.id, decision: "reject" }, { onError: (error) => toast({ title: "Не удалось отклонить", description: describeError(error), tone: "danger" }) })}
                >
                  Отклонить
                </Button>
                <Button size="sm" disabled={decide.isPending || p.id in stale} onClick={() => approve(p.id, false)}>
                  Подтвердить
                </Button>
              </span>
            </div>
            {p.id in stale ? (
              <div role="alert" className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-2">
                <p className="font-medium">Объект изменился после запроса агента.</p>
                <p className="text-2xs text-muted-foreground">
                  {(stale[p.id] ?? []).length > 0
                    ? "Вот что запрос изменит в текущей версии. Проверьте заново (превью обновится) или примените всё равно."
                    : "В текущей версии запрос уже ничего не меняет. Проверьте заново или отклоните."}
                </p>
                {(stale[p.id] ?? []).length > 0 ? <DiffTable diff={stale[p.id] ?? []} /> : null}
                <span className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => recheck(p.id)}>
                    Проверить заново
                  </Button>
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => approve(p.id, true)}>
                    Применить всё равно
                  </Button>
                </span>
              </div>
            ) : p.diff.length > 0 ? (
              <DiffTable diff={p.diff} />
            ) : null}
          </li>
        ))}
      </ul>
      {lapsed.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <Badge>истекли: {lapsed.length}</Badge> срок подтверждения вышел — агент может предложить заново.
          <Button size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => run(lapsed.map((p) => p.id), "reject")}>
            Убрать
          </Button>
        </p>
      ) : null}
    </section>
  );
}
