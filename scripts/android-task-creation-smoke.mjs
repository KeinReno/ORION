import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out = process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha16/preview";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark" });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3180");
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  await page.getByLabel("Название", { exact: true }).fill("Поездка");
  const body = page.getByLabel("Описание", { exact: true });
  await body.fill("Подготовка к поездке\n\n- Документы\n- [x] Зарядка");
  await page.getByRole("button", { name: "Перенести строки из описания", exact: true }).click();
  await page.getByText("Выполнено 1 из 2. Сохранится вместе с задачей.", { exact: true }).waitFor();
  assert.equal(await body.inputValue(), "Подготовка к поездке", "only consumed list lines leave the description");
  assert.equal(await page.getByRole("button", { name: "Отметить пункт выполненным: Документы", exact: true }).getAttribute("aria-pressed"), "false");
  assert.equal(await page.getByRole("button", { name: "Вернуть пункт в работу: Зарядка", exact: true }).getAttribute("aria-pressed"), "true");

  await page.getByLabel("Новый пункт чек-листа").fill("Билеты");
  await page.getByRole("button", { name: "Добавить пункт", exact: true }).click();
  await page.getByText(/Выполнено 1 из 3/).waitFor();
  await page.getByLabel("Название пункта: Билеты").fill("Билеты на поезд");
  await page.getByRole("button", { name: "Отметить пункт выполненным: Документы", exact: true }).click();
  await page.getByText(/Выполнено 2 из 3/).waitFor();

  await page.getByRole("button", { name: "Удалить пункт из черновика: Билеты на поезд", exact: true }).click();
  await page.getByText("Пункт удалён из черновика.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  await page.getByLabel("Название пункта: Билеты на поезд").waitFor();

  await page.getByRole("button", { name: "Назад к списку, оставить черновик", exact: true }).click();
  await page.getByRole("button", { name: /Продолжить черновик/ }).click();
  await page.getByText(/Выполнено 2 из 3/).waitFor();
  assert.equal(await page.getByLabel("Название", { exact: true }).inputValue(), "Поездка");
  assert.equal(await body.inputValue(), "Подготовка к поездке", "the draft kept the trimmed description across screens");

  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "draft checklist and format bar reflow at 320px / 200% text");
  await page.screenshot({ path: out + "/task-draft-checklist-320-text200.png", fullPage: true });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });

  await body.click();
  await body.press("Control+a");
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  assert.equal(await body.inputValue(), "**Подготовка к поездке**");
  await page.screenshot({ path: out + "/task-format-bar.png", fullPage: true });
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  assert.equal(await body.inputValue(), "Подготовка к поездке", "tapping the same format removes it");

  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  await page.getByText(/Чек-лист 2\/3/).waitFor();
  await page.locator(".entry-main").filter({ hasText: "Поездка" }).click();
  await page.getByText(/Выполнено 2 из 3/).waitFor();
  await page.getByRole("button", { name: "Назад к списку, оставить черновик", exact: true }).click();
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();

  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find((node) => node.textContent === "Задачи");
    const range = document.createRange(); range.selectNodeContents(heading);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  const heading = await page.getByRole("heading", { name: "Задачи", exact: true }).boundingBox();
  assert.ok(heading);
  await page.mouse.move(heading.x + 20, heading.y + heading.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".gesture-root.quick-holding").count(), 1, "a held press locks native selection");
  const prevented = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y) ?? document.body;
    return !target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  }, { x: heading.x + 20, y: heading.y + heading.height / 2 });
  assert.equal(prevented, true, "native context menu is suppressed while holding");
  await page.locator(".quick-scrim").waitFor();
  assert.equal(await page.evaluate(() => getSelection().rangeCount), 0, "opening quick actions clears any started selection");
  await page.screenshot({ path: out + "/quick-actions-hold.png", fullPage: true });
  await page.mouse.up();
  assert.equal(await page.locator(".gesture-root.quick-holding").count(), 0, "releasing drops the selection lock");
  await page.getByRole("button", { name: "Отменить быстрые действия", exact: true }).click();

  await page.locator(".entry-main").filter({ hasText: "Поездка" }).click();
  await page.getByText("Предпросмотр Markdown", { exact: true }).click();
  const preview = page.locator(".markdown-body");
  await preview.waitFor();
  const previewBox = await preview.boundingBox();
  assert.ok(previewBox);
  await page.mouse.move(previewBox.x + 12, previewBox.y + 12);
  await page.mouse.down();
  await page.waitForTimeout(550);
  assert.equal(await page.locator(".quick-scrim").count(), 0, "text preview keeps its native selection");
  await page.mouse.up();

  const area = await body.boundingBox();
  assert.ok(area);
  await page.mouse.move(area.x + 16, area.y + 16);
  await page.mouse.down();
  await page.waitForTimeout(550);
  assert.equal(await page.locator(".quick-scrim").count(), 0, "the description field never starts quick actions");
  await page.mouse.up();

  assert.deepEqual(errors, []);
  console.log("PASS: staged checklist during task creation, text extraction, light Markdown formatting, 320px reflow and long-press selection lock; browser only.");
} finally { await browser.close(); }
