@echo off
setlocal

set "TARGET=%USERPROFILE%\GNPMonitor"
set "ARCHIVE=%~dp0gnp-monitor-windows.zip"

echo.
echo === GNP Monitor Setup ===
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo PowerShell no esta disponible en esta PC.
  pause
  exit /b 1
)

if not exist "%ARCHIVE%" (
  echo No encontre gnp-monitor-windows.zip junto al instalador.
  pause
  exit /b 1
)

echo Instalando en: %TARGET%
if not exist "%TARGET%" mkdir "%TARGET%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ARCHIVE%' -DestinationPath '%TARGET%' -Force"
if errorlevel 1 (
  echo No pude descomprimir el monitor.
  pause
  exit /b 1
)

cd /d "%TARGET%"
call install-windows.cmd
