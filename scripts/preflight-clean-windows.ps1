# Preflight-репетиция ORION-R на чистой Windows (реестр #13/#14).
# Прогоняет: установку в каталог с кириллицей → холодный старт → health →
# LAN-режим → тёплый старт → штатное завершение → удаление, и пишет отчёт.
#
# Запуск на целевой машине (из каталога репозитория):
#   powershell -ExecutionPolicy Bypass -File scripts\preflight-clean-windows.ps1 -InstallerPath D:\dist\ORION-Rust_v0.2.1_x64-setup.exe
#
# Только инвентаризация окружения (безопасно везде):
#   powershell -ExecutionPolicy Bypass -File scripts\preflight-clean-windows.ps1 -Stages env
[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$InstallRoot = "C:\Тест-Орион-Preflight",
    [string]$DataDirName = "ORION-Rust",
    [int]$ApiPort = 14000,
    [int]$PgPort = 55442,
    [int]$LanPort = 4443,
    [int]$ReadyTimeoutSec = 180,
    [string[]]$Stages = @('env', 'install', 'cold-start', 'health', 'lan', 'warm-start', 'shutdown', 'uninstall'),
    [string]$OutDir = "."
)

$ErrorActionPreference = 'Continue'
$report = [ordered]@{ host = $env:COMPUTERNAME; stamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); stages = [ordered]@{} }
$timer = [System.Diagnostics.Stopwatch]::New()
function Start-Stage([string]$name) { $script:timer.Restart(); Write-Host "`n=== [$name] ===" -ForegroundColor Cyan }
function Stop-Stage([string]$name, [string]$status, [string]$detail, [object]$data) {
    $script:report.stages[$name] = [ordered]@{ status = $status; detail = $detail; elapsedMs = $script:timer.ElapsedMilliseconds; data = $data }
    $colors = @{ PASS = 'Green'; FAIL = 'Red'; WARN = 'Yellow'; SKIP = 'Gray' }
    $color = $colors[$status]
    Write-Host ("[{0}] {1} ({2} ms) — {3}" -f $name, $status, $script:timer.ElapsedMilliseconds, $detail) -ForegroundColor $color
}
function Test-PortListening([int]$port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
function Wait-AppReady([int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $logFile = Join-Path $env:LOCALAPPDATA "$DataDirName\launcher.log"
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $logFile) {
            $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($content -match 'phase=ready elapsed_ms=(\d+)') { return @{ ok = $true; readyMs = [int]$Matches[1] } }
            if ($content -match 'Локальный сервер завершился|не запустился за') { return @{ ok = $false; readyMs = $null } }
        }
        $alive = Get-Process -Name 'ORION-Rust','orion-runtime' -ErrorAction SilentlyContinue
        if (-not $alive) { return @{ ok = $false; readyMs = $null } }
        Start-Sleep -Seconds 2
    }
    return @{ ok = $false; readyMs = $null }
}
function Stop-App {
    taskkill //IM 'ORION-Rust.exe' //T //F 2>$null | Out-Null
    taskkill //IM 'orion-runtime.exe' //T //F 2>$null | Out-Null
    Start-Sleep -Seconds 3
}

# --- Stage 0: инвентаризация окружения ---
if ($Stages -contains 'env') {
    Start-Stage 'env'
    $os = Get-CimInstance Win32_OperatingSystem
    $exclusions = (Get-MpPreference -ErrorAction SilentlyContinue).ExclusionPath
    $needsExclusion = -not ($exclusions | Where-Object { $_ -like '*ORION*' })
    $exclusionNote = if ($needsExclusion) { 'НЕТ (рекомендуется применить scripts\defender-exclusions.ps1)' } else { 'есть' }
    Stop-Stage 'env' 'PASS' ("{0} {1}; исключения Defender для ORION: {2}" -f $os.Caption, $os.OSArchitecture, $exclusionNote) @{
        os = $os.Caption; arch = $os.OSArchitecture; psVersion = $PSVersionTable.PSVersion.ToString()
        defenderExcluded = (-not $needsExclusion); executionPolicy = (Get-ExecutionPolicy)
    } | Out-Null
}

# --- Stage 1: установка в каталог с кириллицей ---
if ($Stages -contains 'install') {
    Start-Stage 'install'
    if (-not $InstallerPath -or -not (Test-Path $InstallerPath)) {
        Stop-Stage 'install' 'SKIP' "установщик не найден: $InstallerPath" @{}
    } else {
        $proc = Start-Process $InstallerPath -ArgumentList '/S', "/D=$InstallRoot" -Wait -PassThru
        $exe = Join-Path $InstallRoot 'ORION-Rust.exe'
        if ((Test-Path $exe)) {
            Stop-Stage 'install' 'PASS' "установлено в '$InstallRoot', код выхода $($proc.ExitCode)" @{ exitCode = $proc.ExitCode; exe = $exe }
        } else {
            Stop-Stage 'install' 'FAIL' "после установки нет $exe (код $($proc.ExitCode)); проверьте каталог по умолчанию" @{ exitCode = $proc.ExitCode }
        }
    }
}

$exePath = Join-Path $InstallRoot 'ORION-Rust.exe'

# --- Stage 2: холодный старт ---
if ($Stages -contains 'cold-start') {
    Start-Stage 'cold-start'
    if (-not (Test-Path $exePath)) {
        Stop-Stage 'cold-start' 'SKIP' 'приложение не установлено' @{}
    } else {
        Stop-App
        Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA $DataDirName) -ErrorAction SilentlyContinue
        Start-Process $exePath | Out-Null
        $result = Wait-AppReady $ReadyTimeoutSec
        if ($result.ok) {
            Stop-Stage 'cold-start' 'PASS' "ready за $($result.readyMs) мс (initdb + миграции с нуля)" @{ readyMs = $result.readyMs }
        } else {
            Stop-Stage 'cold-start' 'FAIL' "ready не достигнуто за $ReadyTimeoutSec с" @{ log = (Join-Path $env:LOCALAPPDATA "$DataDirName\launcher.log") }
        }
    }
}

# --- Stage 3: health API ---
if ($Stages -contains 'health') {
    Start-Stage 'health'
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/system/health" -TimeoutSec 10 -UseBasicParsing
        $body = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -eq 200 -and $body.database -eq 'ok') {
            Stop-Stage 'health' 'PASS' "GET /system/health → 200, database=ok" @{ statusCode = $response.StatusCode; body = $body }
        } else {
            Stop-Stage 'health' 'FAIL' "health ответил $($response.StatusCode), database=$($body.database)" @{ body = $body }
        }
    } catch {
        Stop-Stage 'health' 'FAIL' "health недоступен: $($_.Exception.Message)" @{}
    }
}

# --- Stage 4: LAN-режим ---
if ($Stages -contains 'lan') {
    Start-Stage 'lan'
    if (-not (Test-Path $exePath)) {
        Stop-Stage 'lan' 'SKIP' 'приложение не установлено' @{}
    } else {
        Stop-App
        $dataDir = Join-Path $env:LOCALAPPDATA $DataDirName
        Set-Content (Join-Path $dataDir 'lan-node.json') "{`"mode`":`"host`",`"port`":$LanPort}" -Encoding UTF8
        Start-Process $exePath | Out-Null
        $result = Wait-AppReady $ReadyTimeoutSec
        $lanListening = Test-PortListening $LanPort
        if ($result.ok -and $lanListening) {
            Stop-Stage 'lan' 'PASS' "LAN host слушает 0.0.0.0:$LanPort, API готов" @{ readyMs = $result.readyMs; lanPort = $LanPort }
        } else {
            Stop-Stage 'lan' 'FAIL' "ready=$($result.ok), порт $LanPort слушается=$lanListening" @{ readyMs = $result.readyMs; lanListening = $lanListening }
        }
        # возврат в local: конфиг удаляем, приложение перезапускаем
        Stop-App
        Remove-Item (Join-Path $dataDir 'lan-node.json') -Force -ErrorAction SilentlyContinue
        Start-Process $exePath | Out-Null
        $relocal = Wait-AppReady $ReadyTimeoutSec
        if (-not $relocal.ok) { Stop-Stage 'lan' 'FAIL' 'после возврата в local приложение не стало готовым' @{ relocalOk = $false } }
        else { $report.stages['lan'].data.relocalOk = $true }
    }
}

# --- Stage 5: тёплый старт ---
if ($Stages -contains 'warm-start') {
    Start-Stage 'warm-start'
    if (-not (Test-Path $exePath)) {
        Stop-Stage 'warm-start' 'SKIP' 'приложение не установлено' @{}
    } else {
        Stop-App
        Start-Sleep -Seconds 2
        Start-Process $exePath | Out-Null
        $result = Wait-AppReady $ReadyTimeoutSec
        if ($result.ok) {
            Stop-Stage 'warm-start' 'PASS' "ready за $($result.readyMs) мс (существующий кластер)" @{ readyMs = $result.readyMs }
        } else {
            Stop-Stage 'warm-start' 'FAIL' 'ready не достигнуто' @{}
        }
    }
}

# --- Stage 6: штатное завершение ---
if ($Stages -contains 'shutdown') {
    Start-Stage 'shutdown'
    Stop-App
    Start-Sleep -Seconds 3
    $orphans = Get-Process -Name 'ORION-Rust','orion-runtime','postgres' -ErrorAction SilentlyContinue
    $portsBusy = (Test-PortListening $ApiPort) -or (Test-PortListening $PgPort)
    if (-not $orphans -and -not $portsBusy) {
        Stop-Stage 'shutdown' 'PASS' 'процессов и слушателей не осталось' @{}
    } else {
        Stop-Stage 'shutdown' 'FAIL' ("сироты: {0}; порты заняты: {1}" -f ($orphans.Name -join ','), $portsBusy) @{ orphans = ($orphans.Name -join ','); portsBusy = $portsBusy }
    }
}

# --- Stage 7: удаление ---
if ($Stages -contains 'uninstall') {
    Start-Stage 'uninstall'
    $uninstaller = Join-Path $InstallRoot 'uninstall.exe'
    if (Test-Path $uninstaller) {
        Start-Process $uninstaller -ArgumentList '/S' -Wait
        Start-Sleep -Seconds 3
        $leftover = Test-Path $exePath
        $dataKept = Test-Path (Join-Path $env:LOCALAPPDATA $DataDirName)
        Stop-Stage 'uninstall' 'PASS' ("exe остался: {0}; данные сохранены: {1} (должно быть True)" -f $leftover, $dataKept) @{ exeLeft = $leftover; dataKept = $dataKept }
    } else {
        Stop-Stage 'uninstall' 'SKIP' "uninstall.exe не найден в $InstallRoot" @{}
    }
}

# --- Отчёт ---
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$jsonPath = Join-Path $OutDir "preflight-report-$stamp.json"
$mdPath = Join-Path $OutDir "preflight-report-$stamp.md"
$report | ConvertTo-Json -Depth 6 | Set-Content $jsonPath -Encoding UTF8
$md = @("# Preflight-отчёт ORION-R ($($report.host), $($report.stamp))", '', '| Этап | Статус | Время, мс | Детали |', '|---|---|---|---|')
foreach ($key in $report.stages.Keys) {
    $s = $report.stages[$key]
    $md += "| $key | $($s.status) | $($s.elapsedMs) | $($s.detail) |"
}
$md += '', '```json', ($report | ConvertTo-Json -Depth 6), '```'
$md | Set-Content $mdPath -Encoding UTF8

$failed = @($report.stages.Values | Where-Object { $_.status -eq 'FAIL' }).Count
Write-Host "`nИтог: $($report.stages.Count) этапов, $failed FAIL. Отчёт: $mdPath" -ForegroundColor $(if ($failed) { 'Red' } else { 'Green' })
exit $(if ($failed) { 1 } else { 0 })
