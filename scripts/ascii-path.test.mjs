import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { effectiveDataDir, effectivePgDir, isAsciiPath, userTag } = createRequire(import.meta.url)("../apps/desktop/runtime/ascii-path.cjs");

describe("пути только из ASCII для встроенного PostgreSQL", () => {
  it("распознаёт кириллицу и прочие не-ASCII символы", () => {
    expect(isAsciiPath("C:/Users/Reno/AppData/Local/ORION")).toBe(true);
    expect(isAsciiPath("C:/Users/Варвара/AppData/Local/ORION")).toBe(false);
    expect(isAsciiPath("C:/Users/José/x")).toBe(false);
  });

  it("каталог данных: ASCII остаётся как есть, иначе — запасной в ProgramData на пользователя", () => {
    const env = { ProgramData: "C:/ProgramData", USERDOMAIN: "PC", USERNAME: "Варвара" };
    expect(effectiveDataDir("C:/Users/Reno/AppData/Local/com.orion.desktop", env)).toBe("C:/Users/Reno/AppData/Local/com.orion.desktop");
    const fallback = effectiveDataDir("C:/Users/Варвара/AppData/Local/com.orion.desktop", env);
    expect(fallback).toMatch(/ProgramData[\\/]ORION[\\/]data-[0-9a-f]{10}$/);
    expect(isAsciiPath(fallback)).toBe(true);
    // Тот же пользователь — тот же каталог; другой — другой.
    expect(effectiveDataDir("C:/Users/Варвара/x", env)).toBe(fallback);
    expect(effectiveDataDir("C:/Users/Анна/x", { ...env, USERNAME: "Анна" })).not.toBe(fallback);
    expect(userTag(env)).toMatch(/^[0-9a-f]{10}$/);
  });

  it("бинарники PostgreSQL: ASCII используем на месте, иначе копия с версией в имени", () => {
    expect(effectivePgDir("C:/Users/Reno/AppData/Local/ORION/runtime/postgres", "0.1.0")).toEqual({
      dir: "C:/Users/Reno/AppData/Local/ORION/runtime/postgres",
      copy: false
    });
    const plan = effectivePgDir("C:/Users/Варвара/AppData/Local/ORION/runtime/postgres", "0.1.0", { ProgramData: "C:/ProgramData" });
    expect(plan.copy).toBe(true);
    expect(plan.dir).toMatch(/ProgramData[\\/]ORION[\\/]pg-0\.1\.0$/);
    expect(isAsciiPath(plan.dir)).toBe(true);
  });
});
