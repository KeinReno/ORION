import type { CreateRecurringTransactionInput, Obligation, RecurringTransaction, Transaction } from "@orion/shared-types";

/**
 * «Похоже на регулярный платёж»: operations that repeat on a steady rhythm and that no rule or obligation covers yet.
 * Pure arithmetic over the history, with every threshold written down — it only proposes, a rule is created by a click.
 *
 *  - the same normalised note on the same account and direction, at least `MIN_OCCURRENCES` times;
 *  - each gap between neighbours is a month (26–35 days) or a week (6–8 days) — a single odd gap disqualifies it;
 *  - every amount is within ±10% of the median (a utility bill drifts, a subscription does not);
 *  - the last one is recent (within ~2 periods), so a cancelled subscription is not proposed back.
 */
export const MIN_OCCURRENCES = 3;
const DAY_MS = 86_400_000;
const AMOUNT_TOLERANCE = 0.1;

export interface RecurringSuggestion {
  /** Stable id of the pattern — used to remember «не предлагать». */
  key: string;
  label: string;
  occurrences: number;
  input: CreateRecurringTransactionInput;
}

/** «Netflix 10/2026», «NETFLIX  » → «netflix»: digits and punctuation are noise, case and spacing too. */
export function normalizeNote(note: string): string {
  return note.toLowerCase().replace(/[\d\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

type Interval = "weekly" | "monthly";

function rhythm(gapsDays: readonly number[]): Interval | null {
  if (gapsDays.every((gap) => gap >= 26 && gap <= 35)) return "monthly";
  if (gapsDays.every((gap) => gap >= 6 && gap <= 8)) return "weekly";
  return null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Next occurrence strictly after `now`, keeping the weekday (weekly) or the day of month (monthly, capped at 28 like rules are). */
function nextRun(last: Date, interval: Interval, anchorDay: number, now: Date): Date {
  const next = new Date(last);
  if (interval === "weekly") {
    while (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
    return next;
  }
  next.setDate(1);
  do {
    next.setMonth(next.getMonth() + 1);
    next.setDate(anchorDay);
  } while (next.getTime() <= now.getTime());
  return next;
}

export function suggestRecurring(
  transactions: readonly Transaction[],
  rules: readonly Pick<RecurringTransaction, "accountId" | "note" | "type">[],
  obligations: readonly Pick<Obligation, "name">[],
  now: Date = new Date()
): RecurringSuggestion[] {
  const covered = new Set([...rules.map((rule) => `${rule.accountId}|${rule.type}|${normalizeNote(rule.note)}`)]);
  const obligationNames = new Set(obligations.map((obligation) => normalizeNote(obligation.name)));

  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (transaction.type === "transfer") continue;
    if (transaction.importedRef?.startsWith("obligation:")) continue;
    const key = normalizeNote(transaction.note);
    if (!key) continue;
    const groupKey = `${transaction.accountId}|${transaction.type}|${key}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), transaction]);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const [groupKey, items] of groups) {
    if (items.length < MIN_OCCURRENCES || covered.has(groupKey)) continue;
    const normalized = groupKey.split("|")[2]!;
    if (obligationNames.has(normalized)) continue;

    const sorted = [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const gaps = sorted.slice(1).map((item, index) => (new Date(item.occurredAt).getTime() - new Date(sorted[index]!.occurredAt).getTime()) / DAY_MS);
    const interval = rhythm(gaps);
    if (!interval) continue;

    const amounts = sorted.map((item) => item.totalAmount);
    const typical = median(amounts);
    if (typical <= 0 || amounts.some((amount) => Math.abs(amount - typical) / typical > AMOUNT_TOLERANCE)) continue;

    const last = sorted[sorted.length - 1]!;
    const lastAt = new Date(last.occurredAt);
    const freshnessDays = interval === "monthly" ? 70 : 21;
    if ((now.getTime() - lastAt.getTime()) / DAY_MS > freshnessDays) continue;

    // Monday = 0, like the rule's own weekly anchor.
    const anchorDay = interval === "weekly" ? (lastAt.getDay() + 6) % 7 : Math.min(lastAt.getDate(), 28);
    suggestions.push({
      key: groupKey,
      label: last.note.trim(),
      occurrences: sorted.length,
      input: {
        accountId: last.accountId,
        categoryId: last.lines.length === 1 ? last.lines[0]!.categoryId : null,
        type: last.type,
        amount: last.totalAmount,
        note: last.note.trim(),
        interval,
        anchorDay,
        nextRunAt: nextRun(lastAt, interval, interval === "weekly" ? 0 : anchorDay, now).toISOString()
      }
    });
  }
  return suggestions.sort((a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label));
}
