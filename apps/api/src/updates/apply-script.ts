/**
 * Скрипт замены программы: приложение не может обновить само себя на ходу (файлы заняты), поэтому после скачивания и
 * проверки установщика API запускает отдельный PowerShell-процесс и завершается вместе с окном. Скрипт останавливает окно,
 * PostgreSQL (корректно, `pg_ctl stop -m fast`) и сервисы из каталога установки, тихо ставит новый установщик поверх
 * (данные лежат вне каталога установки и сохраняются) и запускает программу снова. Ход пишется в журнал.
 */
export interface ApplyScriptParams {
  installer: string;
  appExe: string;
  installDir: string;
  /** `pg_ctl.exe` и каталог кластера: если заданы, базу останавливают штатно, иначе её завершит остановка процессов. */
  pgCtl?: string | null;
  cluster?: string | null;
  logFile: string;
}

const ps = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export function buildApplyScript(p: ApplyScriptParams): string {
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
    `$installer = Start-Process -FilePath ${ps(p.installer)} -ArgumentList '/S' -PassThru -Wait`,
    "Write-Log ('установщик завершился с кодом ' + $installer.ExitCode)",
    `Start-Process -FilePath ${ps(p.appExe)}`,
    "Write-Log 'обновление: программа запущена'"
  );
  return lines.join("\r\n") + "\r\n";
}
