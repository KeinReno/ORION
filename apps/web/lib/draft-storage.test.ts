import { describe, expect, it } from "vitest";
import { DRAFT_MAX_LENGTH, draftStorageKey, readDraft, writeDraft } from "./draft-storage";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data
  };
}

describe("draft storage", () => {
  it("keys drafts per workspace and field", () => {
    expect(draftStorageKey("w1", "capture")).not.toBe(draftStorageKey("w2", "capture"));
    expect(draftStorageKey("w1", "comment:a")).not.toBe(draftStorageKey("w1", "comment:b"));
  });

  it("round-trips text and removes the entry when it becomes blank", () => {
    const store = memory();
    const key = draftStorageKey("w", "capture");
    writeDraft(store, key, "купить молоко");
    expect(readDraft(store, key)).toBe("купить молоко");
    writeDraft(store, key, "  \n");
    expect(store.data.size).toBe(0);
    expect(readDraft(store, key)).toBe("");
  });

  it("caps length and ignores junk or a throwing storage", () => {
    const store = memory();
    const key = draftStorageKey("w", "x");
    writeDraft(store, key, "a".repeat(DRAFT_MAX_LENGTH + 50));
    expect(readDraft(store, key)).toHaveLength(DRAFT_MAX_LENGTH);
    expect(readDraft(memory({ [key]: "not json" }), key)).toBe("");
    expect(readDraft(memory({ [key]: JSON.stringify({ text: 5 }) }), key)).toBe("");
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(readDraft(broken, key)).toBe("");
    expect(() => writeDraft(broken, key, "t")).not.toThrow();
  });
});
