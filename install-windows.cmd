@echo off
setlocal
cd /d "%~dp0"

echo.
echo === GNP Monitor: instalacion Windows ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado.
  echo Instala Node.js LTS desde https://nodejs.org/ y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where msedge >nul 2>nul
if errorlevel 1 (
  echo Microsoft Edge no fue detectado en PATH.
  echo Si Edge esta instalado, puedes continuar; Playwright intentara abrir el canal msedge.
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Se creo .env desde .env.example.
  echo Edita .env con GNP_EMAIL y GNP_PASSWORD antes de usar el monitor.
)

echo Instalando dependencias...
call npm install
if errorlevel 1 (
  echo Fallo npm install.
  pause
  exit /b 1
)

echo Instalando PM2...
call npm install -g pm2
if errorlevel 1 (
  echo Fallo la instalacion de PM2.
  pause
  exit /b 1
)

echo Arrancando monitor...
call pm2 start ecosystem.config.js
call pm2 save

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_FILE=%STARTUP%\gnp-monitor-pm2.cmd"
(
  echo @echo off
  echo cd /d "%~dp0"
  echo pm2 resurrect
) > "%STARTUP_FILE%"

echo.
echo Instalacion terminada.
echo Monitor local: http://127.0.0.1:3000
echo Healthcheck:   http://127.0.0.1:3000/api/health
echo.
pause
