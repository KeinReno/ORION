"use client";

import { useCreateRecurringTransaction, useObligations, useRecurringTransactions, useTransactions } from "@orion/core-react";
import { Button, useToast } from "@orion/ui";
import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { describeAuthError, formatMoney, shortDate, suggestRecurring } from "../../lib/extensions/host-api";

const HISTORY_DAYS = 400;
const SAMPLE = 500;
const DISMISSED_KEY = "orion.finance.recurring-dismissed.v1";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * «Похоже на регулярный платёж»: steady repeats in the history that no rule or obligation covers yet. Only a proposal —
 * the rule appears when you press the button; «Не предлагать» is remembered in this browser only.
 */
export function RecurringSuggestions({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement | null {
  const since = useMemo(() => new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString(), []);
  const { data: transactions } = useTransactions(workspaceId, { from: since, limit: SAMPLE });
  const { data: rules } = useRecurringTransactions(workspaceId);
  // Obligations are another plugin: if it is off the request is refused and the list is simply empty.
  const { data: obligations } = useObligations(workspaceId);
  const create = useCreateRecurringTransaction(workspaceId);
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const suggestions = useMemo(
    () => (transactions && rules ? suggestRecurring(transactions, rules, obligations ?? []).filter((item) => !dismissed.includes(item.key)) : []),
    [transactions, rules, obligations, dismissed]
  );
  if (suggestions.length === 0) return null;

  function dismiss(key: string): void {
    const next = [...dismissed, key];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private window / blocked storage: the hint just comes back next time.
    }
  }

  async function accept(key: string, input: Parameters<typeof create.mutateAsync>[0]): Promise<void> {
    setBusyKey(key);
    try {
      await create.mutateAsync(input);
      toast({ title: "Правило создано", description: "Следующий платёж запишется сам в срок.", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать правило", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2" aria-label="Похоже на регулярные платежи">
      <p className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Sparkles className="h-4 w-4 text-accent-text" aria-hidden /> Похоже на регулярные платежи
      </p>
      <ul className="mt-2 space-y-2">
        {suggestions.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              <span className="text-foreground">{item.label}</span> · {formatMoney(item.input.amount)} · {item.input.interval === "monthly" ? "каждый месяц" : "каждую неделю"} · было {item.occurrences} раз, дальше{" "}
              {shortDate(item.input.nextRunAt)}
            </span>
            <Button size="sm" variant="outline" disabled={busyKey !== null} onClick={() => void accept(item.key, item.input)}>
              Создать правило
            </Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss(item.key)}>
              Не предлагать
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
