import { describe, expect, it, vi } from "vitest";
import { places } from "../places";
import { createExtensionRuntime, type ExtensionModule } from "./loader";

const Noop = () => null;

describe("extension runtime", () => {
  it("activates a module, tags what it adds and removes it on unload", async () => {
    const deactivate = vi.fn();
    const modules: Record<string, ExtensionModule> = {
      "/a.js?h=1": {
        activate(ctx) {
          ctx.addPanel({ id: "usage", label: "Расход", icon: Noop as never, component: Noop });
          ctx.addWidget({ id: "today", title: "Сегодня", component: Noop });
        },
        deactivate
      }
    };
    const runtime = createExtensionRuntime(async (url) => modules[url]!);
    await runtime.sync([{ id: "ai-tokens", url: "/a.js?h=1" }]);
    expect(runtime.state("ai-tokens")).toEqual({ status: "active" });
    const panel = places.find("panel", "ai-tokens.usage");
    expect(panel).toMatchObject({ pluginId: "ai-tokens", runtime: true, label: "Расход" });

    await runtime.sync([]);
    expect(places.find("panel", "ai-tokens.usage")).toBeUndefined();
    expect(places.find("widget", "ai-tokens.today")).toBeUndefined();
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(runtime.state("ai-tokens")).toBeUndefined();
  });

  it("reloads when the code changes and keeps the new places only", async () => {
    const versions: Record<string, ExtensionModule> = {
      "/a.js?h=1": { activate: (ctx) => void ctx.addCommand({ id: "old", label: "Старая", run: () => undefined }) },
      "/a.js?h=2": { activate: (ctx) => void ctx.addCommand({ id: "new", label: "Новая", run: () => undefined }) }
    };
    const runtime = createExtensionRuntime(async (url) => versions[url]!);
    await runtime.sync([{ id: "dev", url: "/a.js?h=1" }]);
    await runtime.sync([{ id: "dev", url: "/a.js?h=2" }]);
    expect(places.find("command", "dev.old")).toBeUndefined();
    expect(places.find("command", "dev.new")?.label).toBe("Новая");
    await runtime.sync([]);
  });

  it("reports a failed import or activate and leaves nothing behind", async () => {
    const runtime = createExtensionRuntime(async (url) => {
      if (url === "/broken.js") throw new Error("Failed to fetch dynamically imported module");
      return {
        activate(ctx) {
          ctx.addSettings({ id: "half", label: "Наполовину", component: Noop });
          throw new Error("сломалось в activate");
        }
      };
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runtime.sync([{ id: "broken", url: "/broken.js" }, { id: "half", url: "/half.js" }]);
    expect(runtime.state("broken")).toEqual({ status: "failed", error: "Failed to fetch dynamically imported module" });
    expect(runtime.state("half")).toEqual({ status: "failed", error: "сломалось в activate" });
    expect(places.find("settings", "half.half")).toBeUndefined();
    await runtime.sync([]);
  });

  it("rejects a module without activate", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = createExtensionRuntime(async () => ({}));
    await runtime.sync([{ id: "empty", url: "/e.js" }]);
    expect(runtime.state("empty")).toEqual({ status: "failed", error: "в модуле нет функции activate(ctx)" });
  });
});
