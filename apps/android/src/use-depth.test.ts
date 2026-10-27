// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  tilt: null as null | ((value: { x: number; y: number }) => void),
  state: null as null | ((value: { isActive: boolean }) => void),
  start: vi.fn(async () => ({ available: true })), stop: vi.fn(async () => {}), remove: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({
  start: native.start, stop: native.stop, addListener: async (_: string, cb: typeof native.tilt) => { native.tilt = cb; return { remove: native.remove }; },
}) }));
vi.mock("@capacitor/app", () => ({ App: { addListener: async (_: string, cb: typeof native.state) => { native.state = cb; return { remove: vi.fn() }; } } }));
import { useDepth } from "./use-depth";
let root: Root; let host: HTMLDivElement;
function Fixture({ enabled = true }: { enabled?: boolean }) { useDepth(enabled, 100); return null; }
const pointer = (type: string, id: number) => { const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerId: id }); document.dispatchEvent(event); };
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function sample(x = 1, y = -1) { await act(async () => { native.tilt?.({ x, y }); vi.advanceTimersByTime(20); }); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  document.documentElement.dataset.motion = "full";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(createElement(Fixture)); }); await settle();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("freezes every plane until the last pointer is released and clears depth when disabled", async () => {
  await sample(); const html = document.documentElement;
  expect(html.dataset.depth).toBe("active"); expect(html.style.getPropertyValue("--depth-x")).toBe("2.000px");
  await act(async () => { pointer("pointerdown", 1); pointer("pointerdown", 2); });
  expect(html.dataset.depth).toBe("paused"); await sample(-1, 1);
  expect(html.style.getPropertyValue("--depth-x")).toBe("2.000px");
  await act(async () => { pointer("pointerup", 1); vi.advanceTimersByTime(300); }); await settle();
  expect(html.dataset.depth).toBe("paused");
  await act(async () => { pointer("pointerup", 2); vi.advanceTimersByTime(201); }); await settle();
  expect(html.dataset.depth).toBe("active"); await sample(-1, 1);
  expect(html.style.getPropertyValue("--depth-x")).toBe("-2.000px");
  await act(async () => root.render(createElement(Fixture, { enabled: false })));
  expect(html.dataset.depth).toBe("off"); expect(html.style.getPropertyValue("--depth-x")).toBe("0px");
});
it("clears motion for reduced motion, editing and background and ignores late samples", async () => {
  await sample(); const html = document.documentElement;
  await act(async () => { html.dataset.motion = "reduced"; }); await settle();
  expect(html.dataset.depth).toBe("off"); await sample(); expect(html.style.getPropertyValue("--depth-x")).toBe("0px");
  await act(async () => { html.dataset.motion = "full"; }); await settle(); await sample();
  const input = document.createElement("input"); host.append(input);
  await act(async () => { input.focus(); vi.advanceTimersByTime(1); }); await settle();
  expect(html.dataset.depth).toBe("off");
  await act(async () => { input.blur(); vi.advanceTimersByTime(1); }); await settle(); await sample();
  await act(async () => native.state?.({ isActive: false })); await settle();
  expect(html.dataset.depth).toBe("off"); await sample(); expect(html.style.getPropertyValue("--depth-x")).toBe("0px");
});
