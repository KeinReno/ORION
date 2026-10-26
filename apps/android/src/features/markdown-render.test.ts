import { describe, expect, it } from "vitest";
import { previewMarkdown } from "./markdown-render";
import { orderNotes, orderTasks } from "./view-order";
import type { Task, Note } from "@orion/shared-types";
describe("mobile reading and ordering", () => {
  it("renders common Markdown without raw HTML, navigation or remote resources", () => {
    const html = previewMarkdown('# Заголовок\n**Текст**\n\n- пункт\n\n<script>alert(1)</script>\n\n![фото](https://example.com/pixel.png) [сайт](https://example.com)\n\n[опасно](javascript:alert(1))\n\n```html\n<img src=x onerror=alert(1)>\n```');
    expect(html).toContain("<h1>Заголовок</h1>"); expect(html).toContain("<strong>Текст</strong>"); expect(html).toContain("<li>пункт</li>");
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain("[Изображение: фото]");
    expect(html).not.toMatch(/<(script|img|a|iframe|object)\b/i);
  });
  it("keeps closed tasks last and pinned notes first without changing source order", () => {
    const tasks = [{id:"b",title:"Б",status:"todo",priority:"high",dueAt:null},{id:"a",title:"А",status:"todo",priority:"low",dueAt:"2026-11-02T12:00:00Z"},{id:"c",title:"В",status:"done",priority:"high",dueAt:"2026-10-01T12:00:00Z"}] as Task[];
    expect(orderTasks(tasks,"due").map(t=>t.id)).toEqual(["a","b","c"]);
    expect(orderTasks(tasks,"priority").map(t=>t.id)).toEqual(["b","a","c"]);
    expect(orderTasks(tasks,"title").map(t=>t.id)).toEqual(["a","b","c"]);
    expect(orderTasks(tasks,"manual")).toBe(tasks); expect(tasks[0].id).toBe("b");
    const notes = [{id:"a",title:"А",pinnedAt:null,createdAt:"2026-01-01",editedAt:"2026-03-01",updatedAt:"2026-12-01"},{id:"b",title:"Б",pinnedAt:"2026-01-01",createdAt:"2026-01-01",editedAt:null,updatedAt:"2026-01-01"},{id:"c",title:"В",pinnedAt:null,createdAt:"2026-02-01",editedAt:"2026-04-01",updatedAt:"2026-04-01"}] as Note[];
    expect(orderNotes(notes,"updated").map(n=>n.id)).toEqual(["b","c","a"]);
    expect(orderNotes(notes,"title").map(n=>n.id)).toEqual(["b","a","c"]);
    expect(orderNotes(notes,"created").map(n=>n.id)).toEqual(["b","c","a"]); expect(notes[0].id).toBe("a");
  });
});
