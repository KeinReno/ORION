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

  it("keeps the Classic process-stop behavior only when Rust mode is absent", () => {
    const classic = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe" });
    expect(classic).toContain("Get-Process -Name 'orion-desktop' -ErrorAction SilentlyContinue | Stop-Process -Force");
    expect(classic).not.toContain("CloseMainWindow");
  });

  it.each([null, undefined, 0, -5, 1.5, Number.NaN, 2_147_483_648])(
    "fails closed for an absent or invalid Rust shell PID (%s)",
    (rustShellPid) => {
      const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe", rustShellPid, rustShutdownMarker: "C:\\data\\runtime-stopped-4321-123.marker" });
      expect(script).toContain("$targetPid = $null");
      expect(script).toContain("не передан допустимый PID оболочки");
      expect(script).not.toContain("Stop-Process");
      expect(script.indexOf("не передан допустимый PID оболочки"))
        .toBeLessThan(script.indexOf("Start-Process -FilePath 'C:\\tmp\\setup.exe'"));
    }
  );

  it("verifies the exact process path and waits for graceful close before starting the installer", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe", rustShellPid: 4321, rustShutdownMarker: "C:\\data\\runtime-stopped-4321-123.marker" });
    const identityCheck = script.indexOf("[string]::Equals($actualPath, $expectedPath");
    const closeRequest = script.indexOf("$shell.CloseMainWindow()");
    const waitForExit = script.indexOf("$shell.WaitForExit(600000)");
    const installer = script.indexOf("Start-Process -FilePath 'C:\\tmp\\setup.exe'");
    expect(script).toContain("$targetPid = 4321");
    expect(script).toContain("[System.IO.Path]::GetFullPath($targetInfo.ExecutablePath)");
    expect(script).toContain("OrdinalIgnoreCase");
    expect(script).toContain("оболочка не закрылась за 10 минут");
    expect(script).not.toContain("Stop-Process");
    for (const guard of script.split("\r\n").filter((line) => line.includes("Stop-Apply "))) {
      expect(script.indexOf(guard)).toBeLessThan(installer);
    }
    expect(identityCheck).toBeGreaterThanOrEqual(0);
    expect(closeRequest).toBeGreaterThan(identityCheck);
    expect(waitForExit).toBeGreaterThan(closeRequest);
    expect(installer).toBeGreaterThan(waitForExit);
  });

  it("does not run the installer if another process from the same install remains", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe", rustShellPid: 4321, rustShutdownMarker: "C:\\data\\runtime-stopped-4321-123.marker" });
    const remainingProcessCheck = script.indexOf("$sameInstallProcesses.Count -gt 0");
    const installer = script.indexOf("Start-Process -FilePath 'C:\\tmp\\setup.exe'");
    expect(script).toContain("Get-CimInstance -ClassName Win32_Process -Filter \"Name='orion-desktop.exe'\"");
    expect(script).toContain("обнаружено другое окно этого установленного приложения");
    expect(remainingProcessCheck).toBeGreaterThan(script.indexOf("$shell.WaitForExit(600000)"));
    expect(installer).toBeGreaterThan(remainingProcessCheck);
  });

  it("requires a fresh exact-content PostgreSQL shutdown marker before the installer", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe", rustShellPid: 4321, rustShutdownMarker: "C:\\data\\runtime-stopped-4321-123.marker" });
    const freshCheck = script.indexOf("Test-Path -LiteralPath $shutdownMarker");
    const closeRequest = script.indexOf("$shell.CloseMainWindow()");
    const waitForExit = script.indexOf("$shell.WaitForExit(600000)");
    const markerRead = script.indexOf("Get-Content -LiteralPath $shutdownMarker -Raw");
    const exactValueCheck = script.indexOf("$markerValue -cne 'orion-runtime-stopped-v1'");
    const markerDelete = script.indexOf("Remove-Item -LiteralPath $shutdownMarker");
    const installer = script.indexOf("Start-Process -FilePath 'C:\\tmp\\setup.exe'");
    expect(script).toContain("marker завершения уже существует");
    expect(script).toContain("Rust не подтвердил штатную остановку PostgreSQL");
    expect(script).toContain("[System.IO.FileAttributes]::ReparsePoint");
    expect(freshCheck).toBeGreaterThanOrEqual(0);
    expect(closeRequest).toBeGreaterThan(freshCheck);
    expect(waitForExit).toBeGreaterThan(closeRequest);
    expect(markerRead).toBeGreaterThan(waitForExit);
    expect(exactValueCheck).toBeGreaterThan(markerRead);
    expect(markerDelete).toBeGreaterThan(exactValueCheck);
    expect(installer).toBeGreaterThan(markerDelete);
  });

  it("fails closed when Rust mode has no shutdown marker", () => {
    const script = buildApplyScript({ ...base, installer: "C:\\tmp\\setup.exe", rustShellPid: 4321, rustShutdownMarker: null });
    expect(script).toContain("$shutdownMarker = $null");
    expect(script).toContain("не передан marker штатного завершения PostgreSQL");
    expect(script).not.toContain("Stop-Process");
  });
});
