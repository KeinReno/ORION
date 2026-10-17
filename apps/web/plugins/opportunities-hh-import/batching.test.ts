import { describe, expect, it } from "vitest";
import { PACKAGE_LIMITS, buildParts, checkPackageSize, groupWarnings, type PackagePart, type PickedFile } from "./batching";

const file = (path: string, text: string, size = text.length): PickedFile => ({ path, size, text: async () => text, bytes: async () => new TextEncoder().encode(text) });
const deps = { loadPdfjs: async () => { throw new Error("не нужен"); } };
async function collect(files: PickedFile[]): Promise<PackagePart[]> {
  const parts: PackagePart[] = [];
  for await (const part of buildParts(files, deps)) parts.push(part);
  return parts;
}

describe("разбиение пакета на части", () => {
  it("режет по числу файлов и по объёму текста, не теряя файлов и порядка", async () => {
    const many = Array.from({ length: 450 }, (_, i) => file(`HH/Иван/Резюме/r${i}.md`, `Резюме ${i}`));
    const parts = await collect(many);
    expect(parts.map((p) => p.files.length)).toEqual([200, 200, 50]);
    expect(parts.flatMap((p) => p.files.map((f) => f.path))).toEqual(many.map((f) => f.path));

    const big = Array.from({ length: 12 }, (_, i) => file(`HH/Иван/Резюме/b${i}.md`, "а".repeat(40000)));
    const bigParts = await collect(big);
    expect(bigParts.length).toBeGreaterThan(1);
    for (const part of bigParts) expect(part.files.reduce((s, f) => s + f.text.length, 0)).toBeLessThanOrEqual(PACKAGE_LIMITS.partChars);
  });

  it("неудачное извлечение уходит на сервер без текста, но с метаданными; слишком большой JSON отсекается локально", async () => {
    const parts = await collect([
      file("HH/Иван/Резюме/пусто.md", "   "),
      file("HH/Иван/Резюме/ok.md", "Текст"),
      file("vacancies_big.json", "[]", PACKAGE_LIMITS.maxJsonBytes + 1)
    ]);
    expect(parts).toHaveLength(1);
    const [empty, ok] = parts[0].files;
    expect(empty).toMatchObject({ text: "", extraction: { status: "empty" } });
    expect(ok).toMatchObject({ text: "Текст", extraction: { status: "ok" } });
    expect(parts[0].issues).toEqual([expect.objectContaining({ path: "vacancies_big.json", code: "too_large" })]);
  });

  it("ошибка чтения одного файла не роняет пакет", async () => {
    const broken: PickedFile = { path: "HH/Иван/Резюме/x.pdf", size: 10, text: async () => "", bytes: async () => { throw new Error("диск"); } };
    const parts = await collect([broken, file("HH/Иван/Резюме/y.md", "Текст")]);
    expect(parts[0].files[0].extraction?.status).toBe("corrupt");
    expect(parts[0].files[1].text).toBe("Текст");
  });

  it("останавливается по запросу и не читает остальные файлы", async () => {
    let read = 0;
    const files = Array.from({ length: 10 }, (_, i) => ({ ...file(`HH/Иван/Резюме/r${i}.md`, "x"), text: async () => { read += 1; return "x"; } }));
    let calls = 0;
    const out: PackagePart[] = [];
    for await (const part of buildParts(files, deps, () => calls++ >= 3)) out.push(part);
    expect(read).toBe(3); expect(out.flatMap((p) => p.files)).toHaveLength(3);
  });
});

describe("лимиты пакета и отчёт", () => {
  it("объясняет превышение до чтения", () => {
    expect(checkPackageSize([{ size: 10 }])).toBeNull();
    expect(checkPackageSize(Array.from({ length: PACKAGE_LIMITS.maxFiles + 1 }, () => ({ size: 1 })))).toContain("10000");
    expect(checkPackageSize([{ size: PACKAGE_LIMITS.maxTotalBytes + 1 }])).toContain("100");
  });
  it("группирует замечания по причинам", () => {
    const groups = groupWarnings([{ path: "a", reason: "r", code: "protected" }, { path: "b", reason: "r", code: "protected" }, { path: "c", reason: "r" }]);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["Защищён паролем", 2], ["Прочее", 1]]);
  });
});
