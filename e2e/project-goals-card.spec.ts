import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Goals on a project's page (plugin projects-goals): which goal the project leads to, link and unlink from the project. */
test("a project shows the goals it leads to and links to a goal right from its overview", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "project-goals-card");
  const seeded = await seedProjects(request, account);
  await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
  const goal = (await (await request.post(`${seeded.base}/goals`, { headers: seeded.headers, data: { title: "Отдохнуть летом" } })).json()) as { id: string };
  await request.post(`${seeded.base}/goals`, { headers: seeded.headers, data: { title: "Запустить сайт" } });

  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true }).click();

  const card = page.getByRole("region", { name: "Цели проекта", exact: true });
  await expect(card).toContainText("Проект пока не ведёт ни к одной цели.");
  await card.getByRole("combobox", { name: "Цель для проекта", exact: true }).selectOption({ label: "Отдохнуть летом" });
  await card.getByRole("button", { name: "Привязать", exact: true }).click();
  await expect(card.getByRole("button", { name: "Отдохнуть летом", exact: true })).toBeVisible();
  await expect(card).toContainText("единственный проект этой цели");

  const goals = (await (await request.get(`${seeded.base}/goals`, { headers: seeded.headers })).json()) as Array<{ id: string; plans: Array<{ projectId: string }> }>;
  expect(goals.find((item) => item.id === goal.id)?.plans.map((plan) => plan.projectId)).toEqual([seeded.trip.id]);

  await card.getByRole("button", { name: "Отвязать от цели «Отдохнуть летом»", exact: true }).click();
  await expect(card).toContainText("Проект пока не ведёт ни к одной цели.");
});
