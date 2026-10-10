import type { Obligation } from "@orion/shared-types";
import { advanceObligationDue } from "@orion/shared-types";

/**
 * Прогноз остатка — это не предсказание, а арифметика по вашей истории с показанными допущениями.
 * Метод один и назван в ответе: средний месячный доход и расход за последние полные месяцы переносятся вперёд;
 * разброс (худший и лучший месяц истории) даёт коридор. Плановые платежи по обязательствам считаются ОТДЕЛЬНО и
 * в баланс не входят: они ещё не случились (деньги двигает только записанная операция), а их история уже сидит в
 * среднем расходе — прибавить их поверх значило бы посчитать дважды. Чистые функции, тесты — finance-forecast.test.ts.
 */

export interface MonthTotals {
  /** "YYYY-MM" */
  month: string;
  income: number;
  expense: number;
}

export interface ForecastPoint {
  /** "YYYY-MM" */
  month: string;
  /** Ожидаемый остаток на конец месяца при средних доходе и расходе. */
  balance: number;
  /** Остаток, если каждый месяц будет как худший месяц истории. */
  low: number;
  /** Остаток, если каждый месяц будет как лучший месяц истории. */
  high: number;
}

export interface Forecast {
  /** Месяцы истории, на которых построен прогноз (drill-down: видно, откуда цифры). */
  basis: MonthTotals[];
  averageIncome: number;
  averageExpense: number;
  /** Средний чистый результат месяца (доход − расход). */
  averageNet: number;
  points: ForecastPoint[];
  /** Почему прогноза нет или он слабый — показывается пользователю как есть. */
  warnings: string[];
}

export function nextMonths(from: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * `history` — прошедшие ПОЛНЫЕ месяцы (текущий неполон и занижает расход — вызывающий его не передаёт),
 * `balance` — текущий остаток по выбранной валюте, `horizon` — сколько месяцев вперёд.
 */
export function buildForecast(history: MonthTotals[], balance: number, now: Date, horizon = 6): Forecast {
  const warnings: string[] = [];
  const basis = history.filter((m) => m.income > 0 || m.expense > 0);
  if (basis.length === 0) {
    return { basis: [], averageIncome: 0, averageExpense: 0, averageNet: 0, points: [], warnings: ["Нет истории операций — прогноз строить не из чего."] };
  }
  if (basis.length < 3) warnings.push(`В истории только ${basis.length} мес. — прогноз грубый.`);

  const averageIncome = Math.round(basis.reduce((sum, m) => sum + m.income, 0) / basis.length);
  const averageExpense = Math.round(basis.reduce((sum, m) => sum + m.expense, 0) / basis.length);
  const nets = basis.map((m) => m.income - m.expense);
  const worst = Math.min(...nets);
  const best = Math.max(...nets);
  const averageNet = averageIncome - averageExpense;

  const points = nextMonths(now, horizon).map((month, index) => ({
    month,
    balance: balance + averageNet * (index + 1),
    low: balance + worst * (index + 1),
    high: balance + best * (index + 1)
  }));
  return { basis, averageIncome, averageExpense, averageNet, points, warnings };
}

export interface PlannedPayment {
  obligationId: string;
  name: string;
  /** ISO дата срока. */
  dueAt: string;
  amount: number;
  direction: "owe" | "owed";
}

/**
 * Плановые платежи по открытым обязательствам до `horizonEnd` (включительно): повторяющиеся разворачиваются по
 * `advanceObligationDue`, разовые — один раз, платёж без срока в календарь не попадает. Не изменяет баланс.
 */
export function plannedPayments(obligations: readonly Obligation[], horizonEnd: Date): PlannedPayment[] {
  const out: PlannedPayment[] = [];
  for (const obligation of obligations) {
    if (obligation.closedAt || !obligation.nextDueAt) continue;
    let due: Date | null = new Date(obligation.nextDueAt);
    let remaining = obligation.principal;
    let guard = 0;
    while (due && due.getTime() <= horizonEnd.getTime() && guard < 60) {
      const amount = remaining === null ? obligation.payment : Math.min(obligation.payment, remaining);
      if (amount <= 0) break;
      out.push({ obligationId: obligation.id, name: obligation.name, dueAt: due.toISOString(), amount, direction: obligation.direction });
      if (remaining !== null) remaining -= amount;
      due = advanceObligationDue(due, obligation.interval);
      guard += 1;
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export type DueState = "overdue" | "soon" | "later" | "none";

/** Срок относительно сегодня: «просрочено», «в ближайшие 7 дней», «позже», «без срока». */
export function dueState(nextDueAt: string | null, now: Date): DueState {
  if (!nextDueAt) return "none";
  const due = new Date(nextDueAt).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (due < startOfToday) return "overdue";
  if (due < startOfToday + 8 * 86_400_000) return "soon";
  return "later";
}
