/**
 * O01 spike — DOCX <-> Tiptap JSON codec.
 *
 * Design (see docs/HISTORY.md, O01):
 * office documents stay a plain Document/DocumentVersion; the editor model
 * (Tiptap JSON) only ever lives in client memory between "open" and "save".
 * There is no round-trip-safe DOCX <-> Tiptap-JSON library on npm, so the
 * path is composed from two single-direction libraries plus a small glue
 * layer that WE own (not an office engine — just a tree mapping):
 *
 *  - read:  mammoth (DOCX -> HTML, already a dependency of @orion/ui's
 *           read-only DocxView) -> @tiptap/html `generateJSON` (HTML ->
 *           ProseMirror/Tiptap JSON, using Tiptap's own DOM parser rules
 *           for the extensions we ship).
 *  - write: Tiptap JSON -> `docx` (npm package `docx`, write-only, this is
 *           the part we hand-map since `docx` has no HTML/JSON importer).
 *
 * Known, accepted loss (documented in 12-PROGRESS.md): mammoth maps DOCX
 * styles to a small, opinionated set of HTML tags (headings, paragraphs,
 * bold/italic/underline, lists, tables, images-as-data-URIs) and drops most
 * direct formatting (custom fonts, colors, precise spacing, headers/
 * footers, comments, track changes). Our extension set below mirrors what
 * mammoth actually emits, so nothing is silently swallowed by the parser
 * that mammoth already produced.
 */

import { generateJSON, generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
// v3 extension packages export named bindings (Table, TableRow, ...), not a
// default export like the older v2 packages this plan's reference docs
// describe — verified via `node -e "require('@tiptap/extension-table')"`.
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Image } from "@tiptap/extension-image";
import type { JSONContent } from "@tiptap/core";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType
} from "docx";

/**
 * Extension set shared by read (HTML -> JSON parsing rules) and write
 * (JSON -> HTML, only used internally by generateHTML if ever needed).
 * Kept intentionally close to mammoth's actual output surface — see file
 * header. Must match `docx-tiptap.ts`'s toolbar extension set eventually
 * (O04); this spike keeps its own copy so the codec has no UI dependency.
 */
export function officeDocExtensions() {
  return [
    StarterKit.configure({
      // StarterKit ships a `Link` history collab helpers we don't need for
      // the spike; keep defaults otherwise so parsing stays permissive.
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image
  ];
}

/**
 * DOCX bytes -> Tiptap JSON document, via mammoth's HTML output.
 * Throws on a file mammoth cannot parse at all (corrupt zip/XML); callers
 * (O03) are expected to catch this and fall back to read-only preview /
 * download, per 20-DOCUMENT-EDITORS.md "деградация до просмотра".
 */
export async function docxToTiptapJson(bytes: ArrayBuffer): Promise<JSONContent> {
  // mammoth's Node entrypoint (default `mammoth` import) works against a
  // Buffer/ArrayBuffer without a browser DOM, unlike its browser subpath
  // used client-side in @orion/ui's DocxView. The spike runs under Node
  // (vitest), so we use the Node entry here; O03's browser code will use
  // the browser subpath exactly like DocxView already does.
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({
    buffer: Buffer.from(bytes)
  } as unknown as { arrayBuffer: ArrayBuffer });

  // generateJSON needs a DOM (JSDOM under Node, real DOM in the browser).
  return generateJSON(html, officeDocExtensions());
}

/** Tiptap JSON -> HTML, exposed for tests/debugging of the read path. */
export function tiptapJsonToHtml(json: JSONContent): string {
  return generateHTML(json, officeDocExtensions());
}

/**
 * Browser counterpart of {@link docxToTiptapJson} — O04 (`OfficeEditor`/
 * `DocxEditor`) runs in a WebView/browser tab, not Node, so it cannot use
 * mammoth's Node entry (`buffer`-based, brings in Node-only internals).
 * Mirrors `@orion/ui`'s `DocxView` (`packages/ui/src/file-preview/docx-view.tsx`),
 * which already uses this exact browser subpath + `arrayBuffer` option for
 * read-only preview — same mammoth call, fed into the same
 * `officeDocExtensions()` parse rules as the Node path above so read-only
 * preview and the editor agree on what a DOCX "looks like" after parsing.
 * Throws on a file mammoth cannot parse at all; callers degrade to
 * read-only preview/download, per 20-DOCUMENT-EDITORS.md.
 */
export async function docxToTiptapJsonInBrowser(bytes: ArrayBuffer): Promise<JSONContent> {
  // mammoth ships type declarations for its main (Node) entry only; the
  // browser build exposes the same `convertToHtml` API — same cast as
  // `packages/ui/src/file-preview/docx-view.tsx`.
  // @ts-expect-error - no types for the browser subpath
  const mammoth = await import("mammoth/mammoth.browser");
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return generateJSON(html, officeDocExtensions());
}

type Mark = { type: string };
type Node = JSONContent;

function textRunsFromInline(nodes: Node[] | undefined): (TextRun | ImageRun)[] {
  if (!nodes) return [];
  const runs: (TextRun | ImageRun)[] = [];
  for (const n of nodes) {
    if (n.type === "image") {
      const result = imageRunFromNode(n);
      if (result instanceof ImageRun) runs.push(result);
      continue;
    }
    if (n.type === "text") {
      const marks: Mark[] = n.marks ?? [];
      runs.push(
        new TextRun({
          text: n.text ?? "",
          bold: marks.some((m) => m.type === "bold"),
          italics: marks.some((m) => m.type === "italic"),
          underline: marks.some((m) => m.type === "underline") ? {} : undefined,
          strike: marks.some((m) => m.type === "strike")
        })
      );
    } else if (n.type === "hardBreak") {
      runs.push(new TextRun({ text: "", break: 1 }));
    }
  }
  return runs;
}

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
};

/** Maps a data-URL MIME type to one of the raster types `ImageRun` accepts. */
function imageTypeFromMime(mime: string): "jpg" | "png" | "gif" | "bmp" | undefined {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  return undefined;
}

/** Reads a PNG/GIF/BMP/JPEG's pixel dimensions straight from its header bytes, no image-decoding library needed. */
function imageDimensionsFromBytes(bytes: Uint8Array, mime: string): { width: number; height: number } | undefined {
  try {
    if (mime === "image/png" && bytes.length >= 24) {
      // PNG: width/height are big-endian uint32 at offset 16/20 (after the
      // 8-byte signature + 4-byte length + 4-byte "IHDR" chunk type).
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === "image/gif" && bytes.length >= 10) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (mime === "image/bmp" && bytes.length >= 26) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    }
    if ((mime === "image/jpeg" || mime === "image/jpg") && bytes.length > 4) {
      // JPEG: walk markers until an SOFn (start-of-frame) segment, which
      // carries height/width as big-endian uint16 right after the marker's
      // own length+precision bytes.
      let offset = 2;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const segLength = view.getUint16(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + segLength;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Tiptap `image` node -> docx `ImageRun` (F04). Only `data:` URL sources are
 * supported (the shape `@tiptap/extension-image`'s default toolbar action
 * produces, and the only shape this editor's own Save round-trip can ever
 * feed back in — there is no separate media upload endpoint per
 * 21-OFFICE-IMPLEMENTATION.md). A remote `http(s):` `src` a hand-authored
 * document might contain is a documented, explicit gap (would need a fetch
 * at export time, is not what the editor itself produces) — such a node
 * degrades to a placeholder paragraph rather than being silently skipped,
 * so a save never quietly loses an image without any trace in the output.
 */
function imageRunFromNode(node: Node): ImageRun | Paragraph {
  const src = (node.attrs?.src as string | undefined) ?? "";
  const alt = (node.attrs?.alt as string | undefined) ?? "";
  const dataUrlMatch = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(src);
  if (!dataUrlMatch) {
    return new Paragraph({ children: [new TextRun({ text: alt ? `[изображение: ${alt}]` : "[изображение]" })] });
  }
  const [, mime, base64] = dataUrlMatch;
  const type = imageTypeFromMime(mime);
  if (!type) {
    return new Paragraph({ children: [new TextRun({ text: alt ? `[изображение: ${alt}]` : "[изображение]" })] });
  }
  const data = Buffer.from(base64, "base64");
  const attrWidth = typeof node.attrs?.width === "number" ? (node.attrs?.width as number) : undefined;
  const attrHeight = typeof node.attrs?.height === "number" ? (node.attrs?.height as number) : undefined;
  const natural = imageDimensionsFromBytes(new Uint8Array(data), mime);
  // Cap displayed size so a huge source photo doesn't blow out the page —
  // same idea as a browser's default `max-width: 100%` for inline images.
  const MAX_WIDTH = 480;
  let width = attrWidth ?? natural?.width ?? 300;
  let height = attrHeight ?? natural?.height ?? 200;
  if (!attrWidth && width > MAX_WIDTH && height > 0) {
    height = Math.round((height * MAX_WIDTH) / width);
    width = MAX_WIDTH;
  }
  return new ImageRun({
    type,
    data,
    transformation: { width, height },
    altText: { name: "image", description: alt, title: alt }
  });
}

/**
 * Cell merge lives on the Tiptap node (`colspan` / `rowspan`, integers >= 1).
 * Mammoth emits those HTML attributes and TableCell/TableHeader parse them
 * back into attrs, so a missing attr is an unmerged cell (span 1) — the
 * same document `docx` wrote before merge support. Only a span above 1 is
 * passed through: `columnSpan: 1` would still emit `w:gridSpan`.
 */
function cellSpan(node: Node, name: "colspan" | "rowspan"): number {
  const raw = node.attrs?.[name];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1) return 1;
  return value;
}

function docxTableFromNode(node: Node): DocxTable {
  const rows = (node.content ?? []).map((rowNode) => {
    const cells = (rowNode.content ?? []).map((cellNode) => {
      const cellBlocks = blocksFromNodes(cellNode.content ?? []);
      const columnSpan = cellSpan(cellNode, "colspan");
      const rowSpan = cellSpan(cellNode, "rowspan");
      return new DocxTableCell({
        children: cellBlocks.length ? cellBlocks : [new Paragraph({})],
        width: { size: 100 / (rowNode.content?.length || 1), type: WidthType.PERCENTAGE },
        ...(columnSpan > 1 ? { columnSpan } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {})
      });
    });
    return new DocxTableRow({ children: cells });
  });
  return new DocxTable({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** Converts a list of Tiptap block-level nodes into docx block elements. */
function blocksFromNodes(nodes: Node[]): Array<Paragraph | DocxTable> {
  const out: Array<Paragraph | DocxTable> = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        out.push(new Paragraph({ children: textRunsFromInline(node.content) }));
        break;
      case "heading": {
        const level = (node.attrs?.level as number) ?? 1;
        out.push(
          new Paragraph({
            heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_1,
            children: textRunsFromInline(node.content)
          })
        );
        break;
      }
      case "bulletList":
      case "orderedList": {
        for (const item of node.content ?? []) {
          // Each listItem wraps one or more paragraphs; flatten each
          // paragraph's inline text into its own bulleted/numbered line.
          for (const para of item.content ?? []) {
            out.push(
              new Paragraph({
                bullet: node.type === "bulletList" ? { level: 0 } : undefined,
                numbering: node.type === "orderedList" ? { reference: "office-spike-numbering", level: 0 } : undefined,
                children: textRunsFromInline(para.content)
              })
            );
          }
        }
        break;
      }
      case "table":
        out.push(docxTableFromNode(node));
        break;
      case "image": {
        const result = imageRunFromNode(node);
        out.push(result instanceof Paragraph ? result : new Paragraph({ children: [result] }));
        break;
      }
      case "blockquote":
        for (const inner of blocksFromNodes(node.content ?? [])) out.push(inner);
        break;
      default:
        // Unknown/unsupported block (e.g. codeBlock, image placement
        // details) — degrade to a plain paragraph with its text content so
        // nothing throws; acceptable loss documented in 12-PROGRESS.md.
        if (node.content) {
          out.push(new Paragraph({ children: textRunsFromInline(node.content) }));
        }
    }
  }
  return out;
}

/**
 * Tiptap JSON -> valid DOCX bytes via the `docx` package (write-only
 * library; this function is the hand-written JSON -> docx-object mapping
 * the plan calls for, not a from-scratch office engine).
 */
export async function tiptapJsonToDocx(json: JSONContent): Promise<Buffer> {
  const children = blocksFromNodes(json.content ?? []);
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "office-spike-numbering",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }]
        }
      ]
    },
    sections: [{ children: children.length ? children : [new Paragraph({})] }]
  });
  return Packer.toBuffer(doc);
}
