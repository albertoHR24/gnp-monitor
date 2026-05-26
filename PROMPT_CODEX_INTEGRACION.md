# Prompt para Codex: integrar GNP Monitor en otro proyecto

Copia este prompt en Codex dentro del proyecto destino. Adjunta o referencia este proyecto fuente de GNP Monitor para que pueda leer sus archivos.

```text
Necesito integrar en este proyecto una copia funcional de GNP Monitor como nueva integracion, tomando como fuente el proyecto `gnp-monitor`.

Objetivo principal:
- Duplicar la funcionalidad del proyecto fuente dentro de este proyecto existente.
- Integrarlo sin romper la aplicacion actual, sus rutas, scripts, estilos, build ni despliegue.
- Mantener GNP Monitor operable como modulo propio con backend, frontend, persistencia, seguridad, scheduler, Playwright, bitacora y exportacion/importacion Excel.

Primero inspecciona ambos proyectos:
- Proyecto destino: estructura, framework, runtime, scripts, rutas, middleware, frontend, sistema de estilos, variables de entorno y despliegue.
- Proyecto fuente GNP Monitor: `gnp-monitor.js`, `public/index.html`, `public/app.js`, `public/styles.css`, `.env.example`, `package.json`, `tests/pure.test.js`, `DEPLOYMENT.md`, scripts Windows/PM2/Docker si aplican.

Resumen del proyecto fuente:
- Runtime: Node.js + Express.
- Automatizacion: Playwright Chromium/Edge.
- Persistencia: SQLite con `better-sqlite3` en `data/gnp-monitor.db`, mas archivos JSON/log/debug en `data/`.
- Frontend: HTML/CSS/JS vanilla servido desde `public/`.
- Funcionalidad: consulta ordenes de trabajo GNP, login automatico/manual, snapshots, comparacion de cambios, UI Monitor, UI Bitacora, modo TV, scheduler, endpoints HTTP, importacion/exportacion Excel.
- Dependencias clave: `express`, `dotenv`, `playwright`, `better-sqlite3`, `xlsx`.

Archivos fuente que normalmente debes copiar o adaptar:
- `gnp-monitor.js`: logica principal del backend, API, Playwright, SQLite y scheduler.
- `public/index.html`: UI del monitor.
- `public/app.js`: logica del frontend.
- `public/styles.css`: estilos del monitor.
- `.env.example`: variables necesarias.
- `tests/pure.test.js`: pruebas de funciones puras.
- `DEPLOYMENT.md`: instrucciones utiles para despliegue.
- `ecosystem.config.js`, `Dockerfile`, scripts `.cmd` y `.ps1` solo si el proyecto destino necesita operacion Windows/PM2/Docker.

No copies datos sensibles ni artefactos generados:
- No copies `.env` real.
- No copies `node_modules/`.
- No copies `data/` salvo que el usuario pida migrar datos existentes.
- No copies `dist/` salvo que el usuario pida conservar instaladores ya generados.
- No expongas credenciales `GNP_EMAIL` o `GNP_PASSWORD`.

Forma de integracion preferida:
1. Si el proyecto destino ya tiene backend Node/Express:
   - Monta GNP Monitor como submodulo aislado, por ejemplo en `/integrations/gnp-monitor` o `/gnp-monitor`.
   - Evita mezclar toda la logica en el entrypoint principal si se puede encapsular.
   - Expone la UI bajo una ruta propia, por ejemplo `/gnp-monitor`.
   - Expone la API bajo prefijo propio, por ejemplo `/gnp-monitor/api`.
   - Ajusta rutas frontend si el proyecto fuente asumia `/api/...` y assets en `/`.
2. Si el proyecto destino no es Express o tiene otro backend:
   - Integra GNP Monitor como servicio interno separado y documenta como levantarlo junto al proyecto.
   - Conecta el proyecto destino consumiendo la API HTTP del monitor.
3. Si el proyecto destino es frontend-only:
   - Mantiene GNP Monitor como servicio Node aparte.
   - Agrega documentacion y variables para que el frontend consuma `/api/status`, `/api/run`, `/api/bitacora`, etc.

Endpoints que deben mantenerse, aunque sea bajo prefijo:
- `GET /api/health`
- `GET /api/status`
- `POST /api/run`
- `POST /api/continue-manual-login`
- `POST /api/cancel`
- `POST /api/restart-browser`
- `GET /api/bitacora`
- `GET /api/bitacora/:id/history`
- `GET /api/bitacora/excel`
- `POST /api/bitacora/import-excel`
- `POST /api/bitacora`
- `PUT /api/bitacora/:id`
- `DELETE /api/bitacora/:id`
- `POST /api/bitacora/:id/restore`

Variables de entorno que debes conservar o adaptar:
- `PORT`, `HOST`
- `MONITOR_TOKEN`, `ALLOWED_IPS`, `TRUST_PROXY`
- `GNP_EMAIL`, `GNP_PASSWORD`
- `LOGIN_URL`, `INICIO_URL`, `DASHBOARD_URL`, `CONSULTA_URL`
- `WORKFLOW_NAME`
- `BROWSER_CHANNEL`, `PROFILE_DIR`, `HEADLESS`
- `AUTO_REFRESH_MINUTES`
- `MANUAL_LOGIN_TIMEOUT_MINUTES`, `RUN_TIMEOUT_MINUTES`
- `PAGE_RECOVERY_ATTEMPTS`, `QUERY_RECOVERY_ATTEMPTS`, `CONSULTA_READY_TIMEOUT_MS`
- `KEEP_SCREENSHOTS`, `MAX_LOG_BYTES`
- `USE_DIRECT_API`, `DIRECT_QUERY_MAX_PAGES`
- `QUERY_DATE_FROM`, `QUERY_DATE_TO`
- `TV_ROWS_PER_PAGE`, `TV_PAGE_SECONDS`, `TV_HIDE_TERMINADAS`, `TV_STALE_MINUTES`, `TV_SOUND_ENABLED`, `TV_STATUS_POLL_SECONDS`, `TV_AUTO_SCROLL`, `TV_SCROLL_PIXELS`, `TV_SCROLL_INTERVAL_MS`

Requisitos de seguridad:
- Mantener `MONITOR_TOKEN` para proteger endpoints de operacion.
- Mantener `/api/health` sin token para healthchecks.
- Mantener filtro `ALLOWED_IPS` si el monitor escucha fuera de localhost.
- No registrar ni mostrar tokens, passwords ni query strings sensibles.
- Si se monta bajo proxy, revisar `TRUST_PROXY` y documentarlo.

Requisitos de persistencia:
- Usar un directorio configurable para runtime, idealmente `data/` dentro del modulo o una variable nueva como `GNP_MONITOR_DATA_DIR` si el proyecto destino ya usa `data/`.
- Mantener SQLite y snapshots sin chocar con archivos del proyecto destino.
- Crear directorios automaticamente si faltan.
- No borrar ni migrar datos existentes sin pedir confirmacion.

Requisitos frontend:
- Mantener las dos vistas: Monitor y Bitacora.
- Mantener modos Operador y TV.
- Mantener polling, token en `localStorage`, filtros, tabla, panel detalle, ticker de cambios, bitacora, historial, importacion y exportacion Excel.
- Si el monitor queda bajo prefijo, ajustar fetches y links de `public/app.js` para usar base path configurable.
- Evitar que los estilos globales del monitor rompan la UI existente. Si el destino comparte pagina/layout, encapsula con prefijo de clase, iframe o ruta dedicada.

Requisitos de pruebas:
- Ejecuta las pruebas existentes o crea equivalentes:
  - validacion de sintaxis del backend integrado.
  - validacion de sintaxis de frontend si aplica.
  - pruebas puras de `compareRows`, `extractItems`, `sortRows`, `mergeCurrentMonthWithOpenOlderRows`, `publicSessionInfo`, `buildGetPendientesUrl`.
- Si cambias prefijos de API o rutas, prueba que la UI cargue y pueda consultar `/status`.
- No dejes tests rotos del proyecto destino.

Plan de trabajo esperado:
1. Inspecciona estructura y scripts del proyecto destino.
2. Decide la estrategia de integracion mas segura: subapp Express, servicio separado o frontend consumidor.
3. Copia/adapta archivos de GNP Monitor en una carpeta aislada.
4. Agrega dependencias necesarias sin eliminar dependencias existentes.
5. Adapta rutas, base path, assets, variables de entorno y almacenamiento.
6. Integra scripts de arranque/desarrollo/despliegue.
7. Ejecuta pruebas y corrige errores.
8. Documenta:
   - como configurar `.env`.
   - como levantar el monitor.
   - URL final de la UI.
   - endpoints disponibles.
   - archivos de datos generados.
   - diferencias frente al proyecto fuente.

Criterios de aceptacion:
- La aplicacion existente sigue arrancando.
- La nueva integracion GNP Monitor carga en una ruta clara.
- `GET /api/health` o su equivalente prefijado responde correctamente.
- `GET /api/status` o su equivalente prefijado responde correctamente.
- La UI puede pedir token cuando `MONITOR_TOKEN` esta configurado.
- `POST /api/run` o su equivalente prefijado inicia consulta o responde `busy` si ya hay una en curso.
- Bitacora permite crear, editar, archivar/restaurar, importar y exportar.
- El modo TV sigue funcionando.
- Las pruebas relevantes pasan.
- Queda documentado como operar la integracion en el proyecto destino.

Importante:
- No hagas refactors grandes antes de tener la copia funcionando.
- No mezcles credenciales reales ni datos generados.
- No borres cambios existentes del proyecto destino.
- Si una ruta global como `/api/status` ya existe, usa prefijo propio `/gnp-monitor/api/status` y ajusta el frontend.
- Si el proyecto destino no puede ejecutar Playwright en su entorno actual, deja la integracion preparada y documenta los requisitos exactos para habilitarla.
```

## Inventario rapido del proyecto fuente

- Entrada backend: `gnp-monitor.js`
- UI: `public/index.html`
- JS frontend: `public/app.js`
- CSS frontend: `public/styles.css`
- Config ejemplo: `.env.example`
- Tests: `tests/pure.test.js`
- Persistencia runtime: `data/`
- Paquetes generados: `dist/`
- Comando local: `npm install` y `npm start`
- Pruebas: `npm test`
- URL local por defecto: `http://127.0.0.1:3000`

## Nota para integracion por API en vez de duplicar codigo

Si el proyecto destino solo necesita consumir datos, no dupliques el backend completo. Levanta GNP Monitor como servicio aparte y consume:

- `GET /api/status?full=1` para datos, resumen, diff y bitacora.
- `POST /api/run` para disparar consulta.
- `GET /api/bitacora` y CRUD de bitacora para seguimiento.
- `GET /api/bitacora/excel` para descargar reporte.
- `GET /api/health` para monitoreo.

