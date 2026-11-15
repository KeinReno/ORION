#requires -Version 5
<#
.SYNOPSIS
  Замер времени запуска ORION Rust (supervise-direct) по этапам.

.DESCRIPTION
  Запускает orion-runtime.exe supervise-direct на изолированном профиле, ждёт
  готовности API (GET /system/health), печатает суммарное время и этапы из
  лога runtime (startup-stage=... elapsed-ms=...). Затем штатно останавливает
  процесс закрытием stdin (EOF) и проверяет, что порты освобождены.

  Прогоняет два замера: холодный (с нуля, initdb + миграции) и тёплый
  (повторный запуск на том же профиле).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\measure-launch.ps1
  powershell -ExecutionPolicy Bypass -File scripts\measure-launch.ps1 -RuntimeRoot "C:\Program Files\ORION Rust\runtime" -Runs 3
#>
param(
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\resources\runtime"),
  [string]$DataParent = (Join-Path $env:LOCALAPPDATA "ORION-Rust-launch-bench"),
  [int]$ApiPort = 18100,
  [int]$PgPort = 18101,
  [int]$RuntimePort = 18102,
  [int]$Runs = 2,
  [int]$ReadyTimeoutSec = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RuntimeRoot = (Resolve-Path $RuntimeRoot).Path
$exe = Join-Path $RuntimeRoot "orion-runtime.exe"
if (-not (Test-Path $exe)) { throw "Не найден $exe — сначала выполните pnpm build:desktop-installer" }
if (-not (Test-Path (Join-Path $RuntimeRoot "node.exe"))) { throw "В $RuntimeRoot нет node.exe — некомплектный runtime" }

function Test-PortFree([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return -not $conn
}

function Invoke-OneRun([string]$Label, [string]$DataDir, [bool]$Fresh) {
  if ($Fresh -and (Test-Path $DataDir)) { Remove-Item -Recurse -Force $DataDir }
  New-Item -ItemType Directory -Force $DataDir | Out-Null
  $log = Join-Path $DataDir "launch-$Label.log"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.ArgumentList.Add("supervise-direct")
  $psi.WorkingDirectory = $RuntimeRoot
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables["ORION_RUNTIME_ROOT"] = $RuntimeRoot
  $psi.EnvironmentVariables["ORION_DESKTOP_DATA_DIR"] = $DataDir
  $psi.EnvironmentVariables["ORION_DESKTOP_API_PORT"] = "$ApiPort"
  $psi.EnvironmentVariables["ORION_DESKTOP_PG_PORT"] = "$PgPort"
  $psi.EnvironmentVariables["ORION_RUST_RUNTIME_PORT"] = "$RuntimePort"
  # Лог этапов идёт в stderr; пишем его файлом.
  $errStream = [System.IO.File]::Open($log, [System.IO.FileMode]::Create)

  foreach ($p in @($ApiPort, $PgPort, $RuntimePort)) {
    if (-not (Test-PortFree $p)) { throw "Порт $p занят до запуска — освободите его" }
  }

  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.EnableRaisingEvents = $true
  [void]$proc.Start()
  # stderr -> файл асинхронно
  $copyJob = $proc.StandardError.BaseStream.CopyToAsync($errStream)

  $ready = $false
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSec)
  $healthUrl = "http://127.0.0.1:$ApiPort/system/health"
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($proc.HasExited) { break }
    try {
      $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  $sw.Stop()
  $readyMs = $sw.ElapsedMilliseconds

  # Штатная остановка: EOF по stdin (как делает оболочка при выходе).
  $stopSw = [Diagnostics.Stopwatch]::StartNew()
  try { $proc.StandardInput.Close() } catch { }
  $exitDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not $proc.HasExited -and [DateTime]::UtcNow -lt $exitDeadline) { Start-Sleep -Milliseconds 200 }
  $stopSw.Stop()
  $exited = $proc.HasExited

  # Ждём освобождения портов
  $portsFree = $true
  foreach ($p in @($ApiPort, $PgPort, $RuntimePort)) {
    $freeDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-PortFree $p) -and [DateTime]::UtcNow -lt $freeDeadline) { Start-Sleep -Milliseconds 300 }
    if (-not (Test-PortFree $p)) { $portsFree = $false }
  }

  Write-Host ""
  Write-Host "=== $Label ==="
  Write-Host ("Готовность API: {0} за {1:N0} мс" -f ($(if ($ready) {"ДА"} else {"НЕТ (таймаут/падение)"})), $readyMs)
  if ($exited) { Write-Host ("Штатная остановка (EOF): {0:N0} мс, код выхода {1}" -f $stopSw.ElapsedMilliseconds, $proc.ExitCode) }
  else { Write-Host "Процесс НЕ завершился за 90 с после EOF"; try { $proc.Kill() } catch { } }
  Write-Host ("Порты освобождены: {0}" -f $(if ($portsFree) {"ДА"} else {"НЕТ — проверьте вручную"}))
  $stages = Select-String -Path $log -Pattern "startup-stage=(\S+) elapsed-ms=(\d+)" | ForEach-Object {
    "  {0,-24} {1,8} мс" -f $_.Matches[0].Groups[1].Value, $_.Matches[0].Groups[2].Value
  }
  if ($stages) { Write-Host "Этапы запуска:"; $stages | ForEach-Object { Write-Host $_ } }
  else { Write-Host "Этапов в логе нет — полный лог: $log" }
  Write-Host "Лог: $log"
  return @{ label = $Label; ready = $ready; ms = $readyMs }
}

Write-Host "Runtime: $RuntimeRoot"
Write-Host "Порты: API=$ApiPort PG=$PgPort Runtime=$RuntimePort"

$results = @()
$results += Invoke-OneRun -Label "cold-1" -DataDir $DataParent -Fresh $true
for ($i = 2; $i -le $Runs; $i++) {
  $results += Invoke-OneRun -Label "warm-$i" -DataDir $DataParent -Fresh $false
}

Write-Host ""
Write-Host "=== Итог ==="
foreach ($r in $results) { Write-Host ("{0}: {1} мс" -f $r.label, $r.ms) }
Write-Host ""
Write-Host "Сравните с целевыми 15 с (классический ORION). Если cold значительно больше,"
Write-Host "смотрите этапы: initdb/migrations — кандидаты на оптимизацию."
