# P0-2: 10 cycles "launch -> graceful window close" of the installed ORION Rust.
# Disposable profile + non-default ports, so the dev stack (5433) and the
# default install profile (14000/55442) are not touched.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/shutdown-smoke.ps1 [-App "D:\ORION Rust\orion-desktop.exe"]
# (путь по умолчанию — типичная установка currentUser; профиль и отчёт — в .tmp-test рядом с репозиторием)
[CmdletBinding()]
param(
  [string]$App = "$env:LOCALAPPDATA\Programs\ORION Rust\orion-desktop.exe"
)
$ErrorActionPreference = "Continue"
$repoRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path $App)) { $candidates = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName "orion-desktop.exe") }; if ($candidates) { $App = Join-Path $candidates[0].FullName "orion-desktop.exe" } }
if (-not (Test-Path $App)) { Write-Error "orion-desktop.exe не найден. Укажите -App <путь>."; exit 2 }
$profile = Join-Path $repoRoot ".tmp-test\shutdown-smoke-profile"
$apiPort = 24100
$pgPort = 55443
$rtPort = 24199
$report = Join-Path $repoRoot ".tmp-test\shutdown-smoke-report.txt"
"" | Set-Content $report

$env:ORION_DESKTOP_DATA_DIR = $profile
$env:ORION_DESKTOP_API_PORT = "$apiPort"
$env:ORION_DESKTOP_PG_PORT = "$pgPort"
$env:ORION_RUST_RUNTIME_PORT = "$rtPort"

function Log($line) { Add-Content $report $line; Write-Output $line }

for ($i = 1; $i -le 10; $i++) {
  $cycleStart = Get-Date
  $proc = Start-Process -FilePath $app -PassThru
  $ready = $false
  $readyAt = $null
  for ($t = 0; $t -lt 360; $t += 2) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$apiPort/system/health" -TimeoutSec 2 -UseBasicParsing
      if ($r.StatusCode -eq 200) { $ready = $true; $readyAt = ((Get-Date) - $cycleStart).TotalSeconds; break }
    } catch {}
    if ($proc.HasExited) { break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    Log "cycle ${i}: FAIL - API did not become healthy in 360s (procExited=$($proc.HasExited))"
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    break
  }

  # Graceful close: WM_CLOSE to the main window - the same path a user takes.
  $null = $proc.CloseMainWindow()
  $gone = $false
  $goneAt = $null
  for ($t = 0; $t -lt 120; $t += 2) {
    $shellAlive = -not $proc.HasExited
    $runtime = Get-CimInstance Win32_Process -Filter "Name='orion-runtime.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$pgPort*" -or $_.CommandLine -like "*$apiPort*" }
    $children = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='postgres.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$profile*" -or $_.CommandLine -like "*$pgPort*" }
    if (-not $shellAlive -and -not $runtime -and -not $children) { $gone = $true; $goneAt = ((Get-Date) - $cycleStart).TotalSeconds; break }
    Start-Sleep -Seconds 2
  }

  $portsBusy = @()
  foreach ($port in @($apiPort, $pgPort, $rtPort)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $portsBusy += "$port(pid $($conn[0].OwningProcess))" }
  }
  $leftovers = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='postgres.exe' OR Name='orion-runtime.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$profile*" -or $_.CommandLine -like "*$pgPort*" }
  $orphanDesc = ($leftovers | ForEach-Object { "$($_.Name):$($_.ProcessId)" }) -join ","

  $status = if ($gone -and $portsBusy.Count -eq 0) { "OK" } else { "FAIL" }
  Log ("cycle {0}: {1} readyIn={2:N1}s closedIn={3:N1}s portsBusy=[{4}] orphans=[{5}]" -f $i, $status, $readyAt, $goneAt, ($portsBusy -join " "), $orphanDesc)
  if ($status -eq "FAIL") {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    foreach ($left in $leftovers) { Stop-Process -Id $left.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
Log "DONE"
