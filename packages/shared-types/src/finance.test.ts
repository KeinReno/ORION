import { describe, expect, it } from "vitest";
import {
  accountSchema,
  createTransactionInputSchema,
  financeSettingsSchema,
  updateFinanceSettingsInputSchema
} from "./finance";

describe("finance settings (simple/advanced mode)", () => {
  it("parses the default advanced settings row", () => {
    const parsed = financeSettingsSchema.parse({
      workspaceId: "ws-1",
      mode: "advanced",
      updatedAt: "2026-11-16T00:00:00.000Z"
    });
    expect(parsed.mode).toBe("advanced");
  });

  it("accepts the simple mode", () => {
    expect(financeSettingsSchema.parse({ workspaceId: "ws-1", mode: "simple", updatedAt: "2026-11-16T00:00:00.000Z" }).mode).toBe("simple");
  });

  it("rejects an unknown mode", () => {
    expect(financeSettingsSchema.safeParse({ workspaceId: "ws-1", mode: "expert", updatedAt: "2026-11-16T00:00:00.000Z" }).success).toBe(false);
  });

  it("update input carries only the mode", () => {
    expect(updateFinanceSettingsInputSchema.parse({ mode: "simple" })).toEqual({ mode: "simple" });
    expect(updateFinanceSettingsInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("account isDefault flag", () => {
  it("round-trips the default-account marker", () => {
    const base = {
      id: "a-1",
      workspaceId: "ws-1",
      name: "Основной",
      kind: "cash",
      context: "personal",
      visibility: "workspace",
      ownerId: null,
      currency: "RUB",
      startingBalance: 0,
      balance: 0,
      archivedAt: null,
      isDefault: false,
      createdAt: "2026-11-16T00:00:00.000Z",
      updatedAt: "2026-11-16T00:00:00.000Z"
    };
    expect(accountSchema.parse(base).isDefault).toBe(false);
    expect(accountSchema.parse({ ...base, isDefault: true }).isDefault).toBe(true);
    // Поле обязательное — старый клиент без него не пройдёт.
    expect(accountSchema.safeParse({ ...base, isDefault: undefined }).success).toBe(false);
  });
});

describe("createTransactionInput accountId optional", () => {
  const base = {
    type: "expense",
    occurredAt: "2026-11-16T00:00:00.000Z",
    lines: [{ categoryId: null, amount: 1000 }]
  };

  it("allows omitting accountId (simple mode resolves the default account server-side)", () => {
    const parsed = createTransactionInputSchema.parse(base);
    expect(parsed.accountId).toBeUndefined();
  });

  it("still allows an explicit accountId", () => {
    expect(createTransactionInputSchema.parse({ ...base, accountId: "acc-1" }).accountId).toBe("acc-1");
  });
});
