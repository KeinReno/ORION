import { describe, expect, it } from "vitest";
import { computeFocusTrapAction } from "./focus-trap";

// Overlays (Modal/Sheet) trap Tab inside the dialog so keyboard focus never
// escapes to the page behind the backdrop. `computeFocusTrapAction` is the
// pure decision core of that trap (see overlays.tsx `useFocusTrap`) — these
// tests exercise the wrap-around cases without needing jsdom/testing-library,
// which aren't set up in this repo's test suite (packages/**/*.test.ts runs
// under the plain "node" vitest environment).

type Node = { id: string };
const a: Node = { id: "a" };
const b: Node = { id: "b" };
const c: Node = { id: "c" };

describe("computeFocusTrapAction", () => {
  it("keeps focus on the container when nothing inside is focusable", () => {
    const action = computeFocusTrapAction({ nodes: [], current: null, currentOutsideContainer: true, shiftKey: false });
    expect(action).toEqual({ type: "focus-container" });
  });

  it("Tab from the last focusable node wraps to the first", () => {
    const action = computeFocusTrapAction({
      nodes: [a, b, c],
      current: c,
      currentOutsideContainer: false,
      shiftKey: false
    });
    expect(action).toEqual({ type: "focus-node", node: a });
  });

  it("Shift+Tab from the first focusable node wraps to the last", () => {
    const action = computeFocusTrapAction({
      nodes: [a, b, c],
      current: a,
      currentOutsideContainer: false,
      shiftKey: true
    });
    expect(action).toEqual({ type: "focus-node", node: c });
  });

  it("Tab from a middle node does nothing — browser default tab order applies", () => {
    const action = computeFocusTrapAction({
      nodes: [a, b, c],
      current: b,
      currentOutsideContainer: false,
      shiftKey: false
    });
    expect(action).toEqual({ type: "none" });
  });

  it("Shift+Tab from a middle node does nothing", () => {
    const action = computeFocusTrapAction({
      nodes: [a, b, c],
      current: b,
      currentOutsideContainer: false,
      shiftKey: true
    });
    expect(action).toEqual({ type: "none" });
  });

  it("Tab while focus has escaped the container (e.g. autofocus raced) redirects to the first node", () => {
    const action = computeFocusTrapAction({
      nodes: [a, b, c],
      current: null,
      currentOutsideContainer: true,
      shiftKey: false
    });
    expect(action).toEqual({ type: "focus-node", node: a });
  });

  it("Shift+Tab while focus has escaped the container redirects to the last node", () => {
    const action = computeFocusTrapAction({
      nodes: [a, b, c],
      current: null,
      currentOutsideContainer: true,
      shiftKey: true
    });
    expect(action).toEqual({ type: "focus-node", node: c });
  });

  it("a single focusable node cycles to itself on Tab", () => {
    const action = computeFocusTrapAction({ nodes: [a], current: a, currentOutsideContainer: false, shiftKey: false });
    expect(action).toEqual({ type: "focus-node", node: a });
  });
});
