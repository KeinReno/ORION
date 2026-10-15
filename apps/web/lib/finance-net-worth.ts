import type { Account, Obligation } from "@orion/shared-types";

/**
 * Net worth (чистый капитал) — what the accounts hold minus what is owed plus what is owed to you, per currency.
 *
 * Rules, written out because every one of them is a choice:
 *  - only non-archived accounts count; a negative balance (an overdraft) is a debt of the account, not a negative asset;
 *  - an obligation counts only while open and only when its remaining `principal` is tracked (a subscription or a
 *    utility bill has no total — «не знаем» is not zero, so it is left out and counted in `untracked`);
 *  - an obligation's currency is its account's; without an account it takes the only currency of the workspace, and with
 *    several currencies it goes to `unassigned` and is NOT added to anyone's total (100 USD + 100 EUR is not 200).
 */
export interface NetWorthCurrency {
  currency: string;
  /** Sum of positive account balances. */
  assets: number;
  /** Overdrafts on accounts (positive number). */
  accountDebt: number;
  /** Open obligations the workspace owes (direction `owe`), positive number. */
  owe: number;
  /** Open obligations owed to the workspace (direction `owed`). */
  owed: number;
  /** assets − accountDebt − owe + owed. */
  net: number;
}

export interface NetWorth {
  currencies: NetWorthCurrency[];
  /** Obligations with a tracked principal that could not be placed in any currency. */
  unassigned: Obligation[];
  /** Open obligations without a tracked total (subscriptions, utilities) — not in the figures. */
  untracked: number;
}

export function buildNetWorth(accounts: readonly Account[], obligations: readonly Obligation[]): NetWorth {
  const live = accounts.filter((account) => !account.archivedAt);
  const byCurrency = new Map<string, NetWorthCurrency>();
  const bucket = (currency: string): NetWorthCurrency => {
    let entry = byCurrency.get(currency);
    if (!entry) {
      entry = { currency, assets: 0, accountDebt: 0, owe: 0, owed: 0, net: 0 };
      byCurrency.set(currency, entry);
    }
    return entry;
  };
  const currencyOfAccount = new Map(live.map((account) => [account.id, account.currency]));
  for (const account of live) {
    const entry = bucket(account.currency);
    if (account.balance >= 0) entry.assets += account.balance;
    else entry.accountDebt += -account.balance;
  }

  const onlyCurrency = byCurrency.size === 1 ? [...byCurrency.keys()][0]! : null;
  const unassigned: Obligation[] = [];
  let untracked = 0;
  for (const obligation of obligations) {
    if (obligation.closedAt) continue;
    if (obligation.principal === null) {
      untracked += 1;
      continue;
    }
    const currency = (obligation.accountId ? currencyOfAccount.get(obligation.accountId) : undefined) ?? onlyCurrency;
    if (!currency) {
      unassigned.push(obligation);
      continue;
    }
    const entry = bucket(currency);
    if (obligation.direction === "owe") entry.owe += obligation.principal;
    else entry.owed += obligation.principal;
  }

  const currencies = [...byCurrency.values()].map((entry) => ({ ...entry, net: entry.assets - entry.accountDebt - entry.owe + entry.owed }));
  return { currencies, unassigned, untracked };
}

/** Share of each account kind in the assets of one currency, largest first (zero-balance kinds omitted). */
export function assetShares(accounts: readonly Account[], currency: string): { kind: Account["kind"]; amount: number; share: number }[] {
  const totals = new Map<Account["kind"], number>();
  let sum = 0;
  for (const account of accounts) {
    if (account.archivedAt || account.currency !== currency || account.balance <= 0) continue;
    totals.set(account.kind, (totals.get(account.kind) ?? 0) + account.balance);
    sum += account.balance;
  }
  return [...totals.entries()]
    .map(([kind, amount]) => ({ kind, amount, share: sum > 0 ? amount / sum : 0 }))
    .sort((a, b) => b.amount - a.amount);
}
