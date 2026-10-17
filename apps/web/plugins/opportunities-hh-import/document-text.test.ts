import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxXmlToText, extractDocumentText, rtfToText, sniffDocument, type DocumentInput, type ExtractionDeps, type PdfjsLike } from "./document-text";

const enc = (value: string) => new TextEncoder().encode(value);
function input(name: string, bytes: Uint8Array): DocumentInput {
  return { name, size: bytes.length, bytes: async () => bytes, text: async () => new TextDecoder().decode(bytes) };
}
const noPdf: ExtractionDeps = { loadPdfjs: async () => { throw new Error("pdfjs не нужен"); } };

async function makeDocx(paragraphs: string[], extra: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

/** Минимальный корректный PDF с одной страницей и стандартным шрифтом (ASCII-текст). */
function makePdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc(pdf);
}

describe("sniffDocument", () => {
  it("определяет формат по содержимому, а не по расширению", async () => {
    expect(sniffDocument(enc("%PDF-1.7 ..."))).toBe("pdf");
    expect(sniffDocument(await makeDocx(["x"]))).toBe("docx");
    expect(sniffDocument(enc("{\\rtf1\\ansi Hello}"))).toBe("rtf");
    expect(sniffDocument(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe("doc");
    expect(sniffDocument(enc("Просто текст"))).toBe("text");
    expect(sniffDocument(new Uint8Array([1, 2, 0, 3]))).toBe("unknown");
  });
});

describe("DOCX", () => {
  it("достаёт абзацы, табы и переводы строк; entities раскрываются; удалённые правки и инструкции полей не попадают", () => {
    const xml = `<w:body><w:p><w:r><w:t>Иван &amp; Ко</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>BA</w:t></w:r></w:p><w:p><w:r><w:t>Строка 1</w:t><w:br/><w:t>Строка 2</w:t></w:r><w:del><w:r><w:delText>секрет</w:delText></w:r></w:del><w:r><w:instrText> HYPERLINK "x" </w:instrText></w:r></w:p></w:body>`;
    const text = docxXmlToText(xml);
    expect(text).toBe("Иван & Ко\tBA\nСтрока 1\nСтрока 2");
    expect(text).not.toContain("секрет"); expect(text).not.toContain("HYPERLINK");
  });
  it("импортирует настоящий DOCX и пишет версию парсера", async () => {
    const result = await extractDocumentText(input("Аналитик.docx", await makeDocx(["Бизнес-аналитик", "SQL, BPMN"])), noPdf);
    expect(result).toMatchObject({ status: "ok", format: "docx", parser: "orion-docx-xml@1", text: "Бизнес-аналитик\nSQL, BPMN" });
  });
  it("пустой документ — empty, а не успех", async () => {
    const result = await extractDocumentText(input("a.docx", await makeDocx([])), noPdf);
    expect(result.status).toBe("empty"); expect(result.text).toBe("");
  });
  it("ZIP не от Word отклоняется как unsupported, повреждённый — corrupt", async () => {
    const zip = new JSZip(); zip.file("xl/workbook.xml", "<x/>");
    expect((await extractDocumentText(input("t.docx", await zip.generateAsync({ type: "uint8array" })), noPdf)).status).toBe("unsupported");
    const broken = (await makeDocx(["x"])).slice(0, 40);
    expect((await extractDocumentText(input("b.docx", broken), noPdf)).status).toBe("corrupt");
  });
  it("не исполняет макросы: vbaProject игнорируется, текст читается как данные", async () => {
    const result = await extractDocumentText(input("m.docx", await makeDocx(["Текст"], { "word/vbaProject.bin": "MACRO" })), noPdf);
    expect(result.status).toBe("ok"); expect(result.text).toBe("Текст");
  });
  it("распакованный документ сверх лимита отклоняется без чтения", async () => {
    const huge = "<w:p><w:r><w:t>" + "a".repeat(1024) + "</w:t></w:r></w:p>";
    const zip = new JSZip(); zip.file("word/document.xml", huge.repeat(21 * 1024));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect((await extractDocumentText(input("bomb.docx", bytes), noPdf)).status).toBe("too_large");
  });
  it("a forged ZIP size cannot bypass the actual inflated stream limit", async () => {
    const zip = new JSZip(); zip.file("word/document.xml", "a".repeat(21 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 28; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 1024, true); break; }
    }
    const result = await extractDocumentText(input("forged.docx", bytes), noPdf);
    expect(["corrupt", "too_large"]).toContain(result.status); expect(result.text).toBe("");
  });
});

describe("RTF", () => {
  it("decodes unescaped Windows-1251 bytes without corrupting Russian resume text", async () => {
    const bytes = new Uint8Array([...enc(String.raw`{\rtf1\ansi\ansicpg1251 `), 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x7d]);
    expect(await extractDocumentText(input("raw.rtf", bytes), noPdf)).toMatchObject({ status: "ok", text: "Привет" });
  });

  it("кириллица через \\'xx (cp1251) и \\uN, абзацы, пропуск служебных групп", async () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1251\deff0{\fonttbl{\f0 Arial;}}{\*\generator Word;}\pard \'c0\'ed\'e0\'eb\'e8\'f2\'e8\'ea\par \u1055?\u1088?\u1086?\u1092?\par}`;
    const result = await extractDocumentText(input("c.rtf", enc(rtf)), noPdf);
    expect(result).toMatchObject({ status: "ok", format: "rtf", parser: "orion-rtf@2" });
    expect(result.text).toBe("Аналитик\nПроф");
    expect(result.text).not.toContain("Arial"); expect(result.text).not.toContain("Word");
  });
  it(".doc с RTF внутри читается как RTF", async () => {
    const result = await extractDocumentText(input("old.doc", enc(String.raw`{\rtf1 Hello\par World}`)), noPdf);
    expect(result).toMatchObject({ status: "ok", format: "rtf", text: "Hello\nWorld" });
  });
  it("непарные скобки и пустой текст — не успех", async () => {
    expect(rtfToText(String.raw`{\rtf1 {Hello}`)).toBeNull();
    expect((await extractDocumentText(input("b.rtf", enc(String.raw`{\rtf1 {Hello}`)), noPdf)).status).toBe("corrupt");
    expect((await extractDocumentText(input("e.rtf", enc(String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}}`)), noPdf)).status).toBe("empty");
  });
  it("чрезмерная вложенность отклоняется", () => {
    expect(rtfToText(String.raw`{\rtf1 ` + "{".repeat(500) + "}".repeat(500) + "}")).toBeNull();
  });
});

describe("DOC (OLE) и прочие форматы", () => {
  const ole = (extra = new Uint8Array()) => { const b = new Uint8Array(64 + extra.length); b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); b.set(extra, 64); return b; };
  it("старый двоичный .doc честно не читается, текст не выдумывается", async () => {
    const result = await extractDocumentText(input("old.doc", ole()), noPdf);
    expect(result).toMatchObject({ status: "unsupported", format: "doc", text: "" });
    expect(result.reason).toContain("DOCX");
  });
  it("зашифрованный контейнер определяется как protected", async () => {
    const marker = new Uint8Array("EncryptedPackage".length * 2);
    [..."EncryptedPackage"].forEach((c, i) => { marker[i * 2] = c.charCodeAt(0); });
    expect((await extractDocumentText(input("p.docx", ole(marker)), noPdf)).status).toBe("protected");
  });
  it("расширение не совпадает с содержимым", async () => {
    expect((await extractDocumentText(input("fake.pdf", enc("просто текст")), noPdf)).status).toBe("corrupt");
    expect((await extractDocumentText(input("x.rtf", new Uint8Array([1, 0, 2, 0, 3])), noPdf)).status).toBe("unsupported");
  });
  it("пустой файл и слишком большой файл не читаются", async () => {
    expect((await extractDocumentText(input("z.docx", new Uint8Array()), noPdf)).status).toBe("empty");
    const big: DocumentInput = { name: "big.pdf", size: 26 * 1024 * 1024, bytes: async () => { throw new Error("не должно читаться"); }, text: async () => "" };
    expect((await extractDocumentText(big, noPdf)).status).toBe("too_large");
  });
  it("текстовые файлы: пустой, двоичный, обычный", async () => {
    expect((await extractDocumentText(input("a.md", enc("   ")), noPdf)).status).toBe("empty");
    expect((await extractDocumentText(input("a.txt", new Uint8Array([97, 0, 98])), noPdf)).status).toBe("corrupt");
    expect(await extractDocumentText(input("a.md", enc("\uFEFFРезюме")), noPdf)).toMatchObject({ status: "ok", text: "Резюме", parser: "text" });
  });
});

describe("PDF", () => {
  const real = async () => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike & { version: string };
    return { pdfjs, version: pdfjs.version };
  };
  it("читает текстовый слой настоящего PDF и пишет версию pdfjs", async () => {
    const result = await extractDocumentText(input("cv.pdf", makePdf(["Synthetic Candidate", "Skills: SQL BPMN"])), { loadPdfjs: real });
    expect(result.status).toBe("ok"); expect(result.format).toBe("pdf");
    expect(result.parser).toMatch(/^pdfjs-dist@\d/);
    expect(result.text).toContain("Synthetic Candidate"); expect(result.text).toContain("Skills: SQL BPMN");
  }, 30000);
  it("PDF без текста — empty с пояснением про скан", async () => {
    const result = await extractDocumentText(input("scan.pdf", makePdf([])), { loadPdfjs: real });
    expect(result.status).toBe("empty"); expect(result.reason).toContain("OCR");
  }, 30000);
  it("обрезанный PDF — corrupt", async () => {
    const result = await extractDocumentText(input("cut.pdf", makePdf(["Hello"]).slice(0, 25)), { loadPdfjs: real });
    expect(["corrupt", "empty"]).toContain(result.status);
    expect(result.status).not.toBe("ok");
  }, 30000);
  it("PasswordException \u2192 protected; зависание \u2192 timeout", async () => {
    const locked: PdfjsLike = { getDocument: () => ({ promise: Promise.reject(Object.assign(new Error("no password"), { name: "PasswordException" })), destroy: () => undefined }) };
    expect((await extractDocumentText(input("l.pdf", enc("%PDF-1.4 x")), { loadPdfjs: async () => ({ pdfjs: locked, version: "t" }) })).status).toBe("protected");
    const hang: PdfjsLike = { getDocument: () => ({ promise: new Promise(() => undefined), destroy: () => undefined }) };
    const result = await extractDocumentText(input("h.pdf", enc("%PDF-1.4 x")), { loadPdfjs: async () => ({ pdfjs: hang, version: "t" }), timeoutMs: 50 });
    expect(result.status).toBe("timeout");
  });
});
