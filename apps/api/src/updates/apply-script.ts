/**
 * Скрипт замены программы: приложение не может обновить само себя на ходу (файлы заняты), поэтому после скачивания и
 * проверки установщика API запускает отдельный PowerShell-процесс и завершается вместе с окном. Скрипт останавливает окно,
 * PostgreSQL (корректно, `pg_ctl stop -m fast`) и сервисы из каталога установки, тихо ставит новый установщик поверх
 * (данные лежат вне каталога установки и сохраняются) и запускает программу снова. Ход пишется в журнал.
 */
export interface ApplyScriptParams {
  /** null means a verified payload has already been queued; only restart the shell. */
  installer: string | null;
  appExe: string;
  installDir: string;
  /** `pg_ctl.exe` и каталог кластера: если заданы, базу останавливают штатно, иначе её завершит остановка процессов. */
  pgCtl?: string | null;
  cluster?: string | null;
  logFile: string;
  /** Presence selects the fail-closed Rust path; null/invalid values must abort before touching processes. */
  rustShellPid?: number | null;
  /** Per-session marker created by the Rust supervisor only after a clean PostgreSQL shutdown and Job close. */
  rustShutdownMarker?: string | null;
}

const ps = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export function buildApplyScript(p: ApplyScriptParams): string {
  const rustMode = Object.prototype.hasOwnProperty.call(p, "rustShellPid") || Object.prototype.hasOwnProperty.call(p, "rustShutdownMarker");
  if (rustMode) {
    const validPid = Number.isSafeInteger(p.rustShellPid) && (p.rustShellPid as number) > 0 && (p.rustShellPid as number) <= 2_147_483_647;
    const pid = validPid ? String(p.rustShellPid) : "$null";
    return [
      "$ErrorActionPreference = 'Continue'",
      `$log = ${ps(p.logFile)}`,
      "function Write-Log($message) { Add-Content -Path $log -Value (('[{0}] {1}' -f (Get-Date -Format o), $message)) }",
      "function Stop-Apply($message) { Write-Log ('ОШИБКА: ' + $message); exit 20 }",
      "Write-Log 'обновление ORION Rust: проверка оболочки'",
      `$expectedExe = ${ps(p.appExe)}`,
      `$shutdownMarker = ${p.rustShutdownMarker ? ps(p.rustShutdownMarker) : "$null"}`,
      "$targetPid = " + pid,
      "if ($null -eq $targetPid -or $targetPid -le 0) { Stop-Apply 'не передан допустимый PID оболочки; процессы не остановлены, установщик не запущен' }",
      "if ([string]::IsNullOrWhiteSpace($shutdownMarker)) { Stop-Apply 'не передан marker штатного завершения PostgreSQL; процессы не остановлены, установщик не запущен' }",
      "if (Test-Path -LiteralPath $shutdownMarker) { Stop-Apply 'marker завершения уже существует; сессия не подтверждена, процессы не остановлены, установщик не запущен' }",
      "try { $expectedPath = [System.IO.Path]::GetFullPath($expectedExe) } catch { Stop-Apply 'не удалось проверить ожидаемый путь ORION; процессы не остановлены, установщик не запущен' }",
      "try { $targetInfo = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + $targetPid) -ErrorAction Stop } catch { Stop-Apply 'не удалось прочитать процесс оболочки; процессы не остановлены, установщик не запущен' }",
      "if ($null -eq $targetInfo -or [string]::IsNullOrWhiteSpace($targetInfo.ExecutablePath)) { Stop-Apply 'процесс с переданным PID не найден; процессы не остановлены, установщик не запущен' }",
      "try { $actualPath = [System.IO.Path]::GetFullPath($targetInfo.ExecutablePath) } catch { Stop-Apply 'не удалось проверить исполняемый файл оболочки; процессы не остановлены, установщик не запущен' }",
      "if (-not [string]::Equals($actualPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Apply 'путь процесса не совпадает с ожидаемым ORION; процессы не остановлены, установщик не запущен' }",
      "try { $shell = Get-Process -Id $targetPid -ErrorAction Stop } catch { Stop-Apply 'процесс оболочки завершился до штатного закрытия; процессы не остановлены, установщик не запущен' }",
      "try { $closeRequested = $shell.CloseMainWindow() } catch { Stop-Apply 'ошибка при отправке запроса на закрытие; процессы не остановлены, установщик не запущен' }",
      "if (-not $closeRequested) { Stop-Apply 'оболочка не подтвердила запрос на штатное закрытие; процессы не остановлены, установщик не запущен' }",
      "try { $shellExited = $shell.WaitForExit(600000) } catch { Stop-Apply 'ошибка ожидания штатного закрытия; установщик не запущен' }",
      "if (-not $shellExited) { Stop-Apply 'оболочка не закрылась за 10 минут; процессы не остановлены, установщик не запущен' }",
      "try { $markerInfo = Get-Item -LiteralPath $shutdownMarker -ErrorAction Stop; $markerValue = Get-Content -LiteralPath $shutdownMarker -Raw -ErrorAction Stop } catch { Stop-Apply 'Rust не подтвердил штатную остановку PostgreSQL; установщик не запущен' }",
      "if (($markerInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $markerValue -cne 'orion-runtime-stopped-v1') { Stop-Apply 'marker штатного завершения PostgreSQL недействителен; установщик не запущен' }",
      "try { Remove-Item -LiteralPath $shutdownMarker -Force -ErrorAction Stop } catch { Stop-Apply 'не удалось удалить подтверждённый marker; установщик не запущен' }",
      "Start-Sleep -Milliseconds 500",
      "try { $sameInstallProcesses = @(Get-CimInstance -ClassName Win32_Process -Filter \"Name='orion-desktop.exe'\" -ErrorAction Stop | Where-Object { $_.ExecutablePath -and [string]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $expectedPath, [System.StringComparison]::OrdinalIgnoreCase) }) } catch { Stop-Apply 'не удалось проверить, что установщик может безопасно заменить файлы; установщик не запущен' }",
      "if ($sameInstallProcesses.Count -gt 0) { Stop-Apply 'обнаружено другое окно этого установленного приложения; процессы не остановлены, установщик не запущен' }",
      "Write-Log 'оболочка штатно закрылась; запускаю обновление'",
      ...(p.installer ? [
        `$installer = Start-Process -FilePath ${ps(p.installer)} -ArgumentList '/S' -PassThru -Wait`,
        "if ($installer.ExitCode -ne 0) { Write-Log ('ОШИБКА: установщик вернул код ' + $installer.ExitCode + ' — обновление, возможно, не применилось') } else { Write-Log 'установщик завершился успешно (код 0)' }"
      ] : ["Write-Log 'пакет проверен: перезапуск без установщика'"]),
      `Start-Process -FilePath ${ps(p.appExe)}`,
      "Write-Log 'обновление: программа запущена'"
    ].join("\r\n") + "\r\n";
  }

  const lines = [
    "$ErrorActionPreference = 'Continue'",
    `$log = ${ps(p.logFile)}`,
    "function Write-Log($message) { Add-Content -Path $log -Value (('[{0}] {1}' -f (Get-Date -Format o), $message)) }",
    "Write-Log 'обновление: старт'",
    "Start-Sleep -Seconds 2",
    "Get-Process -Name 'orion-desktop' -ErrorAction SilentlyContinue | Stop-Process -Force",
    "Start-Sleep -Seconds 1"
  ];
  if (p.pgCtl && p.cluster) {
    lines.push(
      `if (Test-Path ${ps(p.pgCtl)}) { & ${ps(p.pgCtl)} stop -D ${ps(p.cluster)} -m fast -w 2>&1 | ForEach-Object { Write-Log $_ } }`
    );
  }
  lines.push(
    `$runtime = ${ps(`${p.installDir.replace(/[\\/]+$/, "")}\\runtime\\`)}`,
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtime, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    "Start-Sleep -Seconds 2",
    ...(p.installer ? [
      `$installer = Start-Process -FilePath ${ps(p.installer)} -ArgumentList '/S' -PassThru -Wait`,
      // 0 is the only success code NSIS documents for /S; anything else (including the silent
      // "same version, reinstall?" page defaulting to uninstall-and-exit when its dialog never
      // got created in passive mode) means the old files are very likely still in place. Logged
      // loudly so a stuck-on-old-version report after this can be diagnosed from this file alone —
      // the real fix is keeping the app's version bumped every beta (see Cargo.toml), not this.
      "if ($installer.ExitCode -ne 0) { Write-Log ('ОШИБКА: установщик вернул код ' + $installer.ExitCode + ' — обновление, возможно, не применилось') } else { Write-Log 'установщик завершился успешно (код 0)' }"
    ] : ["Write-Log 'пакет проверен: перезапуск без установщика'"]),
    `Start-Process -FilePath ${ps(p.appExe)}`,
    "Write-Log 'обновление: программа запущена'"
  );
  return lines.join("\r\n") + "\r\n";
}
