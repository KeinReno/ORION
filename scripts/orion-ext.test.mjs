import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build, defaultExtensionsDir, init } from "./orion-ext.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orion-ext-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("orion-ext", () => {
  it("uses the same folder as the server by default", () => {
    expect(defaultExtensionsDir({}, "C:\\Users\\a")).toBe(resolve("C:\\Users\\a", "Documents", "ORION", "Расширения"));
    expect(defaultExtensionsDir({ ORION_EXTENSIONS_DIR: dir })).toBe(resolve(dir));
  });

  it("init writes a working extension and builds it without React inside", async () => {
    const target = await init("demo-ext", { name: "Демо", dir });
    const manifest = JSON.parse(readFileSync(join(target, "orion.extension.json"), "utf8"));
    expect(manifest).toMatchObject({ id: "demo-ext", name: "Демо", version: "0.1.0", entry: "web.js" });
    expect(manifest.engines.orion).toMatch(/^\^\d+\.\d+\.\d+$/);
    const code = readFileSync(join(target, "web.js"), "utf8");
    expect(code).toContain("globalThis.__ORION_SDK__");
    expect(code).toContain('sdk.modules["react/jsx-runtime"]');
    expect(code).toMatch(/export\s*\{[^}]*activate/);
    // React itself stays in ORION: no copy of its internals in the bundle.
    expect(code).not.toContain("__SECRET_INTERNALS");
    expect(code.length).toBeLessThan(50_000);
    await expect(init("demo-ext", { name: "Демо", dir })).rejects.toThrow(/уже существует/);
  });

  it("build refuses a folder with a broken manifest", async () => {
    const target = await init("demo-ext", { name: "Демо", dir });
    writeFileSync(join(target, "orion.extension.json"), JSON.stringify({ id: "Bad", name: "", version: "1", engines: {} }));
    await expect(build(target)).rejects.toThrow(/id — kebab-case/);
    await expect(init("Bad Id", { name: "x", dir })).rejects.toThrow(/kebab-case/);
  });
});
