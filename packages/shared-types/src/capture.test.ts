import { describe, expect, it } from "vitest";
import { quickCaptureHint, quickCapturePlaceholder, resolveQuickCapture } from "./capture";

const both = { tasks: true, notes: true };
const tasksOnly = { tasks: true, notes: false };
const notesOnly = { tasks: false, notes: true };
const none = { tasks: false, notes: false };

describe("resolveQuickCapture", () => {
  it("sends a bare thought to the inbox", () => {
    expect(resolveQuickCapture("купить молоко", both)).toEqual({ kind: "inbox", title: "купить молоко" });
    expect(resolveQuickCapture("  идея  ", none)).toEqual({ kind: "inbox", title: "идея" });
  });

  it("creates a task from /task and /задача when the module is on", () => {
    expect(resolveQuickCapture("/task Написать план", both)).toEqual({ kind: "task", title: "Написать план" });
    expect(resolveQuickCapture("/задача Созвон", tasksOnly)).toEqual({ kind: "task", title: "Созвон" });
  });

  it("creates a note from /note and /заметка when the module is on", () => {
    expect(resolveQuickCapture("/note Черновик", both)).toEqual({ kind: "note", title: "Черновик" });
    expect(resolveQuickCapture("/заметка Мысль", notesOnly)).toEqual({ kind: "note", title: "Мысль" });
  });

  it("refuses a shortcut whose module is off", () => {
    expect(resolveQuickCapture("/task X", notesOnly)).toEqual({
      kind: "error",
      message: "Модуль «Задачи» выключен"
    });
    expect(resolveQuickCapture("/note X", tasksOnly)).toEqual({
      kind: "error",
      message: "Модуль «Заметки» выключен"
    });
  });

  it("rejects empty input and empty titles after a prefix", () => {
    expect(resolveQuickCapture("   ", both).kind).toBe("error");
    expect(resolveQuickCapture("/task", both)).toEqual({ kind: "error", message: "Укажите название задачи" });
    expect(resolveQuickCapture("/note   ", both)).toEqual({ kind: "error", message: "Укажите название заметки" });
  });

  it("creates a task due today from a leading ! when tasks are on", () => {
    expect(resolveQuickCapture("! купить молоко", both)).toEqual({
      kind: "task",
      title: "купить молоко",
      dueToday: true
    });
    expect(resolveQuickCapture("!отчёт", tasksOnly)).toEqual({
      kind: "task",
      title: "отчёт",
      dueToday: true
    });
  });

  it("strips #tag from a task title into projectTag", () => {
    expect(resolveQuickCapture("! отчёт #работа", both)).toEqual({
      kind: "task",
      title: "отчёт",
      dueToday: true,
      projectTag: "работа"
    });
    expect(resolveQuickCapture("/task Написать план #orion", both)).toEqual({
      kind: "task",
      title: "Написать план",
      projectTag: "orion"
    });
    expect(resolveQuickCapture("/задача Созвон вечером #клиент", tasksOnly)).toEqual({
      kind: "task",
      title: "Созвон вечером",
      projectTag: "клиент"
    });
  });

  it("does not treat #tag as a destination without ! or /task", () => {
    expect(resolveQuickCapture("купить #молоко", both)).toEqual({
      kind: "inbox",
      title: "купить #молоко"
    });
    expect(resolveQuickCapture("/note мысль #тег", both)).toEqual({
      kind: "note",
      title: "мысль #тег"
    });
  });

  it("refuses ! when tasks are off or the title is empty", () => {
    expect(resolveQuickCapture("! x", notesOnly)).toEqual({
      kind: "error",
      message: "Модуль «Задачи» выключен"
    });
    expect(resolveQuickCapture("!", both)).toEqual({ kind: "error", message: "Укажите название задачи" });
    expect(resolveQuickCapture("!   ", both)).toEqual({ kind: "error", message: "Укажите название задачи" });
    expect(resolveQuickCapture("/task #orion", both)).toEqual({
      kind: "error",
      message: "Укажите название задачи"
    });
  });
});

describe("quickCapturePlaceholder", () => {
  it("mentions inbox first and only the shortcuts that still work", () => {
    expect(quickCapturePlaceholder(both)).toContain("инбокс");
    expect(quickCapturePlaceholder(both)).toContain("/task");
    expect(quickCapturePlaceholder(both)).toContain("/note");
    expect(quickCapturePlaceholder(both)).toContain("!");
    expect(quickCapturePlaceholder(both)).toContain("#");
    expect(quickCapturePlaceholder(tasksOnly)).not.toContain("/note");
    expect(quickCapturePlaceholder(tasksOnly)).toContain("!");
    expect(quickCapturePlaceholder(notesOnly)).not.toContain("!");
    expect(quickCapturePlaceholder(none)).toBe("Мысль → инбокс");
  });
});

describe("quickCaptureHint", () => {
  it("names the destination the field will send to", () => {
    expect(quickCaptureHint(resolveQuickCapture("мысль", both))).toBe("→ инбокс");
    expect(quickCaptureHint(resolveQuickCapture("! купить", both))).toBe("→ задача на сегодня");
    expect(quickCaptureHint(resolveQuickCapture("/task план", both))).toBe("→ задача");
    expect(quickCaptureHint(resolveQuickCapture("/note черновик", both))).toBe("→ заметка");
    expect(quickCaptureHint(resolveQuickCapture("   ", both))).toBeNull();
  });
});
