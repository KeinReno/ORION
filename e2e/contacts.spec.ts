import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

interface ContactRow {
  name: string;
  note: string;
  role: string;
  tags: string[];
  favorite: boolean;
  phones: { label: string; value: string }[];
  birthday: string | null;
  archivedAt: string | null;
  lastContactedAt: string | null;
}

/** Module «Контакты» through the real UI: create with a phone and a tag, find, edit, log a call, favourite, archive. */
for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`a contact is created, found, edited, logged and archived from its card (${reducedMotion})`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const account = await register(request, "contacts");
    await signIn(page, account);
    await page.goto(`/panel/contacts?workspaceId=${account.workspaceId}`);
    const list = async (): Promise<ContactRow[]> =>
      (await (await request.get(`${apiUrl()}/workspaces/${account.workspaceId}/contacts`, { headers: { Authorization: `Bearer ${account.accessToken}` } })).json()) as ContactRow[];

    await page.getByRole("button", { name: "Новый контакт" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Новый контакт" });
    await dialog.getByLabel("Имя", { exact: true }).fill("Иван Петров");
    await dialog.getByLabel("Кто это / должность").fill("сантехник");
    await dialog.getByRole("button", { name: "Телефон", exact: true }).click();
    await dialog.getByLabel("Телефоны: метка").fill("мобильный");
    await dialog.getByLabel("Телефоны: значение").fill("+7 (900) 123-45-67");
    await dialog.getByLabel("Новый тег").fill("подрядчики");
    await dialog.getByLabel("Новый тег").press("Enter");
    await dialog.getByRole("button", { name: "Добавить" }).click();

    // The new contact opens in its card right away, read-first.
    const card = page.getByRole("dialog", { name: "Иван Петров" });
    await expect(card.getByRole("link", { name: "+7 (900) 123-45-67" })).toBeVisible();
    await card.getByRole("button", { name: "Изменить" }).click();
    await card.getByLabel("Заметка").fill("только по будням");
    await card.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Контакт сохранён")).toBeVisible();
    await expect(card.getByText("только по будням")).toBeVisible();

    // Journal: a logged call becomes the last contact.
    await card.getByRole("tab", { name: "Общение" }).click();
    await card.getByLabel("Заметка об общении").fill("обсудили кран");
    await card.getByRole("button", { name: "Записать" }).click();
    await expect(card.getByText("обсудили кран")).toBeVisible();
    await expect(card.getByText("Последнее общение: сегодня")).toBeVisible();

    // Links tab carries the shared links block.
    await card.getByRole("tab", { name: "Связи" }).click();
    await expect(card.getByText("Связанные записи")).toBeVisible();

    await card.getByRole("tab", { name: "Профиль" }).click();
    await card.getByRole("button", { name: "В избранное" }).click();
    await expect.poll(async () => (await list())[0]?.favorite).toBe(true);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);

    // Interrupt the shared tab pill's layout animation with both dismissal paths.
    // The sheet must release presence, not leave an invisible backdrop indefinitely.
    for (const close of ["escape", "button"] as const) {
      await page.getByRole("button", { name: "Открыть контакт Иван Петров" }).click();
      await card.getByRole("tab", { name: "Общение" }).click();
      await card.getByRole("tab", { name: "Профиль" }).click();
      if (close === "escape") await page.keyboard.press("Escape");
      else await card.getByRole("button", { name: "Закрыть", exact: true }).click();
      await expect(card).toHaveCount(0);
    }

    // Search by phone digits and by tag; a miss shows the empty state.
    await page.getByLabel("Поиск по контактам").fill("900 123");
    await expect(page.getByRole("button", { name: "Открыть контакт Иван Петров" })).toBeVisible();
    await page.getByLabel("Поиск по контактам").fill("");
    await page.getByRole("button", { name: /^подрядчики/ }).click();
    await expect(page.getByRole("button", { name: "Открыть контакт Иван Петров" })).toBeVisible();
    await testInfo.attach("contact-list-after-dismissal", {
      body: await page.screenshot({ path: testInfo.outputPath("contact-list-after-dismissal.png") }), contentType: "image/png"
    });
    await page.getByLabel("Поиск по контактам").fill("электрик");
    await expect(page.getByText("Ничего не нашлось")).toBeVisible();
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();

    // Archive moves it to the archive list.
    await page.getByRole("button", { name: "Открыть контакт Иван Петров" }).click();
    await page.getByRole("dialog", { name: "Иван Петров" }).getByRole("button", { name: "В архив" }).click();
    await expect.poll(async () => (await list())[0]?.archivedAt).not.toBeNull();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);

    const [contact] = await list();
    expect(contact).toMatchObject({ name: "Иван Петров", role: "сантехник", note: "только по будням", tags: ["подрядчики"], favorite: true });
    expect(contact?.phones).toEqual([{ label: "мобильный", value: "+7 (900) 123-45-67" }]);
    expect(contact?.lastContactedAt).not.toBeNull();
  });
}

/** Import of a vCard: the file is parsed in the browser, duplicates of existing contacts are skipped. */
test("contacts are imported from a vCard file without repeating an existing one", async ({ page, request }) => {
  const account = await register(request, "contacts-import");
  await signIn(page, account);
  await request.post(`${apiUrl()}/workspaces/${account.workspaceId}/contacts`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    data: { name: "Мария Сидорова", phone: "+7 922 555-66-77" }
  });
  await page.goto(`/panel/contacts?workspaceId=${account.workspaceId}`);

  await page.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Импорт и экспорт" }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт и экспорт" });
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Мария С.",
    "TEL;TYPE=CELL:8 922 555-66-77",
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Олег Новиков",
    "ORG:Строй",
    "TEL;TYPE=WORK:+7 495 111-22-33",
    "BDAY:1985-12-01",
    "END:VCARD"
  ].join("\r\n");
  await dialog.getByLabel("Файл контактов").setInputFiles({ name: "contacts.vcf", mimeType: "text/vcard", buffer: Buffer.from(vcf, "utf8") });
  await expect(dialog.getByText("contacts.vcf: найдено 2")).toBeVisible();
  await dialog.getByRole("button", { name: "Импортировать 2" }).click();
  await expect(page.getByText("Импортировано: 1")).toBeVisible();

  const rows = (await (await request.get(`${apiUrl()}/workspaces/${account.workspaceId}/contacts`, { headers: { Authorization: `Bearer ${account.accessToken}` } })).json()) as ContactRow[];
  expect(rows.map((row) => row.name).sort()).toEqual(["Мария Сидорова", "Олег Новиков"]);
  expect(rows.find((row) => row.name === "Олег Новиков")?.birthday).toBe("1985-12-01");
});
