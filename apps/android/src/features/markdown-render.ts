import MarkdownIt from "markdown-it";
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Offline preview never creates navigation or resource-fetching elements.
markdown.renderer.rules.link_open = () => "";
markdown.renderer.rules.link_close = () => "";
markdown.renderer.rules.image = (tokens, index) => `[Изображение: ${markdown.utils.escapeHtml(tokens[index].content || "без описания")}]`;
export function previewMarkdown(source: string) { return markdown.render(source); }
