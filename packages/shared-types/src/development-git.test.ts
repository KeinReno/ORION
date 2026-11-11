import { describe, expect, it } from "vitest";
import { parseCommitTaskRefs } from "./development-git";

describe("ссылки на задачи из сообщения коммита", () => {
  it("находит #42 и несколько ссылок, без дублей", () => {
    expect(parseCommitTaskRefs("feat: сделать #42 и ещё #7\n\n#42 повторно")).toEqual(["42", "7"]);
  });

  it("поддерживает настраиваемый префикс", () => {
    expect(parseCommitTaskRefs("fix ORION-17 and ORION-3", "ORION-")).toEqual(["17", "3"]);
  });

  it("не выдумывает ссылки из обычного текста", () => {
    expect(parseCommitTaskRefs("issue 42, #, ##, #-bad")).toEqual([]);
    expect(parseCommitTaskRefs("")).toEqual([]);
    expect(parseCommitTaskRefs("#42", "")).toEqual([]);
  });

  it("полный uuid и его начало тоже считаются ссылкой", () => {
    expect(parseCommitTaskRefs("task #3f2a1b9c")).toEqual(["3f2a1b9c"]);
  });
});
