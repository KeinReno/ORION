import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

for (const pluginsOff of [false, true]) {
  test(`a doctor is selected and retained on a health appointment (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    const account = await register(request, "health-contact-reference");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    expect((await request.patch(`${base}/modules/health`, { headers, data: { enabled: true } })).ok()).toBe(true);
    const subjectResponse = await request.post(`${base}/health/subjects`, { headers, data: { kind: "member", name: "Пациент" } });
    expect(subjectResponse.ok()).toBe(true);
    const subject = await subjectResponse.json();
    const contactResponse = await request.post(`${base}/contacts`, { headers, data: { name: "Доктор проверок" } });
    expect(contactResponse.ok()).toBe(true);
    const contact = await contactResponse.json();
    await signIn(page, account);
    await page.goto(`/panel/health?workspaceId=${account.workspaceId}`);
    await page.getByRole("tab", { name: "Визиты", exact: true }).click();
    await page.getByRole("button", { name: "Новый визит", exact: true }).click();
    const form = page.locator("form").filter({ has: page.getByLabel("Визит", { exact: true }) });
    await form.getByLabel("Визит", { exact: true }).fill("Проверка связи с врачом");
    await form.getByLabel("Когда", { exact: true }).fill("2026-11-01T10:00");
    await form.getByLabel("Врач", { exact: true }).selectOption(contact.id);
    const appointmentsUrl = `${base}/health/subjects/${subject.id}/appointments`;
    const pending = page.waitForResponse(response => response.url() === appointmentsUrl && response.request().method() === "POST");
    await form.getByRole("button", { name: "Добавить", exact: true }).click();
    const response = await pending;
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ title: "Проверка связи с врачом", doctorContactId: contact.id });
    await expect(page.getByText("Проверка связи с врачом", { exact: true })).toBeVisible();
    const rows = await (await request.get(appointmentsUrl, { headers })).json();
    expect(rows).toEqual([expect.objectContaining({ doctorContactId: contact.id })]);
    await page.reload();
    await page.getByRole("tab", { name: "Визиты", exact: true }).click();
    await expect(page.getByText("Проверка связи с врачом", { exact: true })).toBeVisible();
  });
}
