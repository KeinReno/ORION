import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { BackgroundJobsService } from "./background-jobs.service";

describe("BackgroundJobsService (G9)", () => {
  it("исключение в задаче не выбрасывается наружу и не мешает другой задаче", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const jobs = new BackgroundJobsService();
    const ok = vi.fn(async () => undefined);

    const failed = await jobs.runJob("tasks", "due", async () => {
      throw new Error("boom");
    });
    const passed = await jobs.runJob("finance", "recurring", ok);

    expect(failed).toBe(false);
    expect(passed).toBe(true);
    expect(ok).toHaveBeenCalledTimes(1);
    const byKey = Object.fromEntries(jobs.list().map((j) => [`${j.componentId}/${j.jobName}`, j]));
    expect(byKey["tasks/due"]).toMatchObject({ runs: 1, failures: 1, lastError: "boom", lastSuccessAt: null, running: false });
    expect(byKey["finance/recurring"]).toMatchObject({ runs: 1, failures: 0, lastError: null });
    expect(byKey["finance/recurring"]!.lastSuccessAt).not.toBeNull();
  });

  it("успех после сбоя сбрасывает lastError, но сохраняет счётчик ошибок", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const jobs = new BackgroundJobsService();
    await jobs.runJob("notes", "purge", async () => Promise.reject(new Error("x")));
    await jobs.runJob("notes", "purge", async () => undefined);
    expect(jobs.list()[0]).toMatchObject({ runs: 2, failures: 1, lastError: null });
  });

  it("не даёт задаче наложиться на саму себя и считает пропуск", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const jobs = new BackgroundJobsService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = vi.fn(() => gate);

    const first = jobs.runJob("calendar", "sync", slow);
    const second = await jobs.runJob("calendar", "sync", slow);
    expect(second).toBe(false);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(jobs.list()[0]).toMatchObject({ running: true, runs: 1, skipped: 1 });

    release();
    await first;
    expect(jobs.list()[0]).toMatchObject({ running: false, runs: 1, skipped: 1, failures: 0 });
    expect(await jobs.runJob("calendar", "sync", async () => undefined)).toBe(true);
  });

  it("обрезает длинное сообщение об ошибке", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const jobs = new BackgroundJobsService();
    await jobs.runJob("core", "j", async () => Promise.reject(new Error("a".repeat(1000))));
    expect(jobs.list()[0]!.lastError!.length).toBe(300);
  });
});
