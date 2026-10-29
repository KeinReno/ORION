import { describe, expect, it } from "vitest";
import { buildApplyScript } from "./apply-script";

const base = { appExe: "C:\\Install\\orion-desktop.exe", installDir: "C:\\Install", logFile: "C:\\Install\\apply.log" };

describe("buildApplyScript", () => {
  it("logs the installer's exit code and flags anything other than 0 loudly", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe" });
    expect(script).toContain("$installer.ExitCode");
    expect(script).toMatch(/if \(\$installer\.ExitCode -ne 0\)/);
    expect(script).toContain("ОШИБКА");
  });

  it("skips the installer step entirely for an already-verified payload", () => {
    const script = buildApplyScript({ ...base, installer: null });
    expect(script).not.toContain("Start-Process -FilePath 'C:\\tmp\\setup.exe'");
    expect(script).toContain("пакет проверен: перезапуск без установщика");
  });

  it("always relaunches the app after the installer step, success or failure", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe" });
    const lines = script.split("\r\n");
    const installIndex = lines.findIndex((line) => line.includes("Start-Process -FilePath 'C:\\tmp\\setup.exe'"));
    const relaunchIndex = lines.findIndex((line) => line.includes(`Start-Process -FilePath '${base.appExe}'`));
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(relaunchIndex).toBeGreaterThan(installIndex);
  });

  it("stops Postgres before touching files when pgCtl/cluster are given", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe", pgCtl: "C:\\Install\\postgres\\bin\\pg_ctl.exe", cluster: "C:\\Install\\postgres\\data" });
    expect(script).toContain("pg_ctl.exe");
    expect(script).toContain("stop -D");
  });
});
