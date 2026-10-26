import { expect, it } from "vitest";
import { noteExcerpt } from "./note-excerpt";
it("shows readable Markdown previews while preserving source and meaningful code", () => {
  const source = "# План\n\n**Встреча** с [командой](https://example.test)\n\n```js\nconst total = 12;\n```";
  expect(noteExcerpt(source)).toBe("План Встреча с командой const total = 12;");
  expect(source).toContain("**Встреча**");
  expect(noteExcerpt("![Чек](https://example.test/x.png)\n\n- один\n- два")).toBe("Чек один два");
  expect(noteExcerpt("<img src=x onerror=alert(1)>")).toContain("<img"); // React renders it as text, never HTML.
  expect(noteExcerpt(" \n ")).toBe("");
});
