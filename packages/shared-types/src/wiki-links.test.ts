import { describe, expect, it } from "vitest";
import { parseWikiLinks, wikiLinkTargets } from "./wiki-links";

// `[[wiki links]]` are parsed identically on the server (rebuilding the
// note_links index) and the client (autocomplete / preview), so the edges
// live here.

describe("parseWikiLinks", () => {
  it("pulls plain and aliased links in order", () => {
    expect(parseWikiLinks("see [[Alpha]] and [[Beta|the second]]")).toEqual([
      { target: "Alpha", alias: null },
      { target: "Beta", alias: "the second" }
    ]);
  });

  it("trims whitespace and drops links with an empty target", () => {
    expect(parseWikiLinks("[[  Spaced  ]] [[ Aliased | shown ]] [[|x]] [[   ]]")).toEqual([
      { target: "Spaced", alias: null },
      { target: "Aliased", alias: "shown" }
    ]);
  });

  it("ignores unterminated or nested brackets", () => {
    expect(parseWikiLinks("[[open only, [[a[b]] end")).toEqual([]);
  });
});

describe("wikiLinkTargets", () => {
  it("dedupes case-insensitively, keeping first-seen spelling and order", () => {
    expect(wikiLinkTargets("[[Note]] [[note]] [[Other]] [[NOTE]]")).toEqual(["Note", "Other"]);
  });

  it("is empty for text with no links", () => {
    expect(wikiLinkTargets("just prose, no links")).toEqual([]);
  });
});
