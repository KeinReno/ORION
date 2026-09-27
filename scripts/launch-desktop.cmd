@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node "%~dp0launch-desktop.mjs"
if errorlevel 1 (
  echo.
  echo ORION failed to start. See the message above.
  pause
)
