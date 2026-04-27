@echo off
cd /d "%~dp0"
pm2 restart gnp-monitor
pm2 status
pause
