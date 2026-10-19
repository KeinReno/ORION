// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeBrowserView } from "../components/native-browser-view";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
vi.mock("@orion/ui", () => ({ Button: ({ children, onClick }: { children: string; onClick: () => void }) => createElement("button", { onClick }, children) }));

describe("native browser lifecycle", () => {
  let root: Root, host: HTMLDivElement;
  const navigate = vi.fn();
  async function flush(): Promise<void> { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); }); }
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    bridge.invoke.mockReset().mockResolvedValue(undefined);
    bridge.listen.mockReset().mockResolvedValue(bridge.unlisten);
    navigate.mockReset();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, top: 100, width: 800, height: 500, right: 820, bottom: 600, x: 20, y: 100, toJSON: () => ({}) });
    HTMLElement.prototype.checkVisibility = () => true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); await flush(); host.remove(); vi.restoreAllMocks(); });

  it("opens once, tracks native navigation, hides behind dialogs, and closes on unmount", async () => {
    await act(async () => root.render(createElement(NativeBrowserView, { url: "https://example.com/", onNavigate: navigate, action: null })));
    await flush();
    const opened = bridge.invoke.mock.calls.find(([name]) => name === "browser_open");
    expect(opened).toBeDefined();
    const id = opened![1].id;
    const callback = bridge.listen.mock.calls[0][1];
    await act(async () => callback({ payload: { id, url: "https://example.com/result", loading: false } }));
    expect(navigate).toHaveBeenCalledWith("https://example.com/result");
    await act(async () => window.dispatchEvent(new Event("dragstart"))); await flush();
    expect(bridge.invoke).toHaveBeenCalledWith("browser_control", expect.objectContaining({ id, action: "hide" }));
    await act(async () => window.dispatchEvent(new Event("dragend"))); await flush();
    expect(bridge.invoke).toHaveBeenCalledWith("browser_control", expect.objectContaining({ id, action: "show" }));
    await act(async () => { const dialog = document.createElement("div"); dialog.role = "dialog"; host.append(dialog); });
    await flush();
    expect(bridge.invoke).toHaveBeenCalledWith("browser_control", expect.objectContaining({ id, action: "hide" }));
    await act(async () => root.unmount()); await flush();
    expect(bridge.invoke).toHaveBeenCalledWith("browser_control", { id, action: "close" });
    root = createRoot(host);
  });

  it("closes a surface even when its asynchronous creation finishes after unmount", async () => {
    let finish: (() => void) | undefined;
    bridge.invoke.mockImplementation((name: string) => name === "browser_open" ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
    await act(async () => root.render(createElement(NativeBrowserView, { url: "https://example.com/", onNavigate: navigate, action: null })));
    await flush(); expect(finish).toBeDefined();
    await act(async () => root.unmount());
    await act(async () => finish!()); await flush();
    expect(bridge.invoke).toHaveBeenCalledWith("browser_control", expect.objectContaining({ action: "close" }));
    root = createRoot(host);
  });

  it("shows a recovery action after creation fails without retrying in a loop", async () => {
    bridge.invoke.mockRejectedValue(new Error("Synthetic native failure"));
    await act(async () => root.render(createElement(NativeBrowserView, { url: "https://example.com/", onNavigate: navigate, action: null })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
    expect(host.textContent).toContain("Повторить запуск");
    expect(bridge.invoke.mock.calls.filter(([name]) => name === "browser_open")).toHaveLength(1);
  });
});
