import { z } from "zod";

/**
 * Plugin `finance-split`: shared expenses between members of one workspace — «кто кому должен».
 *
 * It is a LEDGER BETWEEN PEOPLE, deliberately separate from the account ledger: «Аня заплатила 3000 за продукты, делим на
 * троих» changes what the members owe each other, not the balance of any account. (If the payment itself should be on
 * an account, it is an ordinary operation, and the split may point at it with `transactionId`.) A settlement («Петя
 * отдал Ане 1000») is likewise a record between people.
 *
 * Money is integer minor units; balances are kept per currency and never added across currencies.
 */
export const splitShareSchema = z.object({
  userId: z.string(),
  /** What this person owes for the expense, minor units (the payer's own share is included). */
  share: z.number().int().nonnegative()
});
export type SplitShare = z.infer<typeof splitShareSchema>;

export const splitSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  amount: z.number().int().positive(),
  currency: z.string(),
  paidById: z.string(),
  occurredAt: z.string(),
  note: z.string(),
  /** The ordinary operation that is this payment, if the user pointed at one. */
  transactionId: z.string().nullable(),
  createdById: z.string(),
  shares: z.array(splitShareSchema),
  createdAt: z.string()
});
export type Split = z.infer<typeof splitSchema>;

export const createSplitInputSchema = z
  .object({
    title: z.string().trim().min(1, "Название обязательно").max(120),
    amount: z.number().int().positive("Сумма должна быть больше нуля").max(2_000_000_000),
    currency: z.string().length(3).default("RUB"),
    paidById: z.string(),
    occurredAt: z.string().datetime(),
    note: z.string().max(2000).default(""),
    transactionId: z.string().nullable().optional(),
    shares: z.array(splitShareSchema).min(1, "Выберите, между кем делим").max(50)
  })
  .superRefine((value, context) => {
    const ids = value.shares.map((share) => share.userId);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["shares"], message: "Участник указан дважды" });
    const total = value.shares.reduce((sum, share) => sum + share.share, 0);
    if (total !== value.amount) context.addIssue({ code: "custom", path: ["shares"], message: "Доли должны давать ровно сумму расхода" });
  });
export type CreateSplitInput = z.infer<typeof createSplitInputSchema>;

export const settlementSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  amount: z.number().int().positive(),
  currency: z.string(),
  occurredAt: z.string(),
  note: z.string(),
  createdById: z.string(),
  createdAt: z.string()
});
export type Settlement = z.infer<typeof settlementSchema>;

export const createSettlementInputSchema = z
  .object({
    fromUserId: z.string(),
    toUserId: z.string(),
    amount: z.number().int().positive("Сумма должна быть больше нуля").max(2_000_000_000),
    currency: z.string().length(3).default("RUB"),
    occurredAt: z.string().datetime(),
    note: z.string().max(2000).default("")
  })
  .refine((value) => value.fromUserId !== value.toUserId, { message: "Нельзя рассчитаться с самим собой", path: ["toUserId"] });
export type CreateSettlementInput = z.infer<typeof createSettlementInputSchema>;

export const splitBalanceSchema = z.object({
  userId: z.string(),
  currency: z.string(),
  /** Positive: others owe this person. Negative: this person owes others. */
  net: z.number().int()
});
export type SplitBalance = z.infer<typeof splitBalanceSchema>;

export const splitOverviewSchema = z.object({
  /** Latest first, capped; the balances below are computed over ALL records, not over these. */
  splits: z.array(splitSchema),
  settlements: z.array(settlementSchema),
  balances: z.array(splitBalanceSchema)
});
export type SplitOverview = z.infer<typeof splitOverviewSchema>;

/**
 * net(u) = paid(u) − owed(u) + settled-out(u) − settled-in(u), per currency. Zero balances are left out, and the sum of
 * every currency's balances is always zero (money only moves between people here).
 */
export function computeSplitBalances(
  splits: readonly Pick<Split, "amount" | "currency" | "paidById" | "shares">[],
  settlements: readonly Pick<Settlement, "amount" | "currency" | "fromUserId" | "toUserId">[]
): SplitBalance[] {
  const nets = new Map<string, number>();
  const add = (userId: string, currency: string, delta: number): void => {
    const key = `${currency}\u0000${userId}`;
    nets.set(key, (nets.get(key) ?? 0) + delta);
  };
  for (const split of splits) {
    add(split.paidById, split.currency, split.amount);
    for (const share of split.shares) add(share.userId, split.currency, -share.share);
  }
  for (const settlement of settlements) {
    add(settlement.fromUserId, settlement.currency, settlement.amount);
    add(settlement.toUserId, settlement.currency, -settlement.amount);
  }
  return [...nets.entries()]
    .map(([key, net]) => {
      const [currency, userId] = key.split("\u0000") as [string, string];
      return { userId, currency, net };
    })
    .filter((balance) => balance.net !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.net - a.net || a.userId.localeCompare(b.userId));
}

export interface SuggestedSettlement {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
}

/**
 * The fewest payments that clear everything (greedy: the biggest debtor pays the biggest creditor). One currency at a
 * time — different currencies are never netted against each other.
 */
export function suggestSettlements(balances: readonly SplitBalance[]): SuggestedSettlement[] {
  const result: SuggestedSettlement[] = [];
  for (const currency of [...new Set(balances.map((balance) => balance.currency))]) {
    const creditors = balances.filter((b) => b.currency === currency && b.net > 0).map((b) => ({ userId: b.userId, left: b.net })).sort((a, b) => b.left - a.left);
    const debtors = balances.filter((b) => b.currency === currency && b.net < 0).map((b) => ({ userId: b.userId, left: -b.net })).sort((a, b) => b.left - a.left);
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i]!.left, creditors[j]!.left);
      if (amount > 0) result.push({ fromUserId: debtors[i]!.userId, toUserId: creditors[j]!.userId, amount, currency });
      debtors[i]!.left -= amount;
      creditors[j]!.left -= amount;
      if (debtors[i]!.left === 0) i += 1;
      if (creditors[j]!.left === 0) j += 1;
    }
  }
  return result;
}

/** Equal shares of `amount`; the remainder kopecks go one each to the first people, so the shares add up exactly. */
export function equalShares(amount: number, userIds: readonly string[]): SplitShare[] {
  if (userIds.length === 0) return [];
  const base = Math.floor(amount / userIds.length);
  const extra = amount - base * userIds.length;
  return userIds.map((userId, index) => ({ userId, share: base + (index < extra ? 1 : 0) }));
}
