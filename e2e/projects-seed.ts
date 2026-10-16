import { expect, type APIRequestContext } from "@playwright/test";
import { apiUrl, type Account } from "./support";

const day = 86_400_000;
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * day).toISOString();

/** Realistic synthetic data for the Projects screens: four projects, tasks, milestones, reports, a linked note. */
export async function seedProjects(request: APIRequestContext, account: Account) {
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`${base}/${path}`, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const trip = await post("projects", { name: "Поездка в Карелию", description: "Неделя на машине: маршрут, жильё, снаряжение.", dueAt: iso(40), startAt: iso(-10) });
  const site = await post("projects", { name: "Редизайн сайта студии с очень длинным названием, которое должно аккуратно обрезаться", description: "Новый лендинг и кабинет клиента.", dueAt: iso(-3), startAt: iso(-60) });
  const home = await post("projects", { name: "Ремонт кухни", description: "", status: "on_hold" });
  await post("projects", { name: "Архив налогов 2025", description: "Документы и справки.", status: "completed" });

  const tasks: { projectId: string; title: string; status: string; dueAt?: string; priority?: string }[] = [
    { projectId: trip.id, title: "Забронировать домик у озера", status: "in_progress", dueAt: iso(5), priority: "high" },
    { projectId: trip.id, title: "Составить список снаряжения", status: "todo", dueAt: iso(12) },
    { projectId: trip.id, title: "Проверить шины и масло", status: "todo", dueAt: iso(20) },
    { projectId: trip.id, title: "Скачать офлайн-карты", status: "done" },
    { projectId: site.id, title: "Согласовать макеты главной", status: "todo", dueAt: iso(-5), priority: "high" },
    { projectId: site.id, title: "Вёрстка кабинета клиента", status: "in_progress", dueAt: iso(-1) },
    { projectId: site.id, title: "Подключить форму заявок", status: "done" },
    { projectId: site.id, title: "Тексты для раздела «Услуги»", status: "backlog" },
    { projectId: home.id, title: "Выбрать фасады", status: "backlog" }
  ];
  for (const task of tasks) {
    const created = await post("tasks", task);
    if (task.status === "done") {
      const done = await request.patch(`${base}/tasks/${created.id}`, { headers, data: { status: "done" } });
      expect(done.ok(), await done.text()).toBe(true);
    }
  }
  await post("milestones", { projectId: trip.id, title: "Бронирование завершено", status: "in_progress", dueAt: iso(14) });
  await post("milestones", { projectId: trip.id, title: "Выезд", status: "planned", dueAt: iso(38) });
  await post("milestones", { projectId: site.id, title: "Макеты утверждены", status: "done", dueAt: iso(-20) });
  await post("milestones", { projectId: site.id, title: "Запуск", status: "planned", dueAt: iso(-3) });
  await post(`projects/${site.id}/updates`, { health: "delayed", summary: "Сдвинули запуск из-за правок макета.", blocker: "Ждём обратной связи от клиента", nextStep: "Согласовать макет до пятницы" });
  await post(`projects/${trip.id}/updates`, { health: "on_track", summary: "Маршрут согласован, жильё выбрано.", blocker: "", nextStep: "Оплатить бронь" });
  const note = await post("notes", { title: "Маршрут по Карелии", body: "День 1: Сортавала. День 2: Валаам.", tags: [], projectId: trip.id });
  const task = await post("tasks", { title: "Связанная с заметкой задача", status: "todo", projectId: trip.id });
  await post("links", { sourceType: "task", sourceId: task.id, targetType: "note", targetId: note.id, kind: "related_to", label: null });
  return { trip, site, home, note, task, headers, base };
}

