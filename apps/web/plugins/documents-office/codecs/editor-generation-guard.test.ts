import { describe, expect, it } from "vitest";
import { shouldAcceptRefetchedBlob } from "./editor-generation-guard";

/** The pre-R28-05 comparison this file's fix replaces — kept here only to prove it was wrong. */
function buggyShouldAccept(editGenerationAtFetchStart: number, editGenerationNow: number): boolean {
  return editGenerationNow === editGenerationAtFetchStart;
}

describe("shouldAcceptRefetchedBlob (R28-05)", () => {
  it("accepts a fresh blob when there is no unsaved edit at all", () => {
    expect(shouldAcceptRefetchedBlob(0, 0)).toBe(true);
  });

  it("rejects a blob that arrived while the user was still typing during this fetch", () => {
    // editGeneration bumped from 1 (fetch start) to 2 (mid-flight keystroke).
    expect(shouldAcceptRefetchedBlob(2, /* savedGeneration */ 1)).toBe(false);
  });

  it("REGRESSION R28-05: rejects a blob when the draft was already dirty BEFORE this fetch started", () => {
    // Scenario from 28-REVIEW-AFTER-U08.md: send A (generation 1, saved=1) ->
    // type B (generation bumps to 2, saved stays 1) -> the save response /
    // refetch fires a NEW parse effect AFTER B was typed. At that point
    // editGeneration is already 2 when the effect starts.
    const editGenerationAtFetchStart = 2;
    const editGenerationNow = 2; // nothing typed *during* this particular fetch
    const savedGeneration = 1; // but B was never saved

    // The buggy comparison only looks at whether anything changed during
    // THIS fetch — it did not, so it wrongly says "accept".
    expect(buggyShouldAccept(editGenerationAtFetchStart, editGenerationNow)).toBe(true);

    // The fixed comparison looks at whether there is any unsaved edit at
    // all (current generation vs. last SAVED generation) — B is unsaved,
    // so the blob must be rejected.
    expect(shouldAcceptRefetchedBlob(editGenerationNow, savedGeneration)).toBe(false);
  });

  it("accepts a blob once the pending edit has actually been saved", () => {
    expect(shouldAcceptRefetchedBlob(2, 2)).toBe(true);
  });
});
