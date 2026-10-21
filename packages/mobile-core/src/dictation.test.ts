import { expect, it } from "vitest";
import { appendDictation, MobileRepository, type Draft } from "./index";
const draft: Draft = { kind: "note", id: null, title: "Покупки", body: "Молоко", priority: "normal" };
it("appends speech without overwriting text and does not replay the same result", () => {
  const id = crypto.randomUUID();
  const next = appendDictation(draft, "  Хлеб  ", "body", id);
  expect(next.body).toBe("Молоко\nХлеб"); expect(next.title).toBe("Покупки");
  expect(appendDictation(next, "Хлеб", "body", id)).toEqual(next);
  expect(appendDictation(draft, "завтра", "title", crypto.randomUUID()).title).toBe("Покупки завтра");
});
it("rejects overflow and empty results without truncating the original draft", () => {
  expect(() => appendDictation(draft, "а".repeat(201), "title", crypto.randomUUID())).toThrow("200");
  expect(() => appendDictation(draft, "а".repeat(20000), "body", crypto.randomUUID())).toThrow("20 000");
  expect(() => appendDictation(draft, " ", "body", crypto.randomUUID())).toThrow(); expect(draft.body).toBe("Молоко");
});
it("retains the idempotence marker across draft restart and rolls back failed writes", async () => {
  let raw: string | null = null; let fail = false;
  const disk = { read: async () => raw, write: async (value: string) => { if (fail) throw new Error("disk full"); raw = value; } };
  const repo = await MobileRepository.open(disk); const next = appendDictation(draft, "Хлеб", "body", crypto.randomUUID());
  await repo.saveDraft(next); const restored = (await MobileRepository.open(disk)).snapshot().draft!;
  expect(appendDictation(restored, "Хлеб", "body", next.lastDictationId!)).toEqual(restored);
  fail = true; await expect(repo.saveDraft(appendDictation(next, "Сыр", "body", crypto.randomUUID()))).rejects.toThrow("disk full");
  expect(repo.snapshot().draft).toEqual(next);
});
