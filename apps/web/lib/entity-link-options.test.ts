import { describe, expect, it } from "vitest";
import { computeLinkOptions } from "./entity-link-options";

describe("computeLinkOptions (U02 kind selection)", () => {
  it("pilot: note -> task offers supports (note's own perspective) and related_to, not evidence_for", () => {
    const options = computeLinkOptions("note", "n1", "task", "t1");
    const kinds = options.map((o) => o.kind).sort();
    expect(kinds).toEqual(["related_to", "supports"]);
    const supports = options.find((o) => o.kind === "supports");
    expect(supports).toMatchObject({ sourceType: "note", sourceId: "n1", targetType: "task", targetId: "t1" });
    expect(supports?.perspectiveLabel).toBe("материал для");
  });

  it("pilot: task's own picker linking a note reverses the direction and uses the reverse label", () => {
    const options = computeLinkOptions("task", "t1", "note", "n1");
    const supports = options.find((o) => o.kind === "supports");
    expect(supports).toBeDefined();
    // The row must still store note->task (the only valid direction for `supports`),
    // even though the picker was opened from the task's side.
    expect(supports).toMatchObject({ sourceType: "note", sourceId: "n1", targetType: "task", targetId: "t1" });
    expect(supports?.perspectiveLabel).toBe("использует материал");
  });

  it("a pair with exactly one valid kind never offers a second option", () => {
    const options = computeLinkOptions("event", "e1", "note", "n1");
    expect(options).toHaveLength(1);
    expect(options[0]?.kind).toBe("related_to");
  });

  it("pilot: document -> transaction offers evidence_for and related_to, directed only one way", () => {
    const forward = computeLinkOptions("document", "d1", "transaction", "x1");
    const forwardKinds = forward.map((o) => o.kind).sort();
    expect(forwardKinds).toEqual(["evidence_for", "related_to"]);
    const evidence = forward.find((o) => o.kind === "evidence_for");
    expect(evidence).toMatchObject({ sourceType: "document", sourceId: "d1", targetType: "transaction", targetId: "x1" });

    // From the transaction's own picker, linking a document still creates document->transaction,
    // shown with the reverse label ("подтверждается документом").
    const backward = computeLinkOptions("transaction", "x1", "document", "d1");
    const backwardEvidence = backward.find((o) => o.kind === "evidence_for");
    expect(backwardEvidence).toMatchObject({ sourceType: "document", sourceId: "d1", targetType: "transaction", targetId: "x1" });
    expect(backwardEvidence?.perspectiveLabel).toBe("подтверждается документом");

    // The reverse pair (transaction evidence_for document) is not a real fact in the catalog.
    const reverse = computeLinkOptions("transaction", "x1", "document", "d1").filter((o) => o.kind === "evidence_for" && o.sourceType === "transaction");
    expect(reverse).toHaveLength(0);
  });

  it("same-type pair (e.g. task<->task) has no related_to option — allowAnyPair requires distinct types", () => {
    // related_to's `allowAnyPair` is scoped to "any pair of distinct registered types" (search.ts),
    // so two tasks never get an implicit related_to via this path even though they're not the same row.
    const options = computeLinkOptions("task", "t1", "task", "t2");
    expect(options).toHaveLength(0);
  });
});
