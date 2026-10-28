@echo off
setlocal
cd /d "%~dp0..\.."
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22.13 or later from https://nodejs.org/ and reopen this file.
  pause
  exit /b 1
)
node scripts\local.mjs preview
set "PLUMA_EXIT=%ERRORLEVEL%"
if not "%PLUMA_EXIT%"=="0" pause
exit /b %PLUMA_EXIT%
