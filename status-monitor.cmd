@echo off
cd /d "%~dp0"
pm2 status
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod http://127.0.0.1:3000/api/health -TimeoutSec 5 | ConvertTo-Json -Depth 5 } catch { $_.Exception.Message }"
pause
