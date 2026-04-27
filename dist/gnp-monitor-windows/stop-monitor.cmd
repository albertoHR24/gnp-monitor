@echo off
cd /d "%~dp0"
pm2 stop gnp-monitor
pm2 save
pm2 status
pause
