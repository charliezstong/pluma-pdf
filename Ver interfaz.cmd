@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js 22.13 o posterior desde https://nodejs.org/ y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node scripts\local.mjs preview
set "PLUMA_EXIT=%ERRORLEVEL%"
if not "%PLUMA_EXIT%"=="0" pause
exit /b %PLUMA_EXIT%
