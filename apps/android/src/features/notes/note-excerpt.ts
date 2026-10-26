import MarkdownIt from "markdown-it";
const markdown = new MarkdownIt({ html: false, linkify: false });
/** Display-only: source Markdown and stored summary are never rewritten. */
export function noteExcerpt(source: string): string {
  const parts: string[] = [];
  for (const block of markdown.parse(source, {})) {
    if (block.type === "fence" || block.type === "code_block") parts.push(block.content);
    for (const token of block.children ?? []) {
      if (["text", "code_inline", "image"].includes(token.type)) parts.push(token.content);
      else if (token.type === "softbreak" || token.type === "hardbreak") parts.push(" ");
    }
    parts.push(" ");
  }
  return parts.join("").replace(/\s+/g, " ").trim().slice(0, 240);
}
