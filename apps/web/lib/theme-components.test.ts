// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../packages/ui/src/theme-provider";
import { ARCTIC_THEME, PRECISION_THEME } from "../../../packages/ui/src/theme-engine";
import { ToastProvider, useToast } from "../../../packages/ui/src/toast";
import { Tooltip } from "../../../packages/ui/src/tooltip";

describe("theme-aware transient UI", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })));
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("requires opt-in for imported themes and scopes native color-scheme", async () => {
    const render = (flag?: string): React.ReactElement => h(ThemeProvider, { flag, definition: ARCTIC_THEME, children: "Sample" });
    await act(async () => root.render(render()));
    expect(host.firstElementChild?.getAttribute("data-kaiden-theme")).toBe("legacy");
    await act(async () => root.render(render("kaiden-theme-v1")));
    expect((host.firstElementChild as HTMLElement).style.colorScheme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("");
    await act(async () => root.render(h(ThemeProvider, { flag: "kaiden-theme-v1", definition: { ...ARCTIC_THEME, colors: { surface: "url(https://example.test)" } }, children: "Sample" })));
    expect(host.firstElementChild?.getAttribute("data-kaiden-theme")).toBe("legacy");
    expect((host.firstElementChild as HTMLElement).style.colorScheme).toBe("");
  });

  it("shows a focus tooltip in the owner's light palette outside the owner DOM", async () => {
    await act(async () => root.render(h(ThemeProvider, { flag: "kaiden-theme-v1", definition: ARCTIC_THEME,
      children: h(Tooltip, { label: "Light tip", children: h("button", null, "Trigger") }) })));
    await act(async () => host.querySelector("button")?.focus());
    const tip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tip).not.toBeNull(); expect(host.contains(tip)).toBe(false);
    expect(tip?.dataset.kaidenTheme).toBe("arctic");
    expect(tip?.style.colorScheme).toBe("light");
    expect(tip?.style.getPropertyValue("--kaiden-text-primary")).toBe("23 33 43");
  });

  it("captures each toast's source theme while keeping the public API stable across theme changes", async () => {
    let api: ReturnType<typeof useToast> | undefined;
    function Caller(): React.ReactElement { api = useToast(); return h("span", null, "Caller"); }
    const render = (light: boolean): React.ReactElement => h(ToastProvider, {
      children: h(ThemeProvider, { flag: "kaiden-theme-v1", definition: light ? ARCTIC_THEME : PRECISION_THEME, children: h(Caller) })
    });
    await act(async () => root.render(render(false)));
    const initialApi = api;
    await act(async () => { api?.toast({ title: "Dark event", duration: 0 }); });
    await act(async () => root.render(render(true)));
    expect(api).toBe(initialApi);
    await act(async () => { api?.toast({ title: "Light event", duration: 0 }); });
    const toasts = [...document.querySelectorAll<HTMLElement>(".pointer-events-auto")];
    expect(toasts.map(node => node.dataset.kaidenTheme)).toEqual(["kaiden-precision", "arctic"]);
    expect(toasts[0].style.getPropertyValue("--kaiden-bg-elevated")).toBe("29 30 34");
    expect(toasts[1].style.getPropertyValue("--kaiden-bg-elevated")).toBe("255 255 255");
    expect(document.documentElement.hasAttribute("data-kaiden-theme")).toBe(false);
  });
});
