# KAIDEN Orion Mobile alpha.29 — local Windows build (no GitHub Actions).
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\android-build-local-alpha29.ps1 -RepoPath "C:\Users\gvi\Desktop\ORION"
param(
  [string]$RepoPath = "C:\Users\gvi\Desktop\ORION",
  [string]$Destination = "",
  [string]$PreviousApk = ""
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$Branch = "feat/android-living-cosmos-alpha29"
$RepoPath = (Resolve-Path $RepoPath).Path
if (-not $Destination) { $Destination = Join-Path (Split-Path $RepoPath -Parent) "ORION-alpha29-local-build" }
$Destination = [System.IO.Path]::GetFullPath($Destination)
$target = Join-Path $Destination "apps\android\android\app\build\outputs\apk\debug\app-debug.apk"
$out = Join-Path (Split-Path $Destination -Parent) "KAIDEN-Orion-0.1.28-android-alpha.29-debug.apk"
function Run([string]$Exe, [string[]]$Arguments) {
  Write-Host ">> $Exe $($Arguments -join ' ')" -ForegroundColor Cyan
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe failed (exit $LASTEXITCODE)" }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Install Git for Windows." }
if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw "Install JDK 21." }
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path (Join-Path $sdk "platforms"))) { throw "Android SDK not found at $sdk. Install SDK Platform 36 and Build Tools with Android Studio." }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue) -and -not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  throw "Install pnpm 9.12.0 (or Node.js Corepack)."
}
$pnpm = if (Get-Command pnpm -ErrorAction SilentlyContinue) { "pnpm" } else { "corepack" }
$prefix = if ($pnpm -eq "corepack") { @("pnpm") } else { @() }
if (-not (Test-Path $Destination)) {
  # A separate worktree protects the current Orion checkout and local changes.
  Run "git" @("-C", $RepoPath, "fetch", "origin", "refs/heads/$Branch")
  Run "git" @("-C", $RepoPath, "worktree", "add", "--detach", $Destination, "FETCH_HEAD")
}
if (-not (Test-Path (Join-Path $Destination "apps\android\package.json"))) { throw "The build folder does not contain Orion Android." }
Push-Location $Destination
try {
  Run $pnpm ($prefix + @("install", "--frozen-lockfile"))
  Run $pnpm ($prefix + @("--filter", "@orion/android", "build"))
  Run $pnpm ($prefix + @("--filter", "@orion/android", "android:sync"))
  Push-Location "apps\android\android"
  try { Run ".\gradlew.bat" @("assembleDebug", "--console=plain", "--no-daemon") }
  finally { Pop-Location }
  if (-not (Test-Path $target)) { throw "Gradle finished but APK was not found: $target" }
  Copy-Item -LiteralPath $target -Destination $out -Force
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $out
  Write-Host "APK: $out" -ForegroundColor Green
  Write-Host "SHA256: $($hash.Hash)"
  Write-Warning "Debug signing certificates might differ from the installed alpha.28. Do not uninstall alpha.28 without exporting a backup."
  if ($PreviousApk -and (Test-Path $PreviousApk)) {
    $signer = Get-ChildItem (Join-Path $sdk "build-tools") -Directory | Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "apksigner.bat" } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($signer) {
      $old = (& $signer verify --print-certs $PreviousApk | Select-String "certificate SHA-256 digest").ToString()
      $new = (& $signer verify --print-certs $out | Select-String "certificate SHA-256 digest").ToString()
      if ($old -ne $new) { Write-Warning "APK signers DIFFER. Update over alpha.28 will be rejected; protect your existing data." }
      else { Write-Host "Signer matches previous APK; in-place update should be possible." -ForegroundColor Green }
    }
  }
} finally { Pop-Location }
