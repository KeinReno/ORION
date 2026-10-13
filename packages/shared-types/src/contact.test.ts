import { describe, expect, it } from "vitest";
import { contactMatches, createContactCardInputSchema } from "./contact";

const card = { name: "Иван Петров", role: "сантехник", phone: "+7 (900) 123-45-67", email: "ivan@example.test", note: "только по будням" };

describe("contacts contract", () => {
  it("matches by name, role, email, note and by phone digits regardless of formatting", () => {
    expect(contactMatches(card, "петров")).toBe(true);
    expect(contactMatches(card, "САНТЕХ")).toBe(true);
    expect(contactMatches(card, "example")).toBe(true);
    expect(contactMatches(card, "будням")).toBe(true);
    expect(contactMatches(card, "900 123")).toBe(true);
    expect(contactMatches(card, "электрик")).toBe(false);
    expect(contactMatches(card, "  ")).toBe(true);
  });

  it("accepts an empty email but rejects a malformed one", () => {
    expect(createContactCardInputSchema.parse({ name: "Аня" }).email).toBe("");
    expect(createContactCardInputSchema.safeParse({ name: "Аня", email: "not-an-email" }).success).toBe(false);
    expect(createContactCardInputSchema.safeParse({ name: " " }).success).toBe(false);
  });
});
