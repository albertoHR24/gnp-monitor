# GNP Monitor - Production Readiness Report
**Fecha:** 2026-05-28  
**Versión:** Evaluación pre-producción v1.1

---

## 🔴 PROBLEMAS CRÍTICOS ENCONTRADOS

### 1. **VULNERABILIDADES DE SEGURIDAD EN DEPENDENCIAS**

#### 1.1 Playwright 1.50.0 (ALTA SEVERIDAD)
- **CVE:** GHSA-7mvr-c777-76hp
- **Problema:** No verifica autenticidad de certificados SSL durante descarga de navegadores
- **Impacto:** Posible man-in-the-middle durante instalación de navegadores
- **Solución:** Actualizar a Playwright ≥1.55.1
- **Recomendación:** Usar v1.60.0 (última estable con Playwright Chromium)

#### 1.2 XLSX (ALTA SEVERIDAD)
- **CVE:** GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9
- **Problemas:**
  - Prototype Pollution vulnerability
  - ReDoS (Regular Expression Denial of Service)
- **Impacto:** Inyección de propiedades en objetos, ataques de negación de servicio
- **Solución TEMPORAL:** Validar y sanitizar entrada de archivos Excel
- **Solución PERMANENTE:** Esperar parche de SheetJS o usar alternativa mantenida
- **Alternativas:** `ExcelJS`, `fast-xlsx` (evaluar compatibilidad)

#### 1.3 QS / Express (MODERADA)
- **CVE:** GHSA-q8mj-m7cp-5q26  
- **Problema:** DoS en qs.stringify cuando se procesan arrays con null/undefined
- **Impacto:** Posible crash de Express si se envía query malformada
- **Solución:** `npm audit fix` (descarga qs ≥6.15.2)

---

### 2. **NUEVA FUNCIONALIDAD DE SINIESTROS - VALIDACIÓN INCOMPLETA**

#### 2.1 Cambios no testados completamente
- ✅ Backend `runSiniestros()` implementada
- ✅ Endpoints API con token protection
- ✅ Frontend UI integrada
- ⚠️ **Sin pruebas unitarias** para `parseSiniestrosExcel()`
- ⚠️ **Sin validación de selectors Siniestros** en entorno real GNP portal
- ⚠️ **Sin manejo de edge cases**: timeouts, PDFs corruptos, errores de navegación

#### 2.2 Gestión de PDFs
- Directorio `data/siniestros-pdf/` creado pero no rotado automáticamente
- Límite de 50 PDFs históricos sin configuración env
- Sin validación de tamaño de archivo descargado
- **Riesgo:** Llenado de disco si se descargan muchos PDFs

#### 2.3 Contexto del navegador separado
- Nuevo `siniestrosBrowserContext` crea perfil persistente separado
- **Consideración:** Requiere memoria adicional y recursos de perfil
- **Recomendación:** Validar limpieza en `closeBrowserContext()`

---

### 3. **CAMBIOS EN VARIABLES DE ENTORNO - NO DOCUMENTADOS**

Nuevas variables que deben estar en `.env.example` y documentadas:
```env
# Falta documentación de:
SINIESTROS_URL=
SINIESTROS_PROFILE_DIR=
```

**Estado actual en `.env.example`:** Ausentes (parcialmente)  
**Impacto:** Instalaciones nuevas sin configuración clara

---

### 4. **LÍNEA DE FINAL DE LÍNEA (CRLF vs LF)**

Git reporta advertencias de conversión CRLF en 8 archivos:
```
warning: in the working copy of '.env.example', LF will be replaced by CRLF the next time Git touches it
```

**Causa:** Windows (CRLF) vs repositorio (LF)  
**Solución:** Ejecutar:
```bash
git config core.safecrlf true
git add -A
git commit -m "Normalize line endings"
```

---

## 🟡 PROBLEMAS MODERADOS

### 5. **FALTA DE MIGRACIONES DE BASE DE DATOS EXPLÍCITAS**

- Schema SQLite se crea al inicializar `initDatabase()`
- ✅ Las tablas nuevas de bitacora están presentes
- ❌ NO hay tabla explícita para siniestros
- **Impacto:** Si se agregaran datos de siniestros en SQLite, no hay versión schema

**Recomendación:** Agregar tabla opcional:
```sql
CREATE TABLE IF NOT EXISTS siniestros_cache (
  id TEXT PRIMARY KEY,
  folio TEXT NOT NULL UNIQUE,
  pdf_name TEXT,
  captured_at TEXT NOT NULL,
  captured_by TEXT,
  metadata_json TEXT
);
```

---

### 6. **CAMBIOS EN GNISIS NO INTEGRADOS EN TESTS**

Archivo modificado: `gnp-monitor.js` (+727 líneas)

Nuevas funciones EXPORTADAS:
- `parseSiniestrosExcel()` - **SIN test**
- Funciones internas de Siniestros - **No exportadas para tests**

**Recomendación:** Agregar tests en `tests/pure.test.js`:
```javascript
assert.deepStrictEqual(
  parseSiniestrosExcel(buffer),
  expectedFolios,
  "parseSiniestrosExcel should extract folio numbers from Excel"
);
```

---

### 7. **DOCKERFILE - DESACTUALIZADO**

Archivo: `Dockerfile`  
Imagen base: `mcr.microsoft.com/playwright:v1.50.0-noble`

**Problema:** Version 1.50.0 tiene vulnerabilidades (ver sección 1.1)  
**Solución:** Actualizar a 1.60.0 como mínimo:
```dockerfile
FROM mcr.microsoft.com/playwright:v1.60.0-noble
```

---

## 🟢 ASPECTOS POSITIVOS

✅ **Tests unitarios** pasan correctamente  
✅ **Endpoints protegidos** con `requireMonitorToken`  
✅ **Endpoints públicos limitados** (`/health` únicamente)  
✅ **Healthcheck configurado** en railway.json  
✅ **Seguridad headers** aplicados (CSP, X-Frame-Options, etc.)  
✅ **Validación de entrada** en endpoints bitacora  
✅ **Manejo de errores** en rutas principales  
✅ **PM2 + ecosystem.config.js** para reinicio automático  

---

## 📋 CHECKLIST PRE-PRODUCCIÓN

### Seguridad
- [ ] Actualizar Playwright a ≥1.55.1
- [ ] Ejecutar `npm audit fix` para qs
- [ ] Revisar/reemplazar XLSX o aplicar validación estricta
- [ ] Confirmar `MONITOR_TOKEN` configurado en prod
- [ ] Confirmar `ALLOWED_IPS` configurado si es LAN
- [ ] Revisar `.env` no incluye secretos en repositorio

### Funcionalidad Siniestros
- [ ] Testear endpoints `/api/siniestros/*` en entorno
- [ ] Validar selectors GNP Siniestros en portal real
- [ ] Confirmar rotación de PDFs (límite 50)
- [ ] Testear login manual en Siniestros si es necesario
- [ ] Validar perfil separado `siniestrosProfileDir` se crea/limpia correctamente

### Base de datos
- [ ] Backup actual `data/gnp-monitor.db`
- [ ] Verificar que bitacora y comparativas históricos permanecen intactos
- [ ] Confirmar índices DB se crean sin error

### Deployment
- [ ] Actualizar Dockerfile a v1.60.0
- [ ] Revisar Docker build sin errores
- [ ] Validar `.env.example` incluye todas las variables nuevas
- [ ] Correr `npm test` en ambiente de staging
- [ ] Confirmar `/api/health` retorna `ok: true`
- [ ] Validar logs sin warnings en `data/logs/monitor.log`

### Documentación
- [ ] Actualizar DEPLOYMENT.md con info de Siniestros
- [ ] Actualizar INTEGRACION_CODEX.md si aplica
- [ ] Documentar nuevas variables env en `.env.example`
- [ ] Crear changelog para release 1.1.0

### Rollback
- [ ] Documentar procedimiento de rollback
- [ ] Tener snapshot de `data/gnp-monitor.db` pre-deployment
- [ ] Tener branch estable para rollback rápido

---

## 🔧 RECOMENDACIONES INMEDIATAS

### ANTES de cualquier despliegue:

**1. Corregir vulnerabilidades:**
```bash
npm install playwright@1.60.0
npm audit fix
npm test
```

**2. Normalizar line endings:**
```bash
git config core.safecrlf true
git add -A
git commit -m "Normalize line endings (LF)"
```

**3. Validar nuevas funcionalidades:**
```bash
# En entorno de staging:
npm test
curl http://localhost:3000/api/health
# Testear endpoints siniestros manualmente
```

**4. Actualizar Dockerfile:**
```dockerfile
FROM mcr.microsoft.com/playwright:v1.60.0-noble
```

**5. Agregar documentación de variables env:**
```env
# En .env.example, descomentar/agregar:
SINIESTROS_URL=https://portalintermediarios.gnp.com.mx/home/pagina-iframe?tipo=aplicacion&menu=Siniestros%20ED%20CP%20GN
SINIESTROS_PROFILE_DIR=
```

---

## 📊 RESUMEN DE ESTADO

| Categoría | Estado | Notas |
|-----------|--------|-------|
| Tests | ✅ Pasando | 5 tests unitarios OK |
| Seguridad | 🔴 3 vulnerabilidades | Critic, Moderate, Moderate |
| Dependencias | 🔴 Desactualizado | Playwright, XLSX |
| Nuevas funciones | 🟡 Incompleto | Siniestros sin tests |
| Deployment | 🟢 Listo | Si se corrigen vulnerabilidades |
| Documentación | 🟡 Parcial | INTEGRACION_CODEX.md OK, env vars faltantes |

---

## 🚀 RECOMENDACIÓN FINAL

**ESTADO: NO APTO PARA PRODUCCIÓN HASTA:**

1. ✋ Actualizar y testear Playwright ≥1.55.1
2. ✋ Ejecutar `npm audit fix` y resolver qs
3. ✋ Evaluar/reemplazar XLSX o aplicar validación estricta
4. ✋ Agregar tests para `parseSiniestrosExcel()`
5. ✋ Normalizar line endings
6. ✋ Documentar variables nuevas

**Tiempo estimado para correcciones:** 2-4 horas  
**Complejidad:** Baja (mayormente actualizaciones y testing)

---

## 📝 SEGUIMIENTO

Próximas revisiones recomendadas:
- [ ] Después de corregir vulnerabilidades
- [ ] Después de validar Siniestros en staging
- [ ] Antes de cutover a producción
