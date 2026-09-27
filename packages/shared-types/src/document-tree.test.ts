import { describe, expect, it } from "vitest";
import {
  isDescendant,
  isValidDocumentName,
  nextAvailableName,
  sanitizeSegment,
  type DocTreeNode
} from "./document";

describe("nextAvailableName", () => {
  it("returns the name unchanged when nothing collides", () => {
    expect(nextAvailableName(["a.txt", "b.txt"], "report.pdf")).toBe("report.pdf");
  });

  it("inserts ' (2)' before the extension on the first collision", () => {
    expect(nextAvailableName(["report.pdf"], "report.pdf")).toBe("report (2).pdf");
  });

  it("keeps counting up past taken suffixes", () => {
    expect(nextAvailableName(["report.pdf", "report (2).pdf", "report (3).pdf"], "report.pdf")).toBe(
      "report (4).pdf"
    );
  });

  it("is case-insensitive", () => {
    expect(nextAvailableName(["REPORT.PDF"], "report.pdf")).toBe("report (2).pdf");
  });

  it("handles names with no extension", () => {
    expect(nextAvailableName(["README"], "README")).toBe("README (2)");
  });

  it("treats a leading dot as part of the base, not an extension", () => {
    expect(nextAvailableName([".env"], ".env")).toBe(".env (2)");
  });

  it("keeps a multi-part extension intact", () => {
    expect(nextAvailableName(["archive.tar.gz"], "archive.tar.gz")).toBe("archive.tar (2).gz");
  });
});

describe("isDescendant", () => {
  const nodes: DocTreeNode[] = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "other", parentId: "root" }
  ];

  it("finds a direct child", () => {
    expect(isDescendant(nodes, "a", "root")).toBe(true);
  });

  it("finds a deep descendant", () => {
    expect(isDescendant(nodes, "c", "a")).toBe(true);
  });

  it("is false for a sibling / unrelated node", () => {
    expect(isDescendant(nodes, "other", "a")).toBe(false);
  });

  it("is false for an ancestor (wrong direction)", () => {
    expect(isDescendant(nodes, "a", "c")).toBe(false);
  });

  it("does not hang on a pre-existing cycle in the data", () => {
    const cyclic: DocTreeNode[] = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" }
    ];
    expect(isDescendant(cyclic, "x", "z")).toBe(false);
  });
});

describe("isValidDocumentName", () => {
  it("accepts ordinary names", () => {
    expect(isValidDocumentName("Отчёт за 2026 год.pdf")).toBe(true);
    expect(isValidDocumentName("my-notes_v2")).toBe(true);
  });

  it("rejects forbidden characters", () => {
    for (const ch of ['<', '>', ':', '"', "/", "\\", "|", "?", "*"]) {
      expect(isValidDocumentName(`a${ch}b`)).toBe(false);
    }
  });

  it("rejects reserved Windows device names", () => {
    expect(isValidDocumentName("CON")).toBe(false);
    expect(isValidDocumentName("nul.txt")).toBe(false);
    expect(isValidDocumentName("COM1")).toBe(false);
  });

  it("rejects a trailing dot or space", () => {
    expect(isValidDocumentName("folder.")).toBe(false);
    expect(isValidDocumentName("folder ")).toBe(false);
  });

  it("rejects empty and dot names", () => {
    expect(isValidDocumentName("")).toBe(false);
    expect(isValidDocumentName("   ")).toBe(false);
    expect(isValidDocumentName("..")).toBe(false);
  });
});

describe("sanitizeSegment", () => {
  it("replaces forbidden characters with underscore", () => {
    expect(sanitizeSegment("re:port?.pdf")).toBe("re_port_.pdf");
  });

  it("trims trailing dots and spaces", () => {
    expect(sanitizeSegment("folder.  ")).toBe("folder");
  });

  it("prefixes reserved names", () => {
    expect(sanitizeSegment("CON")).toBe("_CON");
  });

  it("never returns an empty string", () => {
    expect(sanitizeSegment("///")).toBe("___");
    expect(sanitizeSegment("   ")).toBe("file");
  });
});
