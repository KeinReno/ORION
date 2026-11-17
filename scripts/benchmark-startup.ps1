# Бенчмарк запуска ORION-R по docs/BENCHMARK_PROTOCOL.md.
# Пример: powershell -ExecutionPolicy Bypass -File scripts\benchmark-startup.ps1 -Runs 5 -Mode warm
[CmdletBinding()]
param(
    [int]$Runs = 5,
    [ValidateSet('warm', 'cold')]
    [string]$Mode = 'warm',
    [string]$AppPath = (Join-Path $env:LOCALAPPDATA 'ORION-Rust\ORION-Rust.exe'),
    [int]$TimeoutSec = 120,
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'benchmark-reports')
)

$ErrorActionPreference = 'Stop'
$appName = [IO.Path]::GetFileNameWithoutExtension($AppPath)
$dataDir = Join-Path $env:LOCALAPPDATA 'ORION-Rust'
$logFile = Join-Path $dataDir 'launcher.log'
$coldBackup = "$dataDir.benchmark-backup"

if (-not (Test-Path $AppPath)) { throw "Не найден исполняемый файл: $AppPath" }
if ($Mode -eq 'cold' -and -not (Test-Path $dataDir)) { Write-Host "Профиля нет — cold работает как первичная установка." }

New-Item -ItemType Directory -Force $OutDir | Out-Null
$logBackup = "$logFile.benchmark-backup"

function Stop-Orion {
    taskkill //IM "$appName.exe" //T //F 2>$null | Out-Null
    taskkill //IM 'orion-runtime.exe' //T //F 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

function Wait-Ready([int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $logFile) {
            $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($content -match 'phase=ready elapsed_ms=(\d+)') { return [int]$Matches[1] }
            if ($content -match 'Локальный сервер завершился|не запустился за') { return -1 }
        }
        $proc = Get-Process -Name $appName -ErrorAction SilentlyContinue
        if (-not $proc -and -not (Get-Process -Name 'orion-runtime' -ErrorAction SilentlyContinue)) {
            if (Test-Path $logFile) {
                $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
                if ($content -match 'phase=ready elapsed_ms=(\d+)') { return [int]$Matches[1] }
            }
            return -1
        }
        Start-Sleep -Milliseconds 500
    }
    return -1
}

$measurements = @()
for ($run = 1; $run -le $Runs; $run++) {
    Write-Host "=== Прогон $run/$Runs ($Mode) ==="
    Stop-Orion
    if ($Mode -eq 'cold') {
        if (Test-Path $coldBackup) { Remove-Item -Recurse -Force $coldBackup }
        if (Test-Path $dataDir) { Move-Item $dataDir $coldBackup }
    }
    if (Test-Path $logFile) {
        Copy-Item $logFile $logBackup -Force
        Remove-Item $logFile -Force
    }
    if ($Mode -eq 'cold') { New-Item -ItemType Directory -Force $dataDir | Out-Null }

    $startedAt = Get-Date
    Start-Process $AppPath | Out-Null
    $readyMs = Wait-Ready $TimeoutSec
    $wallMs = [int]((Get-Date) - $startedAt).TotalMilliseconds

    $logText = if (Test-Path $logFile) { Get-Content $logFile -Raw -ErrorAction SilentlyContinue } else { '' }
    $metrics = [ordered]@{ ready = $readyMs; wall = $wallMs; run = $run }
    foreach ($m in [regex]::Matches($logText, '\[startup\] phase=(\w+) elapsed_ms=(\d+)')) {
        $metrics["shell:$($m.Groups[1].Value)"] = [int]$m.Groups[2].Value
    }
    foreach ($m in [regex]::Matches($logText, '\[orion-runtime\] startup-stage=(\S+) elapsed-ms=(\d+)')) {
        $metrics["runtime:$($m.Groups[1].Value)"] = [int]$m.Groups[2].Value
    }
    $measurements += [pscustomobject]$metrics
    Stop-Orion
    if ($Mode -eq 'cold') {
        Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
        if (Test-Path $coldBackup) { Move-Item $coldBackup $dataDir }
    }
    Write-Host ("ready={0} ms, wall={1} ms" -f $readyMs, $wallMs)
}

# Агрегация
$columns = $measurements | ForEach-Object { $_.PSObject.Properties.Name } | Sort-Object -Unique | Where-Object { $_ -notin 'run' }
$stats = foreach ($col in $columns) {
    $values = @($measurements | ForEach-Object { $_.$col } | Where-Object { $_ -ge 0 } | Sort-Object)
    if (-not $values) { continue }
    $median = if ($values.Count % 2) { $values[[int]($values.Count / 2)] } else { [int](($values[$values.Count / 2 - 1] + $values[$values.Count / 2]) / 2) }
    $p95 = $values[[int][math]::Ceiling($values.Count * 0.95) - 1]
    [pscustomobject]@{ metric = $col; min = $values[0]; median = $median; p95 = $p95; max = $values[-1]; samples = $values.Count }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$jsonPath = Join-Path $OutDir "benchmark-report-$Mode-$stamp.json"
$mdPath = Join-Path $OutDir "benchmark-report-$Mode-$stamp.md"
$measurements | ConvertTo-Json -Depth 3 | Set-Content $jsonPath -Encoding UTF8
$stats | ConvertTo-Json -Depth 3 | Set-Content "$jsonPath.stats" -Encoding UTF8

$md = @("# Отчёт бенчмарка запуска ($Mode, $Runs прогонов, $stamp)", '',
        'Собрано скриптом scripts/benchmark-startup.ps1 по docs/BENCHMARK_PROTOCOL.md.', '',
        '| Метрика | min, мс | медиана, мс | p95, мс | max, мс | прогонов |', '|---|---|---|---|---|---|')
$md += $stats | ForEach-Object { "| $($_.metric) | $($_.min) | $($_.median) | $($_.p95) | $($_.max) | $($_.samples) |" }
$md += '', 'Прогоны:', '```json', ($measurements | ConvertTo-Json -Depth 3), '```'
$md | Set-Content $mdPath -Encoding UTF8

Write-Host ""
$stats | Format-Table -AutoSize
Write-Host "Отчёт: $mdPath"
