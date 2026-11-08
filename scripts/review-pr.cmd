@echo off
setlocal
set /p PR=ORION - enter PR number [94]: 
if "%PR%"=="" set "PR=94"
node "%~dp0review-pr.mjs" "%PR%"
echo.
if errorlevel 1 echo Preview failed. Check the error above.
pause
