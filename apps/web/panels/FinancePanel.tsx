"use client";

import { useAccounts } from "@orion/core-react";
import { Button, PanelBody, PanelHeader, PanelShell, SegmentedControl } from "@orion/ui";
import { Tags, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSlotContributions } from "../lib/extensions/slot";
import { useTransactionFocusRequest, type EntityFocusRequest } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { AccountsView } from "./finance/accounts-view";
import { CategoryManagerModal } from "./finance/category-manager";
import { FinanceSummaryRow } from "./finance/summary-row";
import { TransactionsView } from "./finance/transactions-view";

/** "transactions" and "accounts" are the module's own; every other id comes from a plugin via `finance.tabs`. */
type FinanceTab = string;

/**
 * One module = one panel (see CLAUDE.md "Модульный контракт") even though
 * "Финансы" spans five entities — the tabs here mirror how TasksPanel hides
 * its groupBy switch and Calendar its Month/Week/List views behind the same
 * SegmentedControl, rather than registering four separate sidebar entries
 * for one product surface. Transactions and accounts are the module itself; budgets,
 * goals, recurring payments and reports are plugins that add their own tab. Categories are shared infrastructure used by
 * three of the four tabs, so they get their own modal off the header
 * instead of a fifth tab (see docs/HISTORY.md v0.8).
 */
export function FinancePanel(): React.ReactElement {
  const transactionFocus = useTransactionFocusRequest();
  const { workspace } = useActiveWorkspace();
  const accounts = useAccounts(workspace?.id, true);
  const [tabOverride, setTabOverride] = useState<FinanceTab | null>(null);
  const [pendingTransactionFocus, setPendingTransactionFocus] = useState<EntityFocusRequest | null>(null);
  useEffect(() => {
    if (!transactionFocus || transactionFocus.workspaceId !== workspace?.id) return;
    setPendingTransactionFocus(transactionFocus);
    setTabOverride("transactions");
  }, [transactionFocus, workspace?.id]);
  useEffect(() => {
    setPendingTransactionFocus((current) => current?.workspaceId === workspace?.id ? current : null);
  }, [workspace?.id]);
  const acknowledgeTransactionFocus = useCallback((nonce: number) => {
    setPendingTransactionFocus((current) => current?.nonce === nonce ? null : current);
  }, []);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const hasAccounts = (accounts.data ?? []).some((account) => !account.archivedAt);
  const pluginTabs = useSlotContributions("finance.tabs").filter((contribution) => contribution.meta !== undefined);
  const options: { value: FinanceTab; label: string }[] = [
    { value: "transactions", label: "Транзакции" },
    { value: "accounts", label: "Счета" },
    ...pluginTabs.map((contribution) => ({ value: contribution.meta!.tabId, label: contribution.meta!.label }))
  ];
  // A tab whose plugin has been switched off (or was never on) is not selectable: fall back to the default.
  const requested = tabOverride !== null && options.some((option) => option.value === tabOverride) ? tabOverride : null;
  const tab: FinanceTab = requested ?? (accounts.isSuccess && !hasAccounts ? "accounts" : "transactions");
  const activePluginTab = pluginTabs.find((contribution) => contribution.meta?.tabId === tab);

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
          options={options}
        />
      </PanelHeader>
      <PanelBody className="[container-type:inline-size]">
        <FinanceSummaryRow />
        {tab === "transactions" ? <TransactionsView focusRequest={pendingTransactionFocus} onFocusHandled={acknowledgeTransactionFocus} onOpenAccounts={() => setTabOverride("accounts")} /> : null}
        {tab === "accounts" ? <AccountsView /> : null}
        {activePluginTab ? <activePluginTab.component workspaceId={workspace?.id} /> : null}
      </PanelBody>

      <CategoryManagerModal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
    </PanelShell>
  );
}
