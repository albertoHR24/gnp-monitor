# GNP Monitor deployment

## Local

La aplicacion usa Node.js, Express, Playwright y SQLite. Sin `DATA_DIR`, todos los archivos persistentes se crean en `./data/`:

```powershell
npm install
npm start
```

Configuracion minima sugerida en `.env`:

```env
PORT=3000
HOST=127.0.0.1
DATA_DIR=
HEADLESS=false
BROWSER_CHANNEL=msedge
AUTO_REFRESH_MINUTES=10
```

El perfil persistente se guarda por defecto en `data/browser-profile`. Si `DATA_DIR` no esta configurado, se puede usar `PROFILE_DIR` como override para instalaciones locales existentes.

## Docker

El contenedor usa la imagen oficial `mcr.microsoft.com/playwright:v1.50.0-noble` y Chromium incluido en ella:

```bash
docker build -t gnp-monitor .
docker run -p 3000:3000 -v gnp-data:/data gnp-monitor
```

Dentro del contenedor `DATA_DIR=/data`; allí se guardan:

```text
/data/gnp-monitor.db
/data/screenshots/
/data/logs/monitor.log
/data/browser-profile/
/data/session.json
```

Variables habituales para Docker o VPS:

```env
PORT=3000
HOST=0.0.0.0
DATA_DIR=/data
HEADLESS=true
BROWSER_CHANNEL=
AUTO_REFRESH_MINUTES=10
MONITOR_TOKEN=use-a-long-random-token
```

En un VPS donde un operador tenga acceso al navegador gráfico, usa `HEADLESS=false` durante el login manual inicial y conserva el volumen `/data` para reutilizar la sesión.

## Railway

`railway.json` configura el build mediante `Dockerfile`, `npm start` y el healthcheck `GET /health`.

1. Crea el servicio desde este repositorio y deja que Railway use el `Dockerfile`.
2. Agrega un volumen persistente y móntalo en `/data`.
3. Configura como mínimo `DATA_DIR=/data`, `HOST=0.0.0.0`, `PORT=3000`, `HEADLESS=true` y `BROWSER_CHANNEL=`.
4. Configura `MONITOR_TOKEN` si la aplicación quedará expuesta; `TRUST_PROXY=true` y `ALLOWED_IPS` sólo cuando la red/proxy permitan esa restricción.

Railway conserva cookies y SQLite mediante el volumen. Como el navegador corre dentro del contenedor, no puede abrir una ventana en tu PC: usa el boton `Abrir login` y la vista remota integrada para ver y operar esa pagina. Mantener `MONITOR_TOKEN` configurado es obligatorio si expones esta funcion, porque permite ver y controlar la pantalla de login.

Si reCAPTCHA rechaza el navegador headless o la IP del centro de datos aun con operacion manual, la alternativa es un VPS con escritorio remoto o preparar la sesion en un entorno compatible conservando `/data/browser-profile`.

## Login asistido

El servidor no termina si GNP solicita login o reCAPTCHA. Marca `requiresManualLogin: true`, conserva el perfil del navegador y expone controles en la interfaz:

- `Abrir login` prepara la pantalla de acceso y abre la vista del navegador que corre en Railway.
- En la vista remota, haz clic sobre la imagen y utiliza el campo oculto para enviar texto al control seleccionado.
- `Marcar sesion lista` valida que el operador ya inició sesión.
- `Actualizar`, `Pausar` y `Reanudar` operan el monitor.

Los endpoints equivalentes son `GET /api/session/status`, `POST /api/session/start-login`, `GET /api/session/remote-view`, `POST /api/session/remote-action`, `POST /api/session/mark-ready`, `POST /api/monitor/run-now`, `POST /api/monitor/pause` y `POST /api/monitor/resume`.

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
PROFILE_DIR=
MONITOR_TOKEN=
```

`MONITOR_TOKEN` is optional while the monitor only listens on `127.0.0.1`. Set it when exposing the monitor on a LAN or shared PC; POST actions such as run, cancel, continue login, and browser restart will require that token.

For a closed deployment, keep the monitor behind a firewall/VPN whenever possible and restrict the app by IP:

```env
HOST=0.0.0.0
MONITOR_TOKEN=use-a-long-random-token
ALLOWED_IPS=127.0.0.1,192.168.1.50,192.168.1.0/24
TRUST_PROXY=false
```

Use `TRUST_PROXY=true` only when the app is behind a trusted reverse proxy that forwards the real client IP. If enabled, configure the proxy/firewall so users cannot bypass it and reach Node directly.

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

## Healthchecks

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

`/health` es el healthcheck simple del contenedor. `/api/health` incluye modo actual, ultima ejecucion exitosa, scheduler, navegador y advertencias.

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

Los archivos runtime se escriben bajo `DATA_DIR` (`data/` local o `/data` en contenedores), incluyendo SQLite, JSON snapshots, logs y screenshots.
