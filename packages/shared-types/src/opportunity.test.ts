import { describe, expect, it } from "vitest";
import { createOpportunityInputSchema, updateOpportunityInputSchema, opportunityListQuerySchema } from "./opportunity";

describe("Opportunity boundary", () => {
  it("keeps unknown amounts distinct from zero and validates ranges", () => {
    expect(createOpportunityInputSchema.parse({ kind: "job", title: " Analyst " }).conditions.amountMin).toBeNull();
    expect(createOpportunityInputSchema.parse({ kind: "contract", title: "Design", conditions: { amountMin: 0 } }).conditions.amountMin).toBe(0);
    expect(createOpportunityInputSchema.safeParse({ kind: "job", title: "a", conditions: { amountMin: 200, amountMax: 100 } }).success).toBe(false);
  });
  it("requires an actual patch and revision without injecting omitted defaults", () => {
    expect(updateOpportunityInputSchema.safeParse({ expectedRevision: 0 }).success).toBe(false);
    expect(updateOpportunityInputSchema.safeParse({ title: "a" }).success).toBe(false);
    expect(updateOpportunityInputSchema.parse({ expectedRevision: 3, status: "won" })).toEqual({ expectedRevision: 3, status: "won" });
  });
  it("rejects executable source links and unbounded queries", () => {
    expect(createOpportunityInputSchema.safeParse({ kind: "job", title: "a", canonicalUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(opportunityListQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(opportunityListQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });
});
