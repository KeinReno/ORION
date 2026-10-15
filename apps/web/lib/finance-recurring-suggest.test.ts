import { describe, expect, it } from "vitest";
import type { Transaction } from "@orion/shared-types";
import { normalizeNote, suggestRecurring } from "./finance-recurring-suggest";

const NOW = new Date("2026-10-15T12:00:00");
const tx = (note: string, at: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `${note}-${at}`, workspaceId: "w", accountId: "a", toAccountId: null, type: "expense", note, tags: [], projectId: null,
  reconciledAt: null, importedRef: null, occurredAt: new Date(at).toISOString(),
  lines: [{ id: "l", categoryId: "c", amount }], totalAmount: amount, createdAt: "", updatedAt: "", ...extra
});
const monthly = (note: string, amount = 59900) => [tx(note, "2026-07-12T09:00:00", amount), tx(note, "2026-08-12T09:00:00", amount), tx(note, "2026-09-12T09:00:00", amount)];

describe("normalizeNote", () => {
  it("drops digits, punctuation and case", () => {
    expect(normalizeNote("  Netflix 10/2026!  ")).toBe("netflix");
    expect(normalizeNote("ЖКХ  квартира №5")).toBe("жкх квартира");
  });
});

describe("suggestRecurring", () => {
  it("proposes a steady monthly payment, anchored on its day, with the next run in the future", () => {
    const [s] = suggestRecurring(monthly("Netflix"), [], [], NOW);
    expect(s).toBeDefined();
    expect(s!.input).toMatchObject({ accountId: "a", categoryId: "c", type: "expense", amount: 59900, interval: "monthly", anchorDay: 12 });
    expect(new Date(s!.input.nextRunAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect(new Date(s!.input.nextRunAt).getDate()).toBe(12);
  });

  it("tolerates a bill that drifts by a few percent, but not a wild one", () => {
    const drifting = [tx("Свет", "2026-07-10T09:00:00", 100000), tx("Свет", "2026-08-10T09:00:00", 106000), tx("Свет", "2026-09-10T09:00:00", 96000)];
    expect(suggestRecurring(drifting, [], [], NOW)).toHaveLength(1);
    const wild = [tx("Свет", "2026-07-10T09:00:00", 100000), tx("Свет", "2026-08-10T09:00:00", 190000), tx("Свет", "2026-09-10T09:00:00", 100000)];
    expect(suggestRecurring(wild, [], [], NOW)).toEqual([]);
  });

  it("needs three, a regular rhythm and a recent last occurrence", () => {
    expect(suggestRecurring(monthly("Netflix").slice(0, 2), [], [], NOW)).toEqual([]);
    const irregular = [tx("Кофе", "2026-07-01T09:00:00", 300), tx("Кофе", "2026-07-20T09:00:00", 300), tx("Кофе", "2026-09-12T09:00:00", 300)];
    expect(suggestRecurring(irregular, [], [], NOW)).toEqual([]);
    const cancelled = [tx("Старая подписка", "2026-02-12T09:00:00", 500), tx("Старая подписка", "2026-03-12T09:00:00", 500), tx("Старая подписка", "2026-04-12T09:00:00", 500)];
    expect(suggestRecurring(cancelled, [], [], NOW)).toEqual([]);
  });

  it("skips what a rule or an obligation already covers, transfers, payments from obligations and empty notes", () => {
    expect(suggestRecurring(monthly("Netflix"), [{ accountId: "a", type: "expense", note: "netflix" }], [], NOW)).toEqual([]);
    expect(suggestRecurring(monthly("Netflix"), [], [{ name: "NETFLIX" }], NOW)).toEqual([]);
    expect(suggestRecurring(monthly("Перевод").map((t) => ({ ...t, type: "transfer" as const })), [], [], NOW)).toEqual([]);
    expect(suggestRecurring(monthly("Кредит").map((t) => ({ ...t, importedRef: "obligation:x:1" })), [], [], NOW)).toEqual([]);
    expect(suggestRecurring(monthly("  "), [], [], NOW)).toEqual([]);
  });

  it("recognises a weekly rhythm with a Monday-based anchor", () => {
    // 2026-09-21, 28, 05-Oct are Mondays.
    const weekly = [tx("Бассейн", "2026-09-21T18:00:00", 80000), tx("Бассейн", "2026-09-28T18:00:00", 80000), tx("Бассейн", "2026-10-05T18:00:00", 80000), tx("Бассейн", "2026-10-12T18:00:00", 80000)];
    const [s] = suggestRecurring(weekly, [], [], NOW);
    expect(s!.input).toMatchObject({ interval: "weekly", anchorDay: 0 });
    expect(new Date(s!.input.nextRunAt).getDay()).toBe(1);
  });

  it("keeps different accounts and directions apart", () => {
    const mixed = [...monthly("Зарплата").map((t) => ({ ...t, type: "income" as const })), ...monthly("Зарплата").map((t, i) => ({ ...t, id: `x${i}`, accountId: "other" }))];
    expect(suggestRecurring(mixed, [], [], NOW)).toHaveLength(2);
  });
});
