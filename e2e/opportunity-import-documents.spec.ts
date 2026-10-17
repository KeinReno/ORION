import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import JSZip from "jszip";
import { apiUrl, register, signIn, type Account } from "./support";

/**
 * R0.2: импорт PDF/DOCX/RTF/DOC и большого пакета через настоящий интерфейс. Файлы синтетические и создаются на лету.
 */

const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
const base = (account: Account) => `${apiUrl()}/workspaces/${account.workspaceId}`;

async function enable(request: APIRequestContext, account: Account): Promise<void> {
  for (const id of ["opportunities-profiles", "opportunities-hh-import"]) {
    const response = await request.patch(`${base(account)}/plugins/${id}`, { headers: auth(account), data: { enabled: true } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

function makePdf(lines: string[]): Buffer {
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
  return Buffer.from(pdf);
}

async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(120)]);

async function openImport(page: import("@playwright/test").Page, account: Account): Promise<void> {
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Импорт HH" }).click();
  await expect(page.getByText("Выбор данных")).toBeVisible();
}

test("PDF/DOCX/RTF are imported as resume versions; DOC, protected, corrupt and empty files are reported, not faked", async ({ page, request }) => {
  const account = await register(request, "import-docs");
  await enable(request, account);
  const root = mkdtempSync(join(tmpdir(), "hub-docs-"));
  try {
    const candidate = join(root, "Иван");
    mkdirSync(join(candidate, "Резюме"), { recursive: true });
    mkdirSync(join(candidate, "Cover_Letters"), { recursive: true });
    writeFileSync(join(candidate, "Резюме", "Аналитик.pdf"), makePdf(["Synthetic Analyst", "SQL BPMN"]));
    writeFileSync(join(candidate, "Резюме", "Менеджер.docx"), await makeDocx(["Синтетический менеджер", "Scrum"]));
    writeFileSync(join(candidate, "Резюме", "Старое.rtf"), String.raw`{\rtf1\ansi Old resume\par Line two}`);
    writeFileSync(join(candidate, "Резюме", "Двоичное.doc"), OLE);
    writeFileSync(join(candidate, "Резюме", "Битое.pdf"), "это не PDF");
    writeFileSync(join(candidate, "Резюме", "Пустое.docx"), await makeDocx([]));
    writeFileSync(join(candidate, "Резюме", "Скрипт.py"), "print('must never run')");
    writeFileSync(join(candidate, "Cover_Letters", "Письмо.docx"), await makeDocx(["Здравствуйте, синтетическое письмо"]));

    await signIn(page, account);
    await openImport(page, account);
    await page.locator('input[type="file"]').first().setInputFiles(candidate);
    await page.getByLabel(/Добавить профили и версии материалов/).check();
    await page.getByLabel(/Разрешаю сохранить выбранные материалы/).check();
    await page.getByRole("button", { name: "Подготовить предпросмотр" }).click();

    const report = page.getByRole("region", { name: "Предпросмотр импорта" });
    await expect(report.getByText("материалов: 4")).toBeVisible();
    await expect(report.getByText("Формат не поддерживается (1)")).toBeVisible();
    await expect(report.getByText("Повреждён (1)")).toBeVisible();
    await expect(report.getByText("Нет текста (1)")).toBeVisible();
    await expect(report.getByText(/Двоичное\.doc.*DOCX/)).toBeVisible();
    await report.getByRole("button", { name: "Сохранить выбранные данные" }).click();
    await expect(report.getByRole("heading", { name: /Импорт завершён/ })).toBeVisible();

    const profiles = (await (await request.get(`${base(account)}/opportunity-profiles`, { headers: auth(account) })).json()) as { items: { id: string; displayName: string }[] };
    expect(profiles.items.map((p) => p.displayName)).toEqual(["Иван"]);
    const materials = (await (await request.get(`${base(account)}/opportunity-profiles/${profiles.items[0].id}/materials`, { headers: auth(account) })).json()) as { items: { id: string; title: string; type: string }[] };
    expect(materials.items.map((m) => `${m.title}:${m.type}`).sort()).toEqual(["Аналитик:resume", "Менеджер:resume", "Письмо:proposal", "Старое:resume"]);
    const byTitle = (title: string) => materials.items.find((m) => m.title === title)!.id;
    const text = async (title: string) => ((await (await request.get(`${base(account)}/opportunity-profiles/${profiles.items[0].id}/materials/${byTitle(title)}`, { headers: auth(account) })).json()) as { content: string }).content;
    expect(await text("Аналитик")).toContain("Synthetic Analyst");
    expect(await text("Менеджер")).toBe("Синтетический менеджер\nScrum");
    expect(await text("Старое")).toBe("Old resume\nLine two");
    // ничего не подтверждено автоматически
    const detail = (await (await request.get(`${base(account)}/opportunity-profiles/${profiles.items[0].id}`, { headers: auth(account) })).json()) as { facts: unknown[]; activeResumeMaterialId: string | null };
    expect(detail.facts).toEqual([]); expect(detail.activeResumeMaterialId).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a package of 450 files is split into parts, applied in order and re-import creates no duplicates", async ({ page, request }) => {
  test.setTimeout(240000);
  const account = await register(request, "import-big");
  await enable(request, account);
  const root = mkdtempSync(join(tmpdir(), "hub-big-"));
  try {
    const folder = join(root, "Мария", "Резюме");
    mkdirSync(folder, { recursive: true });
    for (let i = 0; i < 450; i += 1) writeFileSync(join(folder, `v${String(i).padStart(3, "0")}.md`), `Синтетическое резюме номер ${i}\n`);
    await signIn(page, account);
    await openImport(page, account);
    await page.locator('input[type="file"]').first().setInputFiles(join(root, "Мария"));
    await expect(page.getByText(/Выбрано поддерживаемых файлов: 450/)).toBeVisible();
    await page.getByLabel(/Добавить профили и версии материалов/).check();
    await page.getByLabel(/Разрешаю сохранить выбранные материалы/).check();
    await page.getByRole("button", { name: "Подготовить предпросмотр" }).click();
    const report = page.getByRole("region", { name: "Предпросмотр импорта" });
    await expect(report.getByRole("heading", { name: /частей: 3/ })).toBeVisible();
    await expect(report.getByText("материалов: 450")).toBeVisible();
    await report.getByRole("button", { name: "Сохранить все части" }).click();
    await expect(report.getByRole("heading", { name: /Импорт завершён/ })).toBeVisible({ timeout: 120000 });
    await expect(report.getByText(/новых версий: 450/)).toBeVisible();

    // повторный импорт того же пакета: ни одной новой версии
    await page.reload();
    await page.getByRole("button", { name: "Импорт HH" }).click();
    await page.locator('input[type="file"]').first().setInputFiles(join(root, "Мария"));
    await page.getByLabel(/Добавить профили и версии материалов/).check();
    await page.getByLabel(/Разрешаю сохранить выбранные материалы/).check();
    await page.getByRole("button", { name: "Подготовить предпросмотр" }).click();
    await page.getByRole("button", { name: "Сохранить все части" }).click();
    await expect(page.getByRole("heading", { name: /Импорт завершён/ })).toBeVisible({ timeout: 120000 });
    await expect(page.getByText(/новых версий: 0/)).toBeVisible();

    const profiles = (await (await request.get(`${base(account)}/opportunity-profiles`, { headers: auth(account) })).json()) as { items: { id: string }[] };
    expect(profiles.items).toHaveLength(1);
    let total = 0; let cursor: string | null = null;
    do {
      const url: string = `${base(account)}/opportunity-profiles/${profiles.items[0].id}/materials${cursor ? `?cursor=${cursor}` : ""}`;
      const page2 = (await (await request.get(url, { headers: auth(account) })).json()) as { items: unknown[]; nextCursor: string | null };
      total += page2.items.length; cursor = page2.nextCursor;
    } while (cursor);
    expect(total).toBe(450);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
