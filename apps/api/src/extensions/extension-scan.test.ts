import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extensionsDir, folderFingerprint, scanExtensions, statusOf, type ExtensionApproval } from "./extension-scan";

let dir: string;
const reserved = new Set(["tasks", "habits-insights"]);

function write(folder: string, manifest: unknown, code: string | null = "export function activate() {}\n"): void {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, "orion.extension.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  if (code !== null) fs.writeFileSync(path.join(dir, folder, "web.js"), code);
}

const manifest = (patch: Record<string, unknown> = {}) => ({ id: "ai-tokens", name: "Расход токенов", version: "0.1.0", engines: { orion: "^1.0.0" }, ...patch });
const approval = (patch: Partial<ExtensionApproval> = {}): ExtensionApproval => ({
  version: "0.1.0",
  sha256: "x",
  enabled: true,
  devMode: false,
  approvedBy: "u",
  approvedAt: "2026-10-20T00:00:00.000Z",
  ...patch
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-ext-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("extension scan", () => {
  it("defaults to Documents\\ORION\\Расширения and honours ORION_EXTENSIONS_DIR", () => {
    expect(extensionsDir({}, "C:\\Users\\a")).toBe(path.resolve("C:\\Users\\a", "Documents", "ORION", "Расширения"));
    expect(extensionsDir({ ORION_EXTENSIONS_DIR: dir }, "ignored")).toBe(path.resolve(dir));
  });

  it("reads a valid extension, fills manifest defaults and hashes manifest + code", () => {
    write("ai-tokens", manifest());
    const [scanned] = scanExtensions(dir, reserved);
    expect(scanned.problems).toEqual([]);
    expect(scanned.manifest).toMatchObject({ entry: "web.js", description: "", permissions: { network: [], secrets: [], storage: false } });
    expect(scanned.sha256).toMatch(/^[0-9a-f]{64}$/);
    const before = scanned.sha256;
    fs.writeFileSync(path.join(dir, "ai-tokens", "web.js"), "export function activate() { /* changed */ }\n");
    expect(scanExtensions(dir, reserved)[0].sha256).not.toBe(before);
  });

  it("accepts a manifest saved by Notepad with a byte-order mark", () => {
    write("ai-tokens", manifest());
    const file = path.join(dir, "ai-tokens", "orion.extension.json");
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(file)]));
    expect(scanExtensions(dir, reserved)[0].problems).toEqual([]);
  });

  it("explains every way a folder can be wrong", () => {
    fs.mkdirSync(path.join(dir, "empty"));
    write("broken", "{ not json");
    write("bad-fields", { id: "Bad Id", name: "", version: "1", engines: {} });
    write("other-name", manifest({ id: "ai-tokens-2" }));
    write("tasks", manifest({ id: "tasks" }));
    write("no-code", manifest({ id: "no-code" }), null);
    const byFolder = Object.fromEntries(scanExtensions(dir, reserved).map((item) => [item.folder, item.problems.join("; ")]));
    expect(byFolder.empty).toContain("нет файла orion.extension.json");
    expect(byFolder.broken).toContain("не JSON");
    expect(byFolder["bad-fields"]).toContain("id в kebab-case");
    expect(byFolder["other-name"]).toContain("не совпадает с именем папки");
    expect(byFolder.tasks).toContain("занят встроенным");
    expect(byFolder["no-code"]).toContain("orion-ext build");
  });

  it("derives the status from folder and approval", () => {
    write("ai-tokens", manifest());
    const [scanned] = scanExtensions(dir, reserved);
    expect(statusOf(scanned, undefined, "1.1.0")).toBe("pending");
    expect(statusOf(scanned, approval({ sha256: scanned.sha256! }), "1.1.0")).toBe("approved");
    expect(statusOf(scanned, approval({ sha256: scanned.sha256!, enabled: false }), "1.1.0")).toBe("disabled");
    expect(statusOf(scanned, approval({ sha256: "old" }), "1.1.0")).toBe("changed");
    expect(statusOf(scanned, approval({ sha256: "old", devMode: true }), "1.1.0")).toBe("approved");
    expect(statusOf(scanned, undefined, "2.0.0")).toBe("incompatible");
    expect(statusOf({ ...scanned, problems: ["x"] }, approval(), "1.1.0")).toBe("invalid");
  });

  it("changes the fingerprint when a file changes or a folder appears", () => {
    expect(folderFingerprint(path.join(dir, "nope"))).toBe("missing");
    const empty = folderFingerprint(dir);
    write("ai-tokens", manifest());
    const one = folderFingerprint(dir);
    expect(one).not.toBe(empty);
    fs.writeFileSync(path.join(dir, "ai-tokens", "web.js"), "export function activate() { return 1; }\n");
    expect(folderFingerprint(dir)).not.toBe(one);
  });
});
