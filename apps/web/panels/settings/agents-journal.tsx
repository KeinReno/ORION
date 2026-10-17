"use client";

import { useAgentAuditLog, useAgentTokens, useUndoAgentCreation } from "@orion/core-react";
import { AGENT_AUDIT_RESULT_LABEL, AGENT_AUDIT_RESULTS, agentAuditResultOf, toCsv, type AgentAuditQuery, type AgentAuditResult } from "@orion/shared-types";
import { Button, Select, useToast } from "@orion/ui";
import { useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";

const MODULES: Array<[string, string]> = [
  ["tasks", "Задачи"],
  ["notes", "Заметки"],
  ["calendar", "Календарь"],
  ["projects", "Проекты"],
  ["finance", "Финансы"]
];
const PERIODS: Array<[string, string, number | null]> = [
  ["day", "За сутки", 1],
  ["week", "За неделю", 7],
  ["month", "За месяц", 30],
  ["all", "Всё время", null]
];

const TONE: Record<AgentAuditResult, string> = {
  ok: "text-muted-foreground",
  proposed: "text-warning",
  denied: "text-danger",
  limited: "text-danger",
  error: "text-danger"
};

/** What each agent did: a sentence per call, filters, "undo creation" for notes/tasks, CSV export. */
export function AgentJournal({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const tokens = useAgentTokens(workspaceId);
  const undo = useUndoAgentCreation(workspaceId);
  const [tokenId, setTokenId] = useState("");
  const [module, setModule] = useState("");
  const [result, setResult] = useState("");
  const [period, setPeriod] = useState("week");

  const days = PERIODS.find(([id]) => id === period)?.[2] ?? null;
  // The window start is fixed per filter change, not per render, so the query key stays stable.
  const from = useMemo(() => (days === null ? undefined : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 13) + ":00:00.000Z"), [days]);
  const query: AgentAuditQuery = {
    ...(tokenId ? { tokenId } : {}),
    ...(module ? { module } : {}),
    ...(result ? { result: result as AgentAuditResult } : {}),
    ...(from ? { from } : {}),
    limit: 500
  };
  const audit = useAgentAuditLog(workspaceId, query);
  const entries = audit.data ?? [];

  function exportCsv(): void {
    const rows = [
      ["Время", "Агент", "Действие", "Что сделал", "Модуль", "Объект", "Результат", "Код"],
      ...entries.map((e) => [e.createdAt, e.tokenName, e.action, e.summary, e.module, e.resource, AGENT_AUDIT_RESULT_LABEL[agentAuditResultOf(e.status)], e.status])
    ];
    const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agent-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-label font-medium">Журнал действий агентов</h3>
        <Select aria-label="Токен" value={tokenId} onChange={(e) => setTokenId(e.target.value)} className="w-auto">
          <option value="">Все токены</option>
          {(tokens.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Select aria-label="Модуль" value={module} onChange={(e) => setModule(e.target.value)} className="w-auto">
          <option value="">Все модули</option>
          {MODULES.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Select>
        <Select aria-label="Результат" value={result} onChange={(e) => setResult(e.target.value)} className="w-auto">
          <option value="">Любой результат</option>
          {AGENT_AUDIT_RESULTS.map((r) => (
            <option key={r} value={r}>{AGENT_AUDIT_RESULT_LABEL[r]}</option>
          ))}
        </Select>
        <Select aria-label="Период" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-auto">
          {PERIODS.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Select>
        <Button size="sm" variant="outline" className="ml-auto" disabled={entries.length === 0} onClick={exportCsv}>
          Экспорт CSV
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-label text-muted-foreground">Записей по этим условиям нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-label">
          {entries.slice(0, 100).map((entry) => {
            const outcome = agentAuditResultOf(entry.status);
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
                <span className="text-muted-foreground">{shortDateTime(entry.createdAt)}</span>
                <span>{entry.tokenName}</span>
                <span>{entry.summary ?? <code>{entry.action}</code>}</span>
                {entry.undoneAt ? <span className="text-2xs text-muted-foreground">(отменено)</span> : null}
                <span className="ml-auto flex items-center gap-2">
                  {entry.undoable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={undo.isPending}
                      onClick={() =>
                        undo.mutate(entry.id, {
                          onSuccess: () => toast({ title: entry.objectType === "note" ? "Заметка перенесена в корзину" : "Задача отменена", tone: "success" }),
                          onError: (error) => toast({ title: "Не удалось отменить", description: describeError(error), tone: "danger" })
                        })
                      }
                    >
                      Отменить создание
                    </Button>
                  ) : null}
                  <span className={TONE[outcome]}>{AGENT_AUDIT_RESULT_LABEL[outcome]} · {entry.status}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
