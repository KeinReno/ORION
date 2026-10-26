import { describe, expect, it } from "vitest";
import { createPublicationSchema, publicationContentSchema } from "@orion/shared-types";
import { publicationText } from "./publication-contracts";

describe("publication projection", () => {
  it("removes embedded dependencies without fetching them", () => {
    const text = publicationText("Visible\n[secret](https://host/private) ![image](attachment.png) [[private-id]]\n<!-- hidden -->\n<a href='file:///private'>label</a>\nhttps://host/secret\n![ref][asset]\n[asset]: /private/file.png");
    expect(text).toContain("Visible");
    for (const secret of ["private", "attachment.png", "hidden", "https://", "file://", "asset"]) expect(text).not.toContain(secret);
  });
  it("preserves ordinary prose and line breaks", () => {
    expect(publicationText("План:\n1. Сделать\n2. Проверить\n\nОбычный текст")).toBe("План:\n1. Сделать\n2. Проверить\n\nОбычный текст");
  });
  it("rejects source fields masquerading as public content", () => {
    expect(publicationContentSchema.safeParse({ title: "Public", text: "", sourceId: "private" }).success).toBe(false);
    expect(publicationContentSchema.safeParse({ title: "Public", text: "", attachments: [] }).success).toBe(false);
  });
  it("requires a reviewed preview and defaults to no text or editing authority", () => {
    const input = { workspaceId: "00000000-0000-4000-8000-000000000001", sourceWorkspaceId: "00000000-0000-4000-8000-000000000002", sourceId: "00000000-0000-4000-8000-000000000003", kind: "task" };
    expect(createPublicationSchema.safeParse(input).success).toBe(false);
    const parsed = createPublicationSchema.parse({ ...input, fingerprint: "a".repeat(64) });
    expect(parsed.includeText).toBe(false); expect(parsed.includeDueAt).toBe(false); expect(parsed.allowStatus).toBe(false);
  });
});
