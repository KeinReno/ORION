import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

test("goals atlas connects constellations, projects and the compact route", async ({ page, request }) => {
  test.setTimeout(150_000);
  const account = await register(request, "goals-atlas");
  const seeded = await seedProjects(request, account);
  const goalResponse = await request.post(`${seeded.base}/goals`, { headers: seeded.headers, data: { title: "Отдохнуть летом" } });
  expect(goalResponse.ok()).toBe(true);
  const goal = await goalResponse.json() as { id: string };
  await request.post(`${seeded.base}/goals/${goal.id}/plans`, { headers: seeded.headers, data: { projectId: seeded.trip.id, weight: 1 } });
  const secondResponse = await request.post(`${seeded.base}/goals`, { headers: seeded.headers, data: { title: "Запустить сайт" } });
  const second = await secondResponse.json() as { id: string };
  await request.post(`${seeded.base}/goals/${second.id}/plans`, { headers: seeded.headers, data: { projectId: seeded.site.id, weight: 1 } });
  await request.post(`${seeded.base}/goals/${second.id}/plans`, { headers: seeded.headers, data: { projectId: seeded.trip.id, weight: 1 } });

  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Цели", exact: true }).click();
  await expect(page.getByText("Ваши созвездия")).toBeVisible();
  await expect(page.getByRole("button", { name: "Открыть созвездие «Отдохнуть летом»" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Поездка в Карелию.*%/ }).first()).toBeVisible();
  mkdirSync("tmp/goals-atlas", { recursive: true });
  await page.screenshot({ path: "tmp/goals-atlas/overview-1440.png" });

  await page.getByRole("button", { name: "Открыть созвездие «Отдохнуть летом»" }).click();
  await expect(page.getByRole("button", { name: "Изменить связи" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Маршрут к цели")).toBeVisible();
  await page.screenshot({ path: "tmp/goals-atlas/route-390.png" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Проекты", exact: true }).first().click();
  await page.getByRole("tab", { name: "По целям" }).click();
  await expect(page.getByRole("region", { name: "Проекты цели «Отдохнуть летом»" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Проекты без цели" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Проекты цели «Запустить сайт»" }).getByRole("button", { name: /Поездка в Карелию/ })).toBeVisible();
  await page.screenshot({ path: "tmp/goals-atlas/projects-by-goals-1440.png" });
  await page.getByRole("region", { name: "Проекты цели «Отдохнуть летом»" }).getByRole("button", { name: /Поездка в Карелию/ }).click();
  const projectGoals = page.getByRole("region", { name: "Цели проекта" });
  await expect(projectGoals).toContainText("Отдохнуть летом");
  await projectGoals.getByRole("button", { name: "Отдохнуть летом", exact: true }).click();
  await expect(page.getByRole("button", { name: "Все созвездия" })).toBeVisible();
});

test("projects board remains usable without the goals plugin", async ({ page, request }) => {
  const account = await register(request, "goals-atlas-off");
  await seedProjects(request, account);
  await disableAllPlugins(request, account);
  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await expect(page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "По целям" })).toHaveCount(0);
});

test("a new goal opens as a canvas and creates real project, task and milestone nodes", async ({ page, request }) => {
  test.setTimeout(150_000);
  const account = await register(request, "goal-canvas");
  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Цели", exact: true }).click();
  await page.getByPlaceholder(/Новая цель/).fill("Сделать сад");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Все созвездия" })).toBeVisible();
  await expect(page.getByText("Это ваша цель. Нажмите ПКМ на свободном месте")).toBeVisible();
  mkdirSync("tmp/goals-atlas", { recursive: true });
  await page.screenshot({ path: "tmp/goals-atlas/canvas-new-1440.png" });

  const canvas = page.locator('svg[aria-label="Созвездие Сделать сад"]');
  await canvas.click({ position: { x: 190, y: 340 } });
  await expect(page.getByRole("region", { name: "Добавить в созвездие" })).toHaveCount(0);
  await expect(page.getByText("Поле созвездия", { exact: true })).toBeVisible();
  const world = canvas.locator('g[transform^="translate("]').first();
  const viewBeforeDrag = await world.getAttribute("transform");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + 50, canvasBox!.y + 250);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 90, canvasBox!.y + 270, { steps: 4 });
  await page.mouse.up();
  await expect(world).not.toHaveAttribute("transform", viewBeforeDrag ?? "");
  await canvas.click({ button: "right", position: { x: 190, y: 340 } });
  const composer = page.getByRole("region", { name: "Добавить в созвездие" });
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Проект", exact: true }).click();
  await composer.getByPlaceholder("Что должно появиться?").fill("Подготовить участок");
  await composer.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.getByRole("button", { name: /План Подготовить участок/ })).toBeVisible();

  await page.getByRole("button", { name: /План Подготовить участок/ }).click({ button: "right" });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("button", { name: "Открыть проект" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  await page.getByRole("button", { name: "Добавить элемент в созвездие" }).click();
  await composer.getByRole("button", { name: "Задача", exact: true }).click();
  await composer.getByPlaceholder("Что должно появиться?").fill("Разметить грядки");
  await composer.getByRole("button", { name: "Создать", exact: true }).click();
  const firstTask = page.getByRole("button", { name: /Задача Разметить грядки/ });
  await expect(firstTask).toBeVisible();
  await expect(firstTask).toBeInViewport();

  await page.getByRole("button", { name: "Добавить элемент в созвездие" }).click();
  await composer.getByRole("button", { name: "Веха", exact: true }).click();
  await composer.getByPlaceholder("Что должно появиться?").fill("Участок готов");
  await composer.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.getByRole("button", { name: /Веха Участок готов/ })).toBeVisible();

  await page.getByRole("button", { name: "Добавить элемент в созвездие" }).click();
  await composer.getByRole("button", { name: "Задача", exact: true }).click();
  await composer.getByPlaceholder("Что должно появиться?").fill("Посадить деревья");
  await composer.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.getByRole("button", { name: /Задача Посадить деревья/ })).toBeVisible();
  await page.getByRole("button", { name: "Вписать всё" }).click();
  await expect(firstTask).toBeInViewport();
  await firstTask.click({ button: "right" });
  await composer.getByRole("button", { name: "Связать от этого узла" }).click();
  await page.getByRole("button", { name: /Задача Посадить деревья/ }).click();
  await expect(page.getByRole("button", { name: "Убрать зависимость от задачи Разметить грядки" })).toBeVisible();
  mkdirSync("tmp/goals-atlas", { recursive: true });
  await page.screenshot({ path: "tmp/goals-atlas/canvas-created-1440.png" });
  await page.getByRole("button", { name: "Изменить связи" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Добавить элемент в созвездие" }).click();
  await expect(composer).toBeVisible();
  await composer.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/goals-atlas/canvas-mobile-390.png" });

  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const goals = await (await request.get(`${base}/goals`, { headers })).json() as Array<{ title: string; plans: Array<{ projectName: string; tasks: number; milestones: Array<{ title: string }> }> }>;
  expect(goals.find((goal) => goal.title === "Сделать сад")?.plans).toEqual([expect.objectContaining({ projectName: "Подготовить участок", tasks: 2, milestones: [expect.objectContaining({ title: "Участок готов" })] })]);
  const tasks = await (await request.get(`${base}/tasks`, { headers })).json() as Array<{ title: string; id: string; dependencyIds: string[] }>;
  expect(tasks.find((task) => task.title === "Посадить деревья")?.dependencyIds).toContain(tasks.find((task) => task.title === "Разметить грядки")?.id);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /План Подготовить участок/ }).dblclick();
  await expect(page.locator(".dv-tab").filter({ hasText: "Подготовить участок" })).toHaveCount(1);
});
