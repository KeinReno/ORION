import { describe, expect, it } from "vitest";
import { CHAT_ARCHIVE_MTIME_SKEW_MS, chatArchiveFileChanged } from "./chat-archive-mtime";

describe("chatArchiveFileChanged", () => {
  it("reads a file whose Windows mtime landed on the previous scan clock", () => {
    expect(chatArchiveFileChanged(1_000, 1_000)).toBe(true);
    expect(chatArchiveFileChanged(1_000, 1_000 + CHAT_ARCHIVE_MTIME_SKEW_MS - 1)).toBe(true);
  });

  it("skips a file that is older than the skew", () => {
    expect(chatArchiveFileChanged(1_000, 1_000 + CHAT_ARCHIVE_MTIME_SKEW_MS + 1)).toBe(false);
  });

  it("still reads a file written after the scan", () => {
    expect(chatArchiveFileChanged(5_000, 1_000)).toBe(true);
  });
});
