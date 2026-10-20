import { expect, test } from "@playwright/test";
import { register, signIn, type Account } from "./support";

/**
 * «Питомцы» through the real UI: a pet is added, today's wellbeing is recorded (symptom + vomiting → status
 * «Плохо» is derived), the day shows up in the calendar and statistics, a MurHP backup file is imported (and the
 * repeat adds nothing), and the vet report downloads. Setup goes through the UI because the pet itself is the subject.
 */
const dayKey = (offset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

test("a pet's diary: record a day, see it in the calendar and stats, import MurHP, download the report", async ({ page, request }) => {
  const account: Account = await register(request, "pet-care");
  await signIn(page, account);
  await page.goto(`/panel/pet-care?workspaceId=${account.workspaceId}`);

  // Add the first pet.
  await page.getByRole("button", { name: "Новый питомец" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Имя").fill("Мурчик");
  await dialog.getByLabel("Порода").fill("Британец");
  await dialog.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText("Питомец добавлен")).toBeVisible();

  // Record today: vomiting twice → derived status «Плохо».
  await page.getByRole("button", { name: "Рвота", exact: true }).click();
  await page.getByLabel("Рвота, раз").fill("2");
  await page.getByRole("button", { name: "Сохранить день" }).click();
  await expect(page.getByText("День сохранён")).toBeVisible();
  await expect(page.getByRole("button", { name: /Плохо · авто/, pressed: true })).toBeVisible();

  // It survives a reload and is marked in the calendar.
  await page.reload();
  await expect(page.getByRole("button", { name: /Плохо · авто/, pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /: Плохо(,|$)/ })).toHaveCount(1);

  // Statistics count it.
  await page.getByRole("tab", { name: "Статистика" }).click();
  await expect(page.getByText("Плохих дней")).toBeVisible();
  await expect(page.getByText("Частота симптомов")).toBeVisible();

  // MurHP import: two days and an event; a repeat adds nothing.
  const backup = {
    app: "murhp",
    version: 1,
    exportedAt: new Date().toISOString(),
    cat: { name: "Кот", birthdate: "2020-05-17", breed: "Дворовый", weightKg: 5, vetContact: "+7 900", chronic: "", allergies: "курица", notes: "" },
    days: [
      { date: dayKey(-3), status: "good", statusAuto: true, vomitingCount: 0, weightKg: 5.1, symptoms: [] },
      { date: dayKey(-2), status: "bad", statusAuto: true, stool: "liquid", vomitingCount: 0, weightKg: 5.0, symptoms: [{ id: "diarrhea", severity: "moderate", count: 1, time: "", note: "" }] }
    ],
    events: [{ date: dayKey(-3), type: "food_change", title: "Новый корм", note: "" }]
  };
  await page.getByRole("tab", { name: "Профиль" }).click();
  await page.getByRole("button", { name: /Импортировать копию MurHP/ }).click();
  const importDialog = page.getByRole("dialog");
  await importDialog.getByLabel("Файл копии MurHP").setInputFiles({ name: "murhp.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(importDialog.getByText("2 дня, 1 событие")).toBeVisible();
  await importDialog.getByRole("button", { name: "Импортировать" }).click();
  await expect(importDialog.getByText("Добавлено дней: 2")).toBeVisible();
  await expect(importDialog.getByText(/Заполнено в профиле: .*аллергии/)).toBeVisible();
  await importDialog.getByRole("button", { name: "Готово" }).click();

  await page.getByRole("button", { name: /Импортировать копию MurHP/ }).click();
  await page.getByRole("dialog").getByLabel("Файл копии MurHP").setInputFiles({ name: "murhp.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать" }).click();
  await expect(page.getByRole("dialog").getByText(/Добавлено дней: 0, пропущено \(уже были\): 2/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Готово" }).click();

  // The imported event is listed, and the report offers the week with all three days.
  await page.getByRole("tab", { name: "События" }).click();
  await expect(page.getByText("Новый корм")).toBeVisible();
  await page.getByRole("tab", { name: "Отчёт" }).click();
  await expect(page.getByText("Отмечено дней: 3")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV по дням" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});
