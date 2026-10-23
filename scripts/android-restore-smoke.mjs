// Browser UI evidence, not Android SAF/SQLite acceptance.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const output = process.env.ANDROID_SMOKE_OUTPUT || "test-results/android-restore";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark", acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:3180");

  const createTask = async (title) => {
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByLabel("Название", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  };
  await createTask("Задача из копии");
  await page.locator(".entry-main").filter({ hasText: "Задача из копии" }).click();
  await page.getByLabel("Новый пункт чек-листа").fill("Пункт из копии");
  await page.getByRole("button", { name: "Добавить пункт", exact: true }).click();
  await page.getByText("Выполнено 0 из 1", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Назад к списку, оставить черновик", exact: true }).click();
  await createTask("Удалится при замене");

  await page.getByRole("button", { name: "Финансы", exact: true }).click();
  await page.getByLabel("Сумма, ₽").fill("120,50");
  await page.getByRole("button", { name: "Кафе", exact: true }).click();
  await page.locator(".finance-details summary").click();
  await page.getByLabel(/Комментарий/).fill("Обед из копии");
  await page.getByRole("button", { name: "Записать расход", exact: true }).click();
  await page.getByRole("button", { name: "Изменить операцию: Обед из копии", exact: true }).waitFor();

  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("link", { name: /Данные и резервные копии/ }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить резервную копию", exact: true }).click();
  const backupPath = output + "/backup.json";
  await writeFile(backupPath, await readFile(await (await downloaded).path(), "utf8"));
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.local.tasks.length, 3);
  assert.equal(backup.local.finance.transactions.length, 1);

  // Damage the current data so a difference is visible after restore.
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByRole("button", { name: "Действия задачи: Удалится при замене", exact: true }).click();
  await page.getByRole("button", { name: "Удалить задачу…", exact: true }).click();
  await page.getByRole("button", { name: "Удалить задачу", exact: true }).click();
  await page.getByRole("button", { name: "Финансы", exact: true }).click();
  await page.getByRole("button", { name: "Удалить операцию: Обед из копии", exact: true }).click();
  await page.getByRole("button", { name: "Удалить операцию", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".finance-entries li").length === 0);

  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("link", { name: /Данные и резервные копии/ }).click();
  const invalidPath = output + "/invalid.json";
  await writeFile(invalidPath, JSON.stringify({ format: "something-else", version: 1 }));
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Выбрать файл копии", exact: true }).click();
  await (await chooser).setFiles(invalidPath);
  await page.getByRole("alert").filter({ hasText: "не похож на резервную копию" }).waitFor();
  assert.equal(await page.locator(".restore-preview").count(), 0, "invalid file never reaches the preview");

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Выбрать файл копии", exact: true }).click();
  await (await chooser).setFiles(backupPath);
  await page.locator(".restore-preview").waitFor();
  await page.getByText("backup.json", { exact: true }).waitFor();
  const facts = await page.locator(".restore-preview .settings-facts").innerText();
  assert.match(facts, /Задачи\s*3/);
  assert.match(facts, /Финансовые операции\s*1/);
  await page.screenshot({ path: output + "/restore-preview.png", fullPage: true });

  await page.getByRole("radio", { name: "Заменить записи", exact: true }).check();
  await page.getByRole("button", { name: "Заменить записи…", exact: true }).click();
  await page.getByText("Заменить текущие записи содержимым файла?", { exact: true }).waitFor();
  await page.screenshot({ path: output + "/restore-confirm.png", fullPage: true });
  await page.getByRole("button", { name: "Заменить записи", exact: true }).click();
  await page.getByText(/Записи заменены содержимым файла/).waitFor();

  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByText("Задача из копии", { exact: true }).waitFor();
  await page.getByText(/Чек-лист 0\/1/).waitFor();
  await page.getByText("Удалится при замене", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Финансы", exact: true }).click();
  await page.getByRole("button", { name: "Изменить операцию: Обед из копии", exact: true }).waitFor();

  await page.reload();
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByText("Задача из копии", { exact: true }).waitFor();
  await page.getByText(/Чек-лист 0\/1/).waitFor();

  // Merge only the missing records: delete the restored parent (cascades its checklist) and add a phone-only task.
  await page.getByRole("button", { name: "Действия задачи: Задача из копии", exact: true }).click();
  await page.getByRole("button", { name: "Удалить задачу…", exact: true }).click();
  await page.getByRole("button", { name: "Удалить задачу", exact: true }).click();
  await page.getByText("Задача из копии", { exact: true }).waitFor({ state: "detached" });
  await createTask("Только на телефоне");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("link", { name: /Данные и резервные копии/ }).click();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Выбрать файл копии", exact: true }).click();
  await (await chooser).setFiles(backupPath);
  await page.getByRole("radio", { name: "Добавить недостающие", exact: true }).check();
  await page.screenshot({ path: output + "/restore-merge.png", fullPage: true });
  await page.getByRole("button", { name: "Добавить недостающие", exact: true }).click();
  await page.getByText(/Добавлено из копии/).waitFor();
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByText("Задача из копии", { exact: true }).waitFor();
  await page.getByText("Только на телефоне", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow after restore");
  await page.reload();
  await page.getByText("Только на телефоне", { exact: true }).waitFor();
  await page.getByText("Задача из копии", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: invalid file rejected before write, replace restores tasks/checklist/finance, merge adds only missing records, survives reload; browser only.");
} finally { await browser.close(); }
