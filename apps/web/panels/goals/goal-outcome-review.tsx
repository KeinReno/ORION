"use client";

import { useUpdateProjectGoal } from "@orion/core-react";
import type { Goal, GoalCriterion } from "@orion/shared-types";
import { Button, Input, Textarea, useToast } from "@orion/ui";
import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";

export function GoalOutcomeReview({ workspaceId, goal }: { workspaceId: string | undefined; goal: Goal }): React.ReactElement {
  const { toast } = useToast();
  const update = useUpdateProjectGoal(workspaceId);
  const [criterion, setCriterion] = useState("");
  const [wins, setWins] = useState(goal.lastReview?.wins ?? "");
  const [blockers, setBlockers] = useState(goal.lastReview?.blockers ?? "");
  const [next, setNext] = useState(goal.lastReview?.next ?? goal.plans.map((plan) => plan.nextTask?.title).find(Boolean) ?? "");

  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });
  const saveCriteria = (successCriteria: GoalCriterion[]): void => {
    update.mutate({ goalId: goal.id, input: { successCriteria } }, { onError: fail("Не удалось сохранить признаки результата") });
  };
  const met = goal.successCriteria.filter((item) => item.met).length;

  function addCriterion(event: FormEvent): void {
    event.preventDefault();
    const text = criterion.trim();
    if (!text || goal.successCriteria.length >= 12 || update.isPending) return;
    update.mutate({ goalId: goal.id, input: { successCriteria: [...goal.successCriteria, { id: crypto.randomUUID(), text, met: false }] } }, {
      onSuccess: () => setCriterion(""),
      onError: fail("Не удалось добавить признак результата")
    });
  }

  function saveReview(event: FormEvent): void {
    event.preventDefault();
    update.mutate({ goalId: goal.id, input: { review: { wins: wins.trim(), blockers: blockers.trim(), next: next.trim() } } }, { onError: fail("Не удалось записать обзор цели") });
  }

  return <div className="space-y-4 border-t border-border pt-3">
    <section className="space-y-2" aria-label="Признаки достижения цели">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-label font-medium">Как поймём, что получилось</h3>
        <span className="text-2xs text-subtle-foreground">{met}/{goal.successCriteria.length}</span>
      </div>
      <p className="text-2xs text-subtle-foreground">Признаки результата отмечаются вручную; процент плана считается по задачам отдельно.</p>
      {goal.successCriteria.map((item) => <div key={item.id} className="flex items-start gap-2 rounded-md border border-border/70 px-2 py-1.5">
        <label className="flex min-w-0 flex-1 items-start gap-2 text-label">
          <input type="checkbox" checked={item.met} disabled={update.isPending} onChange={() => saveCriteria(goal.successCriteria.map((entry) => entry.id === item.id ? { ...entry, met: !entry.met } : entry))} className="mt-0.5 accent-accent" />
          <span className="min-w-0 break-words">{item.text}</span>
        </label>
        <button type="button" aria-label={`Удалить признак «${item.text}»`} disabled={update.isPending} onClick={() => saveCriteria(goal.successCriteria.filter((entry) => entry.id !== item.id))} className="text-subtle-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><X size={14} /></button>
      </div>)}
      <form onSubmit={addCriterion} className="flex gap-2">
        <Input value={criterion} onChange={(event) => setCriterion(event.target.value)} maxLength={240} aria-label="Новый признак достижения" placeholder="Например, сад готов к посадке" />
        <Button type="submit" size="sm" variant="outline" disabled={!criterion.trim() || update.isPending || goal.successCriteria.length >= 12} aria-label="Добавить признак"><Plus size={15} /></Button>
      </form>
    </section>

    <section className="space-y-2 border-t border-border pt-3" aria-label="Пересмотр цели">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-label font-medium">Короткий пересмотр</h3>
        {goal.lastReview ? <span className="text-2xs text-subtle-foreground">{shortDate(goal.lastReview.at)}</span> : null}
      </div>
      <form onSubmit={saveReview} className="space-y-2">
        <label className="block space-y-1 text-2xs text-subtle-foreground">Что сдвинулось<Textarea value={wins} onChange={(event) => setWins(event.target.value)} rows={2} maxLength={2000} aria-label="Что сдвинулось" /></label>
        <label className="block space-y-1 text-2xs text-subtle-foreground">Что мешает<Textarea value={blockers} onChange={(event) => setBlockers(event.target.value)} rows={2} maxLength={2000} aria-label="Что мешает" /></label>
        <label className="block space-y-1 text-2xs text-subtle-foreground">Следующий шаг<Textarea value={next} onChange={(event) => setNext(event.target.value)} rows={2} maxLength={2000} aria-label="Следующий шаг цели" /></label>
        <Button type="submit" size="sm" variant="outline" disabled={update.isPending || ![wins, blockers, next].some((value) => value.trim())}>Зафиксировать пересмотр</Button>
      </form>
    </section>
  </div>;
}
