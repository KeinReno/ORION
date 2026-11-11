import { describe, expect, it } from "vitest";
import {
  PROJECT_TREE_MAX_DEPTH,
  createProjectFromTemplateInputSchema,
  deadlineDaysLeft,
  duplicateProjectInputSchema,
  highestRiskLevel,
  hierarchyCyclePath,
  offsetDate,
  projectPortfolioQuerySchema,
  projectFieldChanges,
  projectHistoryValue,
  projectRiskKinds,
  projectTemplateDepth,
  projectTemplateNodeCount,
  projectTemplateStructureSchema,
  projectTemplateTaskSchema,
  startOfUtcDay
} from "./project-center";

const task = (overrides: Record<string, unknown> = {}) =>
  projectTemplateTaskSchema.parse({ title: "Задача", ...overrides });

describe("шаблон проекта", () => {
  it("пустой шаблон валиден и по умолчанию не содержит структуры", () => {
    const parsed = projectTemplateStructureSchema.parse({ name: "Проект" });
    expect(parsed.name).toBe("Проект");
    expect(parsed.milestones).toEqual([]);
    expect(parsed.tasks).toEqual([]);
    expect(parsed.children).toEqual([]);
    expect(parsed.startOffsetDays).toBe(0);
  });

  it("задача шаблона по умолчанию открыта, без дат и без вехи", () => {
    const parsed = task();
    expect(parsed.status).toBe("todo");
    expect(parsed.priority).toBe("normal");
    expect(parsed.startOffsetDays).toBe(0);
    expect(parsed.dueOffsetDays).toBeNull();
    expect(parsed.milestoneIndex).toBeNull();
  });

  it("завершённую работу шаблон не создаёт", () => {
    const done = projectTemplateTaskSchema.safeParse({ title: "Готово", status: "done" });
    expect(done.success).toBe(false);
  });

  it("глубина и число проектов считаются по дереву", () => {
    const tree = projectTemplateStructureSchema.parse({
      name: "Корень",
      children: [{ name: "Ребёнок", children: [{ name: "Внук" }] }]
    });
    expect(projectTemplateDepth(tree)).toBe(3);
    expect(projectTemplateNodeCount(tree)).toBe(3);
    // Пустой ребёнок не добавляет глубины.
    expect(projectTemplateNodeCount(projectTemplateStructureSchema.parse({ name: "Один" }))).toBe(1);
  });

  it("create-from-template и duplicate принимают только осмысленные входы", () => {
    expect(createProjectFromTemplateInputSchema.safeParse({ templateId: "not-a-uuid", name: "Новый" }).success).toBe(false);
    const duplicate = duplicateProjectInputSchema.parse({});
    expect(duplicate.withContent).toBe(false);
    expect(duplicate.withChildren).toBe(true);
  });
});

describe("даты шаблона", () => {
  it("сдвиг считается от полуночи UTC, а не от часов пользователя", () => {
    // 2026-03-10T22:30Z — поздний вечер; «+1 день» обязан остаться 11-м числом.
    const base = startOfUtcDay("2026-03-10T22:30:00.000Z");
    expect(base.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(offsetDate(base, 1).toISOString()).toBe("2026-03-11T00:00:00.000Z");
    expect(offsetDate(base, -2).toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });

  it("дедлайн считается по календарным суткам: сегодня 0, завтра 1, вчера -1", () => {
    const now = new Date("2026-03-10T23:50:00.000Z");
    expect(deadlineDaysLeft("2026-03-10T00:00:00.000Z", now)).toBe(0);
    expect(deadlineDaysLeft("2026-03-11T00:00:00.000Z", now)).toBe(1);
    expect(deadlineDaysLeft("2026-03-09T00:00:00.000Z", now)).toBe(-1);
  });
});

describe("иерархия", () => {
  it("путь цикла заканчивается исходным проектом", () => {
    expect(hierarchyCyclePath("a", ["c", "b", "a"])).toEqual(["c", "b", "a", "a"]);
  });

  it("лимит глубины — 6 уровней", () => {
    expect(PROJECT_TREE_MAX_DEPTH).toBe(6);
  });
});

describe("риски портфеля", () => {
  it("правила рисков не зависят от источника данных", () => {
    const risks = projectRiskKinds({
      hasTasks: false,
      hasDates: true,
      overdue: true,
      milestoneWithoutDates: ["Запуск"],
      blockedDependencies: ["Платформа"]
    });
    expect(risks.map((risk) => risk.kind)).toEqual(["no_tasks", "milestone_without_dates", "overdue", "blocked_dependency"]);
    expect(highestRiskLevel(risks.map((risk) => risk.kind))).toBe("high");
  });

  it("проект без сроков и задач — не риск «без задач»", () => {
    const risks = projectRiskKinds({ hasTasks: false, hasDates: false, overdue: false, milestoneWithoutDates: [], blockedDependencies: [] });
    expect(risks).toEqual([]);
    expect(highestRiskLevel([])).toBeNull();
  });

  it("уровень риска не путает средний и низкий", () => {
    expect(highestRiskLevel(["no_tasks"])).toBe("low");
    expect(highestRiskLevel(["no_tasks", "milestone_without_dates"])).toBe("medium");
  });
});

describe("query портфеля", () => {
  it("ограничивает размер страницы и режимы выборки", () => {
    expect(projectPortfolioQuerySchema.parse({}).limit).toBeUndefined();
    expect(projectPortfolioQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(projectPortfolioQuerySchema.safeParse({ scope: "deleted" }).success).toBe(false);
    expect(projectPortfolioQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });
});

describe("audit trail значений", () => {
  it("дата и число приводятся к строке, пустота — к null", () => {
    expect(projectHistoryValue(null)).toBeNull();
    expect(projectHistoryValue(undefined)).toBeNull();
    expect(projectHistoryValue(new Date("2026-05-01T09:00:00.000Z"))).toBe("2026-05-01T09:00:00.000Z");
    expect(projectHistoryValue(1500)).toBe("1500");
    expect(projectHistoryValue("текст")).toBe("текст");
  });

  it("в историю попадают только реально изменённые поля из контракта", () => {
    const changes = projectFieldChanges(
      { name: "A", status: "active", dueAt: null, sharedOrder: 3 },
      { name: "A", status: "on_hold", dueAt: new Date("2026-05-01T00:00:00.000Z"), sharedOrder: 7, contextNote: undefined }
    );
    expect(changes).toEqual([
      { field: "status", from: "active", to: "on_hold" },
      { field: "dueAt", from: null, to: "2026-05-01T00:00:00.000Z" }
    ]);
  });

  it("пустой патч не создаёт записи истории", () => {
    expect(projectFieldChanges({ name: "A" }, {})).toEqual([]);
    expect(projectFieldChanges({ name: "A" }, { name: "A" })).toEqual([]);
  });
});