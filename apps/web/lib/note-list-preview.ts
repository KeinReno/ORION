/** A readable list excerpt; the note's Markdown source remains untouched. */
export function noteListPreview(markdown: string, maxLength = 220): string {
  const parts: string[] = [];
  let length = 0;
  let fence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = null;
      continue;
    }
    if (fence || /^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) continue;

    const text = line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s{0,3}(?:>\s*)+/, "")
      .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/^\[[ xX]\]\s*/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/(\*\*|__|~~|`+)(.*?)\1/g, "$2")
      .replace(/(?<!\w)(\*|_)([^*_]+)\1(?!\w)/g, "$2")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) continue;
    parts.push(text);
    length += text.length + 1;
    if (length >= maxLength) break;
  }

  const preview = parts.join(" ");
  return preview.length > maxLength ? `${preview.slice(0, maxLength).trimEnd()}…` : preview;
}
