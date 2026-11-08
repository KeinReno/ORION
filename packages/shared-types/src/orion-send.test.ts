import { describe, expect, it } from "vitest";
import { safeRelativePath, sendManifestSchema, SEND_PROTOCOL_VERSION } from "./orion-send";

describe("safeRelativePath", () => {
  it("принимает обычный относительный путь", () => {
    expect(safeRelativePath("папка/файл.txt")).toBe("папка/файл.txt");
  });

  it("отклоняет выход из каталога и абсолютные пути", () => {
    expect(safeRelativePath("../secret")).toBeNull();
    expect(safeRelativePath("a/../../b")).toBeNull();
    expect(safeRelativePath("/etc/passwd")).toBeNull();
    expect(safeRelativePath("C:/Windows/notepad.exe")).toBeNull();
    expect(safeRelativePath("папка\\файл")).toBeNull();
    expect(safeRelativePath("CON")).toBeNull();
    expect(safeRelativePath("a/nul.txt")).toBeNull();
  });
});

describe("sendManifestSchema", () => {
  it("отвергает чужую версию протокола", () => {
    expect(
      sendManifestSchema.safeParse({
        protocol: 99,
        transferId: "11111111-1111-4111-8111-111111111111",
        files: [{ relativePath: "a.txt", size: 1, sha256: "ab".repeat(32) }]
      }).success
    ).toBe(false);
    expect(SEND_PROTOCOL_VERSION).toBe(1);
  });
});
