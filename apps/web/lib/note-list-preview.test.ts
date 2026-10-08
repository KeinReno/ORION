import { describe, expect, it } from "vitest";
import { noteListPreview } from "./note-list-preview";

describe("noteListPreview", () => {
  it("shows headings, lists and links as readable text", () => {
    expect(noteListPreview("## Сегодня\n- [ ] **Созвон** с [[Северный ветер|клиентом]]\n- [смета](https://example.com)"))
      .toBe("Сегодня Созвон с клиентом смета");
  });

  it("skips fenced code and keeps underscores in ordinary words", () => {
    expect(noteListPreview("```js\nconst secret = 1;\n```\nФайл my_file.md и `код`"))
      .toBe("Файл my_file.md и код");
  });

  it("returns an empty excerpt when there is no readable text", () => {
    expect(noteListPreview("## \n---\n```\nconst x = 1\n```"))
      .toBe("");
  });
});
