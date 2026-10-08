"use client";

import { useAccounts } from "@orion/core-react";
import { Button, PanelBody, PanelHeader, PanelShell, SegmentedControl } from "@orion/ui";
import { Tags, Wallet } from "lucide-react";
import { useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { AccountsView } from "./finance/accounts-view";
import { BudgetsView } from "./finance/budgets-view";
import { CategoryManagerModal } from "./finance/category-manager";
import { GoalsView } from "./finance/goals-view";
import { RecurringView } from "./finance/recurring-view";
import { ReportsView } from "./finance/reports-view";
import { FinanceSummaryRow } from "./finance/summary-row";
import { TransactionsView } from "./finance/transactions-view";

type FinanceTab = "transactions" | "reports" | "budgets" | "accounts" | "goals" | "recurring";

/**
 * One module = one panel (see CLAUDE.md "Модульный контракт") even though
 * "Финансы" spans five entities — the tabs here mirror how TasksPanel hides
 * its groupBy switch and Calendar its Month/Week/List views behind the same
 * SegmentedControl, rather than registering four separate sidebar entries
 * for one product surface. Categories are shared infrastructure used by
 * three of the four tabs, so they get their own modal off the header
 * instead of a fifth tab (see docs/PLAN.md v0.8).
 */
export function FinancePanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const accounts = useAccounts(workspace?.id, true);
  const [tabOverride, setTabOverride] = useState<FinanceTab | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const hasAccounts = (accounts.data ?? []).some((account) => !account.archivedAt);
  const tab = tabOverride ?? (accounts.isSuccess && !hasAccounts ? "accounts" : "transactions");

  return (
    <PanelShell>
      <PanelHeader
        icon={Wallet}
        title="Финансы"
        actions={
          <Button variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
            <Tags className="h-4 w-4" /> Категории
          </Button>
        }
      >
        <SegmentedControl<FinanceTab>
          value={tab}
          onChange={setTabOverride}
          options={[
            { value: "transactions", label: "Транзакции" },
            { value: "accounts", label: "Счета" },
            { value: "budgets", label: "Бюджеты" },
            { value: "goals", label: "Цели" },
            { value: "recurring", label: "Повторяющиеся" },
            { value: "reports", label: "Отчёты" }
          ]}
        />
      </PanelHeader>
      <PanelBody className="[container-type:inline-size]">
        <FinanceSummaryRow />
        {tab === "transactions" ? <TransactionsView onOpenAccounts={() => setTabOverride("accounts")} /> : null}
        {tab === "accounts" ? <AccountsView /> : null}
        {tab === "budgets" ? <BudgetsView /> : null}
        {tab === "goals" ? <GoalsView /> : null}
        {tab === "recurring" ? <RecurringView /> : null}
        {tab === "reports" ? <ReportsView /> : null}
      </PanelBody>

      <CategoryManagerModal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
    </PanelShell>
  );
}
