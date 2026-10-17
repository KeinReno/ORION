"use client";

import { useAccounts, useMonthlyFinanceSummary } from "@orion/core-react";
import { StatCard } from "@orion/ui";
import { useMemo } from "react";
import { ExtensionSlot } from "../../lib/extensions/slot";
import { formatMoney, sumByCurrency } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/**
 * Always-visible balance/spend/budget glance above the tab switcher — so
 * "how much money do I have" doesn't require opening the Accounts tab.
 * Balances are grouped by currency via `sumByCurrency` (accounts aren't all
 * RUB, see `Account.currency`) — DashboardPanel's finance card used to skip
 * this and sum raw balances across currencies into one misleading number
 * (fixed in S16, see docs/HISTORY.md).
 *
 * "Расход в этом месяце" is per currency too: `ReportsService.monthlySummary`
 * returns one row per (month, account currency), so a RUB+USD workspace gets
 * "Расход за месяц, RUB" and "Расход за месяц, USD" instead of one mixed
 * number (it used to hide the card entirely in that case).
 */
export function FinanceSummaryRow(): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: accounts } = useAccounts(workspaceId);
  const { data: monthly } = useMonthlyFinanceSummary(workspaceId, 1);

  const balancesByCurrency = useMemo(
    () => sumByCurrency(accounts ?? [], (a) => a.currency, (a) => a.balance),
    [accounts]
  );

  if (!accounts || accounts.length === 0) return null;

  // `monthly` for one month = one row per currency (archived accounts'
  // currencies included). Skip the ones with no spend so a dormant USD account
  // doesn't add a "0 $" card; a workspace whose live accounts share one
  // currency keeps its card even at zero, exactly as before.
  const liveCurrencies = new Set(balancesByCurrency.map(([currency]) => currency));
  const spendByCurrency = (monthly ?? []).filter(
    (m) => m.expense > 0 || (liveCurrencies.size === 1 && liveCurrencies.has(m.currency))
  );

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))" }}>
      {balancesByCurrency.map(([currency, total]) => (
        <StatCard
          key={currency}
          label={balancesByCurrency.length > 1 ? `Баланс, ${currency}` : "Баланс"}
          value={formatMoney(total, currency)}
        />
      ))}
      {spendByCurrency.map((row) => (
        <StatCard
          key={`spend-${row.currency}`}
          label={balancesByCurrency.length > 1 || spendByCurrency.length > 1 ? `Расход за месяц, ${row.currency}` : "Расход в этом месяце"}
          value={formatMoney(row.expense, row.currency)}
        />
      ))}
      <ExtensionSlot name="finance.summary" props={{ workspaceId }} />
    </div>
  );
}
