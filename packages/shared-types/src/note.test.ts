import { describe, expect, it } from "vitest";
import { reorderNoteStackInputSchema } from "./note";

describe("reorderNoteStackInputSchema", () => {
  it("accepts a complete unique order", () => {
    expect(reorderNoteStackInputSchema.safeParse({ noteIds: ["first", "second"] }).success).toBe(true);
  });

  it("rejects duplicate note ids", () => {
    expect(reorderNoteStackInputSchema.safeParse({ noteIds: ["first", "first"] }).success).toBe(false);
  });
});
