import { describe, expect, it } from "vitest";
import { dequeueFeedback, enqueueFeedback, markFeedbackAttempt } from "./feedback-queue";

const item = (id: string) => ({ id, kind: "bug" as const, message: "Падает при сохранении", createdAt: "2026-10-28T10:00:00.000Z" });

describe("enqueueFeedback", () => {
  it("adds a report with zero attempts and no error yet", () => {
    expect(enqueueFeedback([], item("a"))).toEqual([{ ...item("a"), attempts: 0, lastError: null }]);
  });
});

describe("dequeueFeedback", () => {
  it("removes a report once it finally sends", () => {
    const queue = enqueueFeedback(enqueueFeedback([], item("a")), item("b"));
    expect(dequeueFeedback(queue, "a").map((x) => x.id)).toEqual(["b"]);
  });

  it("is a no-op for an id that isn't queued", () => {
    const queue = enqueueFeedback([], item("a"));
    expect(dequeueFeedback(queue, "missing")).toEqual(queue);
  });
});

describe("markFeedbackAttempt", () => {
  it("counts the attempt and remembers the error, only on the matching report", () => {
    const queue = enqueueFeedback(enqueueFeedback([], item("a")), item("b"));
    const next = markFeedbackAttempt(queue, "a", "Сеть недоступна");
    expect(next.find((x) => x.id === "a")).toMatchObject({ attempts: 1, lastError: "Сеть недоступна" });
    expect(next.find((x) => x.id === "b")).toMatchObject({ attempts: 0, lastError: null });
  });
});
