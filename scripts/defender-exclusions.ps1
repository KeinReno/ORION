# ORION-R: исключения Windows Defender для разработки и dev-стека ORION Rust.
# Запускать в PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА:
#   powershell -ExecutionPolicy Bypass -File scripts\defender-exclusions.ps1
#
# Что делает: добавляет пути в ExclusionPath (real-time сканирование их не
# трогает). Защиту НЕ отключает — исключены только каталоги инструментов и
# данных проекта. Удалить исключение: Remove-MpPreference -ExclusionPath <путь>
#
# Почему: Defender реального времени сканирует каждый запускаемый бинарник и
# открываемый файл. esbuild.exe (его Node-тулчейн спавнит сотни раз за сборку)
# и десятки тысяч мелких JS-файлов node_modules дают эффект «Access is denied»
# и многократно замедляют сборку и запуск. Это исключения ТОЛЬКО для машины
# разработчика; конечные пользователи получают подписанный установщик и эти
# проблемы не видят вообще.

#Requires -RunAsAdministrator

$repo = "C:\Users\Reno\Desktop\ORION-Rust"
$exclusions = @(
    $repo,
    "$env:LOCALAPPDATA\ORION-Rust",          # данные dev-стека и эксперимента
    "$env:USERPROFILE\.cargo",               # Rust toolchain и кэш сборки
    "$env:USERPROFILE\.rustup"               # установленные toolchains Rust
)

$current = @()
try { $current = @(Get-MpPreference | Select-Object -ExpandProperty ExclusionPath) } catch {}

foreach ($path in $exclusions) {
    if (-not (Test-Path $path)) {
        Write-Host "Пропуск (нет каталога): $path"
        continue
    }
    $normalized = (Resolve-Path $path).Path
    if ($current -contains $normalized) {
        Write-Host "Уже исключен: $normalized"
        continue
    }
    Add-MpPreference -ExclusionPath $normalized
    Write-Host "Исключен: $normalized"
}

Write-Host ""
Write-Host "Текущие ExclusionPath:"
@(Get-MpPreference | Select-Object -ExpandProperty ExclusionPath) | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Готово. Проверка esbuild: node_modules\.pnpm\esbuild*\node_modules\esbuild\bin\esbuild.exe --version"
