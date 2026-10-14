"use client";

import { useAccounts } from "@orion/core-react";
import { Button, PanelBody, PanelHeader, PanelShell } from "@orion/ui";
import { Tags, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSlotContributions } from "../lib/extensions/slot";
import { openPanel, useTransactionFocusRequest, type EntityFocusRequest } from "../lib/panel-bus";
import type { PanelComponentProps } from "../lib/panel-registry";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { SectionTabs, sectionTabTitle, useSectionView, type SectionTab } from "../components/section-tabs";
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
export function FinancePanel({ params, api }: PanelComponentProps = {}): React.ReactElement {
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
  const options: SectionTab<FinanceTab>[] = [
    { value: "transactions", label: "Транзакции" },
    { value: "accounts", label: "Счета" },
    ...pluginTabs.map((contribution) => ({ value: contribution.meta!.tabId, label: contribution.meta!.label }))
  ];
  // A tab whose plugin has been switched off (or was never on) is not selectable: fall back to the default.
  const section = useSectionView(params, api, "Финансы", options);
  const requested = tabOverride !== null && options.some((option) => option.value === tabOverride) ? tabOverride : null;
  // Opened as a view of ONE tab: that tab, always (the strip is hidden). Otherwise the usual choice.
  const tab: FinanceTab = section.view ?? requested ?? (accounts.isSuccess && !hasAccounts ? "accounts" : "transactions");
  const activePluginTab = pluginTabs.find((contribution) => contribution.meta?.tabId === tab);

  return (
    <PanelShell>
      <PanelHeader
        icon={Wallet}
        title="Финансы"
        subtitle={section.locked ? sectionTabTitle(options.find((option) => option.value === tab)) : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
            <Tags className="h-4 w-4" /> Категории
          </Button>
        }
      >
        <SectionTabs baseId="finance" tabs={options} value={tab} onChange={setTabOverride} locked={section.locked} />
      </PanelHeader>
      <PanelBody className="[container-type:inline-size]">
        {!section.locked ? <FinanceSummaryRow /> : null}
        {section.missing ? <p className="text-label text-muted-foreground">Этой вкладки больше нет: её плагин выключен. Данные сохранены.</p> : null}
        {!section.missing && tab === "transactions" ? <TransactionsView focusRequest={pendingTransactionFocus} onFocusHandled={acknowledgeTransactionFocus} onOpenAccounts={() => (section.locked ? openPanel("view:finance~accounts", "Финансы · Счета") : setTabOverride("accounts"))} /> : null}
        {!section.missing && tab === "accounts" ? <AccountsView /> : null}
        {!section.missing && activePluginTab ? <activePluginTab.component workspaceId={workspace?.id} /> : null}
      </PanelBody>

      <CategoryManagerModal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
    </PanelShell>
  );
}
