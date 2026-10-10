import { describe, expect, it } from "vitest";
import { isSameOrigin, isWebUrl, resolveBrowserInput, tabLabel } from "./browser-url";

describe("resolveBrowserInput", () => {
  it("opens http(s) addresses as they are", () => {
    expect(resolveBrowserInput("https://example.com/a?b=1")).toEqual({ kind: "url", url: "https://example.com/a?b=1" });
    expect(resolveBrowserInput("http://127.0.0.1:8765")).toEqual({ kind: "url", url: "http://127.0.0.1:8765/" });
  });
  it("adds https to a bare domain and http to local hosts", () => {
    expect(resolveBrowserInput("example.com/path")).toEqual({ kind: "url", url: "https://example.com/path" });
    expect(resolveBrowserInput("localhost:3010")).toEqual({ kind: "url", url: "http://localhost:3010/" });
    expect(resolveBrowserInput("192.168.1.5:8080")).toEqual({ kind: "url", url: "http://192.168.1.5:8080/" });
    expect(resolveBrowserInput("пример.рф")).toMatchObject({ kind: "url" });
  });
  it("turns anything else into a search, encoded", () => {
    const result = resolveBrowserInput("как сварить борщ");
    expect(result.kind).toBe("search");
    expect(result.kind === "search" && result.url).toBe(`https://www.google.com/search?igu=1&q=${encodeURIComponent("как сварить борщ")}`);
    expect(resolveBrowserInput("react").kind).toBe("search");
  });
  it("refuses every scheme that is not http(s)", () => {
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>1</script>", "file:///C:/Windows/win.ini", "about:blank", "ftp://example.com", "tauri://localhost", "blob:https://x/1"]) {
      expect(resolveBrowserInput(bad).kind, bad).toBe("refused");
    }
  });
  it("refuses empty input", () => {
    expect(resolveBrowserInput("   ").kind).toBe("refused");
  });
});

describe("isSameOrigin", () => {
  it("spots ORION's own address, in any path, and nothing else", () => {
    expect(isSameOrigin("http://localhost:3010/panel/tasks", "http://localhost:3010")).toBe(true);
    expect(isSameOrigin("http://localhost:3011/", "http://localhost:3010")).toBe(false);
    expect(isSameOrigin("https://example.com", "http://localhost:3010")).toBe(false);
    expect(isSameOrigin("not a url", "http://localhost:3010")).toBe(false);
  });
});

describe("tabLabel / isWebUrl", () => {
  it("shows the site without www, or a placeholder", () => {
    expect(tabLabel("https://www.example.com/a")).toBe("example.com");
    expect(tabLabel(null)).toBe("Новая вкладка");
  });
  it("recognises web links only", () => {
    expect(isWebUrl("https://a.b")).toBe(true);
    expect(isWebUrl("mailto:a@b.c")).toBe(false);
    expect(isWebUrl("/relative")).toBe(false);
    expect(isWebUrl("#heading")).toBe(false);
  });
});
