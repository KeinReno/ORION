$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "ORION.lnk"
$cmd = Join-Path $Root "scripts\launch-desktop.cmd"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $cmd
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 1
$shortcut.Description = "ORION current source"
$ico = Join-Path $Root "apps\desktop\src-tauri\icons\icon.ico"
if (Test-Path $ico) {
  $shortcut.IconLocation = $ico
}
$shortcut.Save()
Write-Output $lnkPath
