# Documentacion de funcionalidad e integracion - GNP Monitor

Este proyecto es un monitor local para consultar ordenes de trabajo del portal de intermediarios GNP, comparar cambios entre consultas, mostrar una UI operativa/TV y mantener una bitacora de seguimiento con auditoria, importacion y exportacion Excel.

## Resumen tecnico

- Runtime: Node.js con Express.
- Automatizacion: Playwright Chromium, usando Microsoft Edge por defecto en Windows.
- Frontend: HTML, CSS y JavaScript vanilla en `public/`.
- Persistencia principal: SQLite en `data/gnp-monitor.db`.
- Persistencia auxiliar: JSON bajo `data/` para snapshots, estado actual/anterior, diffs, logs y debug.
- Exportacion/importacion: Excel XML/XLS y lectura con `xlsx`.
- Operacion: scripts Windows, PM2, Docker y paquete instalable en `dist/`.

## Archivos principales

- `gnp-monitor.js`: backend completo. Define configuracion, seguridad, base de datos, flujo Playwright, comparacion de OTs, bitacora, API HTTP, scheduler y arranque.
- `public/index.html`: estructura de UI. Incluye cabecera, modo Monitor, modo Bitacora, modo TV, tabla de OTs, paneles laterales y formularios.
- `public/app.js`: logica del frontend. Hace polling a la API, renderiza tablas/resumen/alertas, maneja acciones del usuario, bitacora, Excel y modo TV.
- `public/styles.css`: estilos responsivos de todo el monitor.
- `.env.example`: variables de configuracion requeridas y opcionales.
- `tests/pure.test.js`: pruebas unitarias puras para funciones exportadas del backend.
- `DEPLOYMENT.md`: instrucciones de despliegue Windows, PM2, Railway/Docker.
- `ecosystem.config.js`: configuracion PM2.
- `Dockerfile`: imagen Playwright para despliegue Linux.
- `install-windows.cmd`, `start-monitor.cmd`, `stop-monitor.cmd`, `restart-monitor.cmd`, `status-monitor.cmd`, `logs-monitor.cmd`: operacion Windows/PM2.
- `package-windows.ps1`, `make-installer-exe.ps1`: empaquetado para otro equipo Windows.

## Como ejecutar

Instalacion local:

```powershell
npm install
copy .env.example .env
npm start
```

URL local por defecto:

```text
http://127.0.0.1:3000
```

Pruebas:

```powershell
npm test
```

El script de pruebas valida sintaxis de `gnp-monitor.js`, sintaxis de `public/app.js` y ejecuta `tests/pure.test.js`.

## Configuracion

El backend carga `.env` con `dotenv`. Variables clave:

- `PORT`: puerto HTTP. Por defecto `3000`.
- `HOST`: host de escucha. Por defecto `127.0.0.1`.
- `MONITOR_TOKEN`: token opcional para proteger endpoints. Si se define, la UI lo pide y lo envia.
- `ALLOWED_IPS`: lista separada por comas de IPs o CIDR permitidos.
- `TRUST_PROXY`: habilita `app.set("trust proxy", true)` cuando hay proxy confiable.
- `GNP_EMAIL`, `GNP_PASSWORD`: credenciales para login automatico.
- `LOGIN_URL`, `INICIO_URL`/`DASHBOARD_URL`, `CONSULTA_URL`: URLs del portal GNP.
- `BROWSER_CHANNEL`: en Windows suele ser `msedge`; en Linux debe quedar vacio para Chromium.
- `PROFILE_DIR`: perfil persistente del navegador.
- `HEADLESS`: `true` para correr sin ventana, `false` para operacion local visible.
- `AUTO_REFRESH_MINUTES`: intervalo automatico de consulta. `0` desactiva scheduler.
- `MANUAL_LOGIN_TIMEOUT_MINUTES`: espera maxima para login manual.
- `RUN_TIMEOUT_MINUTES`: timeout total de una consulta.
- `PAGE_RECOVERY_ATTEMPTS`, `QUERY_RECOVERY_ATTEMPTS`: reintentos de recuperacion.
- `CONSULTA_READY_TIMEOUT_MS`: espera para que cargue la pantalla de consulta.
- `KEEP_SCREENSHOTS`: cantidad maxima de capturas en `data/screenshots`.
- `MAX_LOG_BYTES`: rotacion simple del log persistente.
- `USE_DIRECT_API`: intenta consulta directa a `getPendientes` antes del flujo visual.
- `DIRECT_QUERY_MAX_PAGES`: maximo de paginas al consultar API directa.
- `QUERY_DATE_FROM`, `QUERY_DATE_TO`: rango de fechas. `QUERY_DATE_TO=today` usa fecha actual.
- Variables `TV_*`: controlan filas, carrusel, ocultamiento de terminadas, stale alert, sonido, polling y autoscroll en modo TV.

## Seguridad

La app aplica:

- Headers basicos: deshabilita sniffing, frame embedding y cache.
- Filtro IP con `ALLOWED_IPS`.
- Token opcional con `MONITOR_TOKEN`.
- Sanitizado de URLs en respuestas publicas para no exponer query strings.
- Ocultamiento de campos sensibles de sesion como previews de bearer token.

Cuando `MONITOR_TOKEN` esta activo, los endpoints protegidos aceptan el token por:

- Header `x-monitor-token`.
- Header `authorization: Bearer <token>`.
- Query `?monitorToken=<token>` para descargas como Excel.

`/api/health` queda sin token para healthchecks.

## Persistencia y datos generados

El directorio `data/` se crea automaticamente. Archivos relevantes:

- `gnp-monitor.db`: SQLite principal.
- `monitor.log`: log persistente.
- `session-info.json`: estado sanitizado de sesion/navegador.
- `estado-anterior.json`: snapshot anterior.
- `estado-actual.json`: snapshot actual.
- `cambios.json`: diff entre snapshot anterior y actual.
- `raw-response.json`: respuesta cruda de consulta cuando aplica.
- `items-extraidos.json`: filas normalizadas extraidas.
- `debug-captured.json`, `debug-requests.json`: informacion de depuracion.
- `bitacora-seguimiento.xls`: reporte Excel generado.
- `screenshots/`: capturas de error/flujo.

## Modelo SQLite

Tablas:

- `bitacora`: registros manuales de seguimiento. Campos principales: `id`, `folio`, `poliza`, `cliente`, `tramite`, `estado`, `responsable`, fechas, descripcion, comentarios, aseguradora, version y archivo logico.
- `bitacora_history`: historial versionado por registro. Guarda accion, fecha, usuario, motivo, JSON antes y despues.
- `monitor_snapshots`: captura de corrida del monitor con diff/raw/debug.
- `monitor_rows`: filas normalizadas de cada snapshot, indexadas por `snapshot_id` y `ot`.
- `bitacora_comparativas`: historial de comparativas bitacora vs monitor.
- `alertas`: alertas derivadas de comparativas.

El backend migra automaticamente bitacoras antiguas desde `data/bitacora.json` si la tabla esta vacia.

## Flujo de consulta GNP

La funcion principal es `runMonitor(trigger)`.

Secuencia:

1. Evita ejecuciones concurrentes si `runtime.busy` esta activo.
2. Cancela temporalmente el scheduler si hay uno programado.
3. Inicializa estado runtime, log y timeout total.
4. Obtiene o crea contexto Playwright persistente con `PROFILE_DIR`.
5. Obtiene pagina activa.
6. Verifica sesion existente o intenta login automatico con `GNP_EMAIL` y `GNP_PASSWORD`.
7. Si hay captcha, MFA, bloqueo o formulario no resoluble, cambia a `waiting_manual_login`.
8. Navega dashboard/consulta.
9. Si `USE_DIRECT_API=true`, intenta capturar o inferir parametros y consultar `getPendientes`.
10. Si no hay datos directos, usa flujo visual: selecciona workflow `Gastos Medicos Mayores`, pulsa consultar/buscar y captura filas.
11. Normaliza filas con campos esperados de OT.
12. Lee snapshot anterior y compara contra el actual.
13. Persiste JSON, SQLite y Excel.
14. Actualiza runtime, sesion y logs.
15. Reprograma scheduler si `AUTO_REFRESH_MINUTES` es mayor a cero.

Estados principales del runtime:

- `idle`: sin actividad.
- `booting`: preparando navegador.
- `checking_session`: verificando sesion.
- `auto_login`: intentando login automatico.
- `waiting_manual_login`: requiere accion manual.
- `querying`: consultando portal.
- `done`: consulta terminada.
- `error`: fallo o cancelacion.

## Login manual

Cuando el backend no puede autenticar automaticamente:

- Deja el navegador abierto.
- Expone `manualLogin.required=true`.
- La UI muestra banner con pasos.
- El usuario completa login en la ventana del navegador.
- El boton `Login manual` llama `POST /api/continue-manual-login`.
- El backend valida que ya no este en pantalla de login y continua la consulta.

## Normalizacion de ordenes

Cada item del portal/API se mapea a:

- `ot`
- `usuarioCreador`
- `estatus`
- `poliza`
- `agente`
- `contratante`
- `tipoSolicitud`
- `producto`
- `fechaCompromiso`
- `fechaRegistro`
- `primerIngreso`
- `ultimoIngreso`
- `guia`
- `medioApertura`
- `rol`
- `raw`

La comparacion usa `ot` como llave principal. Si hay duplicados, genera warning y usa la ultima fila vista para esa OT.

## Reglas de comparacion

`compareRows(previousRows, currentRows)` produce:

- `summary.totalAnterior`
- `summary.totalActual`
- `summary.nuevos`
- `summary.cambiados`
- `summary.eliminados`
- `summary.iguales`
- `nuevos`: filas nuevas.
- `cambiados`: objetos con `ot`, `previous`, `current` y lista `changes`.
- `eliminados`: filas que estaban antes y ya no estan.
- `iguales`: filas sin cambios.
- `warnings`: duplicados u observaciones.

Campos revisados para cambios:

- `estatus`
- `fechaCompromiso`
- `poliza`
- `agente`
- `contratante`
- `tipoSolicitud`
- `producto`
- `fechaRegistro`
- `primerIngreso`
- `ultimoIngreso`
- `guia`
- `medioApertura`
- `rol`

Las filas se ordenan por `fechaCompromiso` y luego por `ot`.

## Regla de vista actual

El monitor mezcla:

- Registros del mes de referencia.
- Registros abiertos de meses anteriores.
- Registros que coinciden con bitacora activa aunque no pertenezcan al mes.

Las terminadas archivadas desde bitacora se ocultan del monitor mediante llaves de folio/OT o poliza.

## Bitacora

La bitacora es un modulo de seguimiento manual comparado contra el monitor.

Campos capturados desde UI:

- `folio`: Folio / OT.
- `poliza`.
- `cliente`.
- `tramite`.
- `estado`: `PENDIENTE`, `EN PROCESO`, `TERMINADA`, `RECHAZADA`, `CANCELADA`.
- `responsable`.
- `fechaEntradaCorreo`.
- `fechaEntrega`.
- `fechaSalida`.
- `descripcion`.
- `comentarios`.
- `aseguradora`.

Funciones:

- Crear registro.
- Detectar registro existente por folio o poliza.
- Si existe, agrega seguimiento al historial en lugar de duplicar.
- Editar con motivo obligatorio.
- Archivar con motivo obligatorio.
- Restaurar archivados con motivo obligatorio.
- Importar Excel.
- Exportar Excel.
- Ver historial versionado.
- Comparar manual vs monitor.

Clasificacion de seguimiento:

- `sin_monitor`: no existe OT/poliza en monitor.
- `inconsistente`: el estado manual cerrado/abierto no coincide con estado de monitor.
- `vencida`: no esta cerrado y la fecha de entrega/compromiso ya paso.
- `sin_responsable`: no tiene responsable.
- `cerrada`: monitor cerrado.
- `al_corriente`: caso abierto sin alerta.

La comparativa tambien detecta OTs abiertas en monitor sin bitacora (`sin_bitacora`).

## Excel

Exportacion:

- Endpoint: `GET /api/bitacora/excel`.
- Genera `data/bitacora-seguimiento.xls`.
- Incluye bitacora, comparativa y alertas segun la implementacion de `writeBitacoraExcel`.

Importacion:

- Endpoint: `POST /api/bitacora/import-excel`.
- Body crudo binario.
- Usa `xlsx` para leer filas.
- Detecta encabezados con normalizacion flexible.
- Importa registros y crea auditoria con `changed_by` y `reason` si se mandan.

## API HTTP

Base local por defecto:

```text
http://127.0.0.1:3000
```

### `GET /`

Sirve `public/index.html`.

### `GET /api/health`

Healthcheck sin token.

Devuelve:

- `ok`
- `busy`
- `mode`
- `message`
- `error`
- `serverTime`
- fechas de ultima corrida exitosa/fallida
- estado de navegador
- scheduler
- auth
- warnings de configuracion

### `GET /api/status`

Protegido por token si `MONITOR_TOKEN` existe.

Query:

- `full=1`: fuerza incluir `data` y `diff`.
- `since=<dataVersion>`: si no cambio, puede devolver `data:null` y `diff:null`.

Devuelve:

- estado runtime
- resumen
- datos de OT si aplica
- diff si aplica
- bitacora comparada
- logs recientes
- sesion publica
- login manual
- scheduler
- configuracion TV
- rango de consulta

### `GET /api/bitacora`

Devuelve comparativa actual de bitacora vs monitor y conteos de DB.

### `GET /api/bitacora/:id/history`

Devuelve registro actual e historial versionado.

### `GET /api/bitacora/excel`

Descarga Excel generado.

### `POST /api/bitacora/import-excel`

Importa archivo Excel desde body binario.

### `POST /api/bitacora`

Crea registro o agrega seguimiento a un existente.

Body esperado:

```json
{
  "folio": "OT123",
  "poliza": "POL123",
  "cliente": "Cliente",
  "tramite": "Tramite",
  "estado": "PENDIENTE",
  "responsable": "Usuario",
  "fechaEntradaCorreo": "2026-05-13",
  "fechaEntrega": "2026-05-20",
  "fechaSalida": "",
  "descripcion": "",
  "comentarios": "",
  "aseguradora": "GNP",
  "changedBy": "Operador",
  "reason": "Captura inicial"
}
```

Debe traer al menos `folio` o `poliza`.

### `PUT /api/bitacora/:id`

Actualiza registro. Requiere motivo (`reason`).

### `DELETE /api/bitacora/:id`

Archiva registro. Requiere motivo (`reason`).

### `POST /api/bitacora/:id/restore`

Restaura registro archivado. Requiere motivo (`reason`).

### `POST /api/run`

Inicia consulta manual. Si hay otra en curso devuelve `busy`.

### `POST /api/continue-manual-login`

Continua despues de login manual.

### `POST /api/cancel`

Cancela ejecucion activa.

### `POST /api/restart-browser`

Cierra contexto Playwright y obliga a recrearlo en la siguiente consulta. No permite reiniciar si hay ejecucion en curso.

## Frontend

La UI tiene dos vistas principales:

- Monitor.
- Bitacora.

Y dos modos de presentacion:

- Operador: tabla paginada, filtros, panel lateral y acciones.
- TV: pensado para pantalla. Oculta controles secundarios, usa carrusel/autoscroll, alertas visuales, reloj y metadatos.

### Monitor

Componentes:

- Tarjetas resumen: total, nuevos, modificados, vencidas, vencen hoy, eliminados y estado.
- Filtros rapidos: todos, vencidas, vencen hoy, abiertas, cambiadas, nuevas.
- Ticker de cambios.
- Tabla de OTs con columnas completas.
- Panel de actividad: logs y cambios.
- Panel detalle de OT: muestra campos de la fila, cambios y botones de copiar/enviar a bitacora.

Acciones:

- `Actualizar`: llama `POST /api/run`.
- `Login manual`: llama `POST /api/continue-manual-login`.
- `Cancelar`: llama `POST /api/cancel`.
- `Reiniciar`: llama `POST /api/restart-browser`.
- `Refrescar`: llama `GET /api/status`.
- Doble clic en OT: precarga la bitacora con datos del monitor.

### Bitacora UI

Componentes:

- Resumen: total, al corriente, vencidas, inconsistentes, sin monitor, sin bitacora.
- Alertas clicables.
- Formulario de captura/edicion.
- Filtros por texto, estado y fecha.
- Tabla con seguimiento, coincidencia, datos manuales vs monitor, responsable, entrega, comentarios, version y acciones.
- Historial expandible.
- Modo maximizado.

Acciones:

- Guardar.
- Editar.
- Agregar seguimiento.
- Archivar.
- Restaurar.
- Importar Excel.
- Exportar Excel.

### Polling y token

`public/app.js` consulta `/api/status` periodicamente. Si recibe `401`, pide token por prompt y lo guarda en `localStorage` como `gnpMonitorToken`.

Preferencias guardadas en `localStorage`:

- `gnpUiMode`
- `gnpMainView`
- `gnpQuickFilter`
- `gnpOperatorName`
- `gnpTvOverrides`
- `gnpMonitorToken`

## Scheduler

Si `AUTO_REFRESH_MINUTES > 0`, el backend programa una consulta automatica. Si hay ejecucion activa, reintenta 30 segundos despues. El estado del scheduler se expone en `/api/status` y `/api/health`.

## Despliegue Windows

Flujo recomendado:

```powershell
powershell -ExecutionPolicy Bypass -File .\package-windows.ps1
```

Copiar `dist\gnp-monitor-windows.zip`, extraer y ejecutar:

```powershell
.\install-windows.cmd
```

El instalador:

- Crea `.env` desde `.env.example` si falta.
- Ejecuta `npm install`.
- Instala PM2 global.
- Arranca `gnp-monitor` con `ecosystem.config.js`.
- Ejecuta `pm2 save`.
- Agrega script de startup para el usuario actual.

Tambien se puede generar `dist\GNPMonitorSetup.exe` con:

```powershell
powershell -ExecutionPolicy Bypass -File .\make-installer-exe.ps1
```

## Despliegue Docker/Linux

El `Dockerfile` usa `mcr.microsoft.com/playwright:v1.59.1-noble`, instala dependencias con `npm ci`, copia el proyecto y corre `npm start`.

Variables recomendadas:

```env
HOST=0.0.0.0
HEADLESS=true
BROWSER_CHANNEL=
PROFILE_DIR=/app/data/profile
```

En Linux no usar `msedge` salvo que se instale explicitamente; dejar `BROWSER_CHANNEL` vacio usa Chromium de Playwright.

## Puntos de integracion para otro proyecto

### Opcion 1: integrar por API HTTP

Es la forma mas limpia si el otro sistema no necesita modificar internals.

Usar:

- `/api/status?full=1` para consumir OTs, resumen, diff y bitacora.
- `/api/run` para disparar consulta.
- `/api/bitacora` y endpoints CRUD para gestionar seguimiento.
- `/api/bitacora/excel` para descargar reporte.
- `/api/health` para monitoreo.

Ventajas:

- No acopla el otro proyecto a Playwright ni SQLite.
- Permite correr GNP Monitor como servicio separado.
- Facil de proteger con `MONITOR_TOKEN`, firewall o proxy.

### Opcion 2: reutilizar funciones puras

`gnp-monitor.js` exporta funciones utiles para tests/integracion:

- `app`
- `buildGetPendientesUrl`
- `compareRows`
- `createEmptyDiff`
- `extractItems`
- `getCurrentMonthDateRange`
- `getDefaultDateRange`
- `isLocalHost`
- `mergeCurrentMonthWithOpenOlderRows`
- `parseDateForSort`
- `publicSessionInfo`
- `sortRows`
- `writeJson`

Esta opcion sirve para reaprovechar normalizacion/comparacion, pero no es ideal para consumir runtime completo porque el archivo mezcla servidor, Playwright y persistencia.

### Opcion 3: extraer modulos

Si se va a integrar profundo, pedir a Codex que refactorice en modulos:

- `src/config.js`
- `src/db.js`
- `src/monitor/gnp-playwright.js`
- `src/monitor/compare.js`
- `src/bitacora/service.js`
- `src/bitacora/excel.js`
- `src/http/routes.js`
- `public/` o frontend separado.

Mantener primero pruebas para `compareRows`, bitacora y Excel antes de mover codigo.

## Prompt sugerido para Codex al integrarlo

```text
Lee INTEGRACION_CODEX.md y el proyecto actual. Quiero integrar GNP Monitor en [nombre del sistema].

Objetivo:
- Consumir el monitor como [servicio HTTP separado / modulo interno / frontend embebido].
- Mantener compatibilidad con los endpoints actuales.
- No romper los scripts Windows ni PM2.

Restricciones:
- Preserva MONITOR_TOKEN, ALLOWED_IPS y /api/health.
- Mantén los archivos runtime en data/ o permite configurarlos por env.
- No borres datos existentes de SQLite ni JSON.
- Agrega pruebas para cualquier cambio en comparacion, bitacora o API.

Primero inspecciona el codigo, luego implementa la integracion con cambios minimos y documenta los nuevos pasos de uso.
```

## Recomendaciones antes de moverlo

- Configurar `MONITOR_TOKEN` si se expondrá fuera de localhost.
- No compartir `.env` con credenciales.
- Respaldar `data/gnp-monitor.db` y archivos JSON antes de migrar.
- Ejecutar `npm test` antes y despues de cualquier refactor.
- Si se integra como servicio, mantener `HOST=127.0.0.1` y poner proxy del sistema principal delante.
- Si se integra en Linux, validar que Playwright Chromium este instalado con dependencias.
- Si se necesita multiusuario real, extender auditoria/autenticacion; hoy la UI usa nombre de operador desde `localStorage` y token compartido.

