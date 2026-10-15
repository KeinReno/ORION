// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, Popover, Sheet } from "../../../packages/ui/src/overlays";
import { ThemeProvider } from "../../../packages/ui/src/theme-provider";

describe("scoped themes across real React portals", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([Modal, Sheet])("carries the owner's tokens to %s without changing the document theme", async (Overlay) => {
    const rootStyle = document.documentElement.getAttribute("style");
    await act(async () => root.render(h(ThemeProvider, {
      flag: "kaiden-theme-v1", theme: "kaiden-precision",
      children: h(Overlay, { open: true, onClose: vi.fn(), title: "Scoped dialog", children: "Content" })
    })));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    const scope = dialog?.closest<HTMLElement>('[data-kaiden-theme="kaiden-precision"]');
    expect(scope?.style.getPropertyValue("--kaiden-accent-base")).toBe("201 168 106");
    expect(scope?.style.getPropertyValue("--kaiden-overlay-bg")).toBe("var(--kaiden-bg-elevated)");
    expect(document.documentElement.getAttribute("style")).toBe(rootStyle);
    expect(document.documentElement.hasAttribute("data-kaiden-theme")).toBe(false);
  });

  it("updates an open dialog when preview is cancelled without remounting its draft", async () => {
    const render = (enabled: boolean): React.ReactElement => h(ThemeProvider, {
      flag: enabled ? "kaiden-theme-v1" : undefined, theme: "kaiden-precision",
      children: h(Modal, { open: true, onClose: vi.fn(), title: "Draft", children: h("input", { defaultValue: "Initial" }) })
    });
    await act(async () => root.render(render(true)));
    const input = document.querySelector("input");
    if (!input) throw new Error("Missing draft input");
    input.value = "Unsaved draft";
    await act(async () => root.render(render(false)));
    expect(document.querySelector("input")).toBe(input);
    expect(input.value).toBe("Unsaved draft");
    expect(input.closest<HTMLElement>('[data-kaiden-theme="legacy"]')?.style.getPropertyValue("--kaiden-accent-base"))
      .toBe("var(--orion-accent, 91 94 232)");
  });

  it("keeps simultaneous sibling dialogs in their own themes", async () => {
    const dialog = (theme: "legacy" | "kaiden-precision"): React.ReactElement => h(ThemeProvider, {
      key: theme, flag: "kaiden-theme-v1", theme,
      children: h(Modal, { open: true, onClose: vi.fn(), title: theme, children: theme })
    });
    await act(async () => root.render(h("main", null, dialog("legacy"), dialog("kaiden-precision"))));
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    expect(dialogs.map(node => node.closest<HTMLElement>("[data-kaiden-theme]")?.dataset.kaidenTheme))
      .toEqual(["legacy", "kaiden-precision"]);
  });

  it("carries the theme to positioned popovers", async () => {
    await act(async () => root.render(h(ThemeProvider, {
      flag: "kaiden-theme-v1", theme: "kaiden-precision",
      children: h(Popover, {
        open: true,
        trigger: ({ ref }) => h("button", { ref }, "Open"),
        children: () => h("span", { id: "popover-content" }, "Popover")
      })
    })));
    const content = document.querySelector("#popover-content");
    expect(container.contains(content)).toBe(false);
    expect(content?.closest<HTMLElement>('[data-kaiden-theme="kaiden-precision"]')?.style.position).toBe("fixed");
  });

  it("adds no scoped theme to an ordinary legacy dialog", async () => {
    await act(async () => root.render(h(Modal, { open: true, onClose: vi.fn(), title: "Legacy", children: "Content" })));
    expect(document.querySelector('[role="dialog"]')?.closest("[data-kaiden-theme]")).toBeNull();
  });
});
