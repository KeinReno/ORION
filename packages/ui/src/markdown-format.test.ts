import { describe, expect, it } from "vitest";
import { applyFormat, type FormatCommand, type FormatResult } from "./markdown-format";

/** Apply a result the way the editor does, so tests read as before → after. */
function run(doc: string, from: number, to: number, command: FormatCommand): { text: string; selected: string } {
  const r: FormatResult = applyFormat(doc, { from, to }, command);
  const text = doc.slice(0, r.from) + r.insert + doc.slice(r.to);
  return { text, selected: text.slice(r.anchor, r.head) };
}

describe("inline formatting", () => {
  it("wraps the selection and keeps the inner text selected", () => {
    expect(run("hello world", 6, 11, "bold")).toEqual({ text: "hello **world**", selected: "world" });
    expect(run("hello world", 0, 5, "italic")).toEqual({ text: "_hello_ world", selected: "hello" });
    expect(run("x", 0, 1, "strike")).toEqual({ text: "~~x~~", selected: "x" });
    expect(run("run it", 0, 3, "code")).toEqual({ text: "`run` it", selected: "run" });
  });

  it("opens an empty pair with the caret between when nothing is selected", () => {
    const r = applyFormat("ab", { from: 1, to: 1 }, "bold");
    expect(r.insert).toBe("****");
    expect(r.anchor).toBe(3);
    expect(r.head).toBe(3);
  });

  it("toggles off when the markers sit outside the selection", () => {
    expect(run("a **word** b", 4, 8, "bold")).toEqual({ text: "a word b", selected: "word" });
  });

  it("toggles off when the selection includes the markers", () => {
    expect(run("a **word** b", 2, 10, "bold")).toEqual({ text: "a word b", selected: "word" });
  });

  it("does not mistake bold for italic", () => {
    // Italic uses `_`, so a bold word is not "already italic" and gets wrapped.
    expect(run("**word**", 2, 6, "italic").text).toBe("**_word_**");
  });

  it("clamps a selection that points past the document", () => {
    expect(run("ab", 0, 99, "bold").text).toBe("**ab**");
  });
});

describe("links", () => {
  it("turns the selection into the label and selects the URL placeholder", () => {
    expect(run("see docs now", 4, 8, "link")).toEqual({ text: "see [docs](https://) now", selected: "https://" });
  });

  it("inserts a template with the label selected when nothing is selected", () => {
    expect(run("", 0, 0, "link")).toEqual({ text: "[текст](https://)", selected: "текст" });
  });
});

describe("line formatting", () => {
  it("sets and toggles a heading level on the current line", () => {
    expect(run("Title", 2, 2, "h2").text).toBe("## Title");
    expect(run("## Title", 3, 3, "h2").text).toBe("Title");
    // A different level replaces, not stacks.
    expect(run("# Title", 3, 3, "h3").text).toBe("### Title");
  });

  it("does not treat a deeper heading as already being the shallower one", () => {
    expect(run("### Title", 4, 4, "h2").text).toBe("## Title");
  });

  it("formats every selected line and skips blank ones", () => {
    expect(run("a\n\nb", 0, 4, "bullet").text).toBe("- a\n\n- b");
  });

  it("numbers an ordered list from 1 across the selected lines", () => {
    expect(run("one\ntwo\nthree", 0, 13, "ordered").text).toBe("1. one\n2. two\n3. three");
  });

  it("toggles a list off, and switching list kinds replaces the marker", () => {
    expect(run("- a\n- b", 0, 7, "bullet").text).toBe("a\nb");
    expect(run("- a\n- b", 0, 7, "ordered").text).toBe("1. a\n2. b");
    expect(run("1. a", 0, 4, "task").text).toBe("- [ ] a");
  });

  it("keeps indentation of nested items", () => {
    expect(run("- a\n  - b", 0, 9, "task").text).toBe("- [ ] a\n  - [ ] b");
  });

  it("quotes and unquotes", () => {
    expect(run("note", 0, 4, "quote").text).toBe("> note");
    expect(run("> note", 0, 6, "quote").text).toBe("note");
  });

  it("stays on one line when the selection ends right after a newline", () => {
    expect(run("a\nb", 0, 2, "bullet").text).toBe("- a\nb");
  });

  it("only touches the lines of the selection, not the rest of the document", () => {
    expect(run("keep\nchange\nkeep", 5, 11, "quote").text).toBe("keep\n> change\nkeep");
  });
});

describe("code block", () => {
  it("fences the selected lines and unfences them again", () => {
    const fenced = run("a\nb", 0, 3, "codeblock");
    expect(fenced.text).toBe("```\na\nb\n```");
    expect(fenced.selected).toBe("a\nb");
    expect(run("```\na\nb\n```", 0, 11, "codeblock").text).toBe("a\nb");
  });

  it("puts the caret inside the fence on an empty line", () => {
    const r = applyFormat("", { from: 0, to: 0 }, "codeblock");
    expect(r.insert).toBe("```\n\n```");
    expect(r.anchor).toBe(4);
  });
});
