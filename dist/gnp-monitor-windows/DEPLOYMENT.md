# GNP Monitor deployment

## Windows package for another PC

On this development PC, create the ZIP:

```powershell
powershell -ExecutionPolicy Bypass -File .\package-windows.ps1
```

Copy `dist\gnp-monitor-windows.zip` to the other Windows PC, extract it, and run:

```powershell
.\install-windows.cmd
```

To create a single portable installer executable instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\make-installer-exe.ps1
```

Copy `dist\GNPMonitorSetup.exe` to the other Windows PC and run it. It extracts the monitor to `%USERPROFILE%\GNPMonitor` and starts `install-windows.cmd`.

The installer:

- creates `.env` from `.env.example` if needed,
- runs `npm install`,
- installs PM2,
- starts the monitor,
- saves the PM2 process list,
- adds a startup script for the current Windows user.

Before using it, edit `.env` on the target PC and set at least:

```env
GNP_EMAIL=
GNP_PASSWORD=
PROFILE_DIR=C:\GNPMonitorProfile
```

The target PC needs Node.js LTS and Microsoft Edge installed.

Useful Windows scripts:

```powershell
.\start-monitor.cmd
.\stop-monitor.cmd
.\restart-monitor.cmd
.\status-monitor.cmd
.\logs-monitor.cmd
```

## Run with PM2

```powershell
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

Useful commands:

```powershell
pm2 status
pm2 logs gnp-monitor
pm2 restart gnp-monitor
pm2 stop gnp-monitor
```

## Healthcheck

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

The endpoint returns current mode, last successful run, scheduler state, browser state, and config warnings.

## Operational env vars

```env
RUN_TIMEOUT_MINUTES=5
PAGE_RECOVERY_ATTEMPTS=3
QUERY_RECOVERY_ATTEMPTS=2
CONSULTA_READY_TIMEOUT_MS=25000
KEEP_SCREENSHOTS=100
MAX_LOG_BYTES=1048576
INICIO_URL=https://portalintermediarios.gnp.com.mx/home/dashboard
CONSULTA_URL=https://portalintermediarios.gnp.com.mx/home/pagina-iframe?tipo=aplicacion&menu=Todos%20los%20ramos%20Consulta
```

Runtime files are written under `data/`, including `monitor.log`, JSON snapshots, and screenshots.
