import { describe, expect, it } from "vitest";
import { classifyHhMaterialType, classifyHhPath, hhImportPreviewInputSchema } from "@orion/shared-types";
import { compileHhPlan } from "./hh-parser";

type FileInput = { path: string; text: string; extraction?: { format: "pdf" | "docx" | "rtf" | "doc" | "text" | "unknown"; status: "ok" | "empty" | "unsupported" | "corrupt" | "protected" | "too_large" | "timeout"; parser: string; reason: string } };
const input = (files: FileInput[], flags = {}) => hhImportPreviewInputSchema.parse({ files, acknowledgeWorkspaceVisibility: true, includeProfiles: true, ...flags });
const ok = (format: "pdf" | "docx" | "rtf", parser: string) => ({ format, status: "ok" as const, parser, reason: "" });

describe("документы кандидата в импорте", () => {
  it("классифицирует PDF/DOCX/DOC/RTF в папках материалов, но не произвольные документы", () => {
    for (const path of ["HH/Иван/Резюме/cv.pdf", "HH/Иван/Резюме/cv.docx", "HH/Иван/Резюме/cv.doc", "HH/Иван/Резюме/cv.rtf", "HH/Иван/Cover_Letters/letter.docx", "HH/Иван/Портфолио/work.pdf"]) expect(classifyHhPath(path)).toBe("resume");
    expect(classifyHhPath("HH/Иван/Прочее/notes.pdf")).toBe("unsupported");
    expect(classifyHhPath("HH/Иван/Резюме/payload.exe")).toBe("excluded");
    expect(classifyHhMaterialType("HH/Иван/Cover_Letters/a.docx")).toBe("proposal");
    expect(classifyHhMaterialType("HH/Иван/Портфолио/a.pdf")).toBe("portfolio");
    expect(classifyHhMaterialType("HH/Иван/Резюме/a.pdf")).toBe("resume");
  });

  it("принимает извлечённый текст, сохраняет тип материала и версию парсера", () => {
    const plan = compileHhPlan(input([
      { path: "HH/Иван/Резюме/Аналитик.pdf", text: "Бизнес-аналитик", extraction: ok("pdf", "pdfjs-dist@4.10.38") },
      { path: "HH/Иван/Cover_Letters/Письмо.docx", text: "Здравствуйте", extraction: ok("docx", "orion-docx-xml@1") },
      { path: "HH/Иван/Резюме/Старое.md", text: "Markdown" }
    ]));
    expect(plan.warnings).toEqual([]);
    const materials = plan.operations.flatMap((o) => (o.kind === "material" ? [o.data] : []));
    expect(materials.map((m) => [m.title, m.type, m.parser, m.candidateName])).toEqual([
      ["Аналитик", "resume", "pdfjs-dist@4.10.38", "Иван"],
      ["Письмо", "proposal", "orion-docx-xml@1", "Иван"],
      ["Старое", "resume", "text", "Иван"]
    ]);
    expect(new Set(materials.map((m) => m.profileSourceKey)).size).toBe(1);
  });

  it("неудачное извлечение попадает в отчёт с кодом и не создаёт материал", () => {
    const failures = ["empty", "unsupported", "corrupt", "protected", "too_large", "timeout"] as const;
    const plan = compileHhPlan(input(failures.map((status) => ({ path: `HH/Иван/Резюме/${status}.pdf`, text: "", extraction: { format: "pdf" as const, status, parser: "-", reason: `причина ${status}` } }))));
    expect(plan.operations).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toEqual([...failures]);
    expect(plan.warnings[0].reason).toContain("причина empty");
  });

  it("двоичный файл без метаданных извлечения не принимается (fail-closed)", () => {
    const plan = compileHhPlan(input([{ path: "HH/Иван/Резюме/cv.pdf", text: "%PDF-1.4 raw bytes" }]));
    expect(plan.operations).toEqual([]);
    expect(plan.warnings[0].code).toBe("extraction_missing");
  });

  it("не доверяет тексту с NUL и пустому тексту при статусе ok", () => {
    const plan = compileHhPlan(input([
      { path: "HH/Иван/Резюме/a.docx", text: "текст\u0000мусор", extraction: ok("docx", "orion-docx-xml@1") },
      { path: "HH/Иван/Резюме/b.docx", text: "   ", extraction: ok("docx", "orion-docx-xml@1") }
    ]));
    expect(plan.operations).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toEqual(["corrupt", "empty"]);
  });

  it("письма без папки кандидата не привязываются к имени папки «Cover_Letters»", () => {
    const plan = compileHhPlan(input([{ path: "Cover_Letters/Письмо.docx", text: "Текст", extraction: ok("docx", "orion-docx-xml@1") }]));
    expect(plan.operations).toEqual([]);
    expect(plan.warnings[0].code).toBe("no_owner");
  });
});
