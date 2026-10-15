"use client";

import { useAgentProposals, useDecideAgentProposal, useDecideAgentProposalsBulk } from "@orion/core-react";
import { AGENT_PROPOSAL_ACTION_LABEL } from "@orion/shared-types";
import { Badge, Button, useToast } from "@orion/ui";
import { useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";

/**
 * Requests an agent may only PROPOSE (TZ-03): deletions and — in assistant mode — changes to existing objects, each with a
 * before/after preview. Approving runs the change under YOUR rights, once; a request nobody decided lapses after 7 days.
 */
export function AgentProposals({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement | null {
  const { toast } = useToast();
  const proposals = useAgentProposals(workspaceId);
  const decide = useDecideAgentProposal(workspaceId);
  const bulk = useDecideAgentProposalsBulk(workspaceId);
  const [picked, setPicked] = useState<string[]>([]);

  const pending = (proposals.data ?? []).filter((p) => p.status === "pending");
  const lapsed = (proposals.data ?? []).filter((p) => p.status === "expired");
  if (pending.length === 0 && lapsed.length === 0) return null;

  const toggle = (id: string): void => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const chosen = picked.filter((id) => pending.some((p) => p.id === id));

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
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ proposalId: p.id, decision: "approve" }, { onError: (error) => toast({ title: "Не удалось выполнить", description: describeError(error), tone: "danger" }) })}
                >
                  Подтвердить
                </Button>
              </span>
            </div>
            {p.diff.length > 0 ? (
              <table className="w-full table-fixed border-collapse rounded-lg border border-border bg-background text-2xs">
                <tbody>
                  {p.diff.map((d) => (
                    <tr key={d.field} className="border-b border-border last:border-0 align-top">
                      <th scope="row" className="w-28 px-2 py-1 text-left font-medium text-muted-foreground">{d.label}</th>
                      <td className="break-words px-2 py-1 text-danger line-through decoration-danger/50">{d.before ?? "—"}</td>
                      <td className="break-words px-2 py-1 text-success">{d.after ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
