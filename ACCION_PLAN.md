# Plan de Acción - Correcciones Pre-Producción

**Documento generado:** 2026-05-28  
**Objetivo:** Resolver todos los problemas críticos y moderados encontrados

---

## FASE 1: Corregir Vulnerabilidades de Seguridad ⚠️

### 1.1 Actualizar Playwright
```bash
# Actualizar a versión segura
npm install playwright@1.60.0 --save

# Verificar instalación
npx playwright --version
```

**Validar:**
- Nuevo `package-lock.json` debe reflejar 1.60.0
- Tests deben pasar: `npm test`

---

### 1.2 Corregir vulnerabilidad qs mediante Express
```bash
# Ejecutar npm audit fix
npm audit fix

# Verificar si quedó algo pendiente
npm audit
```

**Validar:**
- npm audit no debe reportar vulnerabilidades MODERADA de qs
- XLSX seguirá reportando ALTA (sin parche disponible, ver 1.3)

---

### 1.3 Evaluar XLSX - Prototype Pollution (ALTA)

#### Opción A: Mantener XLSX con validación estricta (RECOMENDADO para cambios mínimos)
```javascript
// En gnp-monitor.js - función parseSiniestrosExcel()
// Agregar al inicio:
if (!Buffer.isBuffer(buffer) || buffer.length > 10 * 1024 * 1024) {
  throw new Error("Archivo Excel inválido o demasiado grande (máx 10MB)");
}

// Después de XLSX.read():
const workbook = XLSX.read(buffer, { 
  type: "buffer", 
  cellDates: true,
  defval: "" 
});

// Validar estructura
if (!workbook.SheetNames || !workbook.SheetNames.length) {
  throw new Error("Archivo Excel vacío");
}
```

**Versión corta (ya en código):**
- `parseSiniestrosExcel` limita a folio + validación
- `parseBitacoraExcel` ya tiene validación de campos

#### Opción B: Cambiar a ExcelJS (más seguro, más cambios)
```bash
npm install exceljs --save
npm uninstall xlsx --save
```

**Nota:** Requiere refactorizar `parseBitacoraExcel`, `parseSiniestrosExcel`

**Recomendación:** Por ahora Opción A (mantener XLSX con validación)

---

## FASE 2: Normalizar Line Endings

```bash
# Configurar Git para detectar cambios de CRLF
git config core.safecrlf true

# Agregar normalizador de line endings
echo "* text=auto" > .gitattributes
echo "*.js text eol=lf" >> .gitattributes
echo "*.json text eol=lf" >> .gitattributes
echo "*.md text eol=lf" >> .gitattributes

# Agregar y commit
git add .gitattributes
git add .
git commit -m "Normalize line endings to LF and add .gitattributes"
```

**Validar:**
- No debe haber warnings de CRLF al hacer commit
- Archivos en repo deben ser LF

---

## FASE 3: Completar Tests para Nueva Funcionalidad

### 3.1 Agregar test para `parseSiniestrosExcel()`

**Archivo:** `tests/pure.test.js`

```javascript
const { parseSiniestrosExcel } = require("../gnp-monitor");

// Agregar al final del archivo:
assert.deepStrictEqual(
  parseSiniestrosExcel(
    XLSX.write(
      XLSX.utils.book_new()
      |> (_ => {
        _.SheetNames = ["Siniestros"];
        _.Sheets.Siniestros = XLSX.utils.aoa_to_sheet([
          ["Folio"],
          ["SIN-001"],
          ["SIN-002"],
          ["SIN-002"],  // Duplicado
          [""],
        ]);
        return _;
      })(),
      { type: "buffer" }
    )
  ),
  ["SIN-001", "SIN-002"],
  "parseSiniestrosExcel should extract unique folios and skip empty"
);
```

**Alternativa simple (sin XLSX en test):**
```javascript
// Crear buffer mock manualmente si es complejo
// Por ahora se puede omitir y testear en staging
```

---

## FASE 4: Documentación

### 4.1 Actualizar `.env.example`

Verificar que incluya:
```env
# Siniestros - Expediente Digital
SINIESTROS_URL=https://portalintermediarios.gnp.com.mx/home/pagina-iframe?tipo=aplicacion&menu=Siniestros%20ED%20CP%20GN
SINIESTROS_PROFILE_DIR=
```

**Archivo:** `.env.example`

---

### 4.2 Actualizar `DEPLOYMENT.md`

Agregar sección en "Configuracion":
```markdown
## Siniestros - Expediente Digital

Las siguientes variables controlan la integración con el módulo de Siniestros:

- `SINIESTROS_URL`: URL del portal GNP para Siniestros ED. Por defecto apunta a la vista correcta.
- `SINIESTROS_PROFILE_DIR`: Directorio de perfil del navegador separado para Siniestros. Si queda vacío, se crea automáticamente como `{PROFILE_DIR}-siniestros`.

Endpoints:
- `POST /api/siniestros/search`: Buscar folios en Expediente Digital
- `POST /api/siniestros/import-excel`: Importar folio desde archivo Excel
- `GET /api/siniestros/pdf/{id}`: Descargar PDF descargado

Todos los endpoints requieren `MONITOR_TOKEN`.
```

---

### 4.3 Actualizar `INTEGRACION_CODEX.md`

Expandir sección de "Flujo de consulta GNP":
```markdown
**Paso adicional después del paso 15 (Siniestros):**

16. Si `SINIESTROS_URL` está configurado y hay folios disponibles, puede ejecutar búsqueda de Siniestros paralela:
    - Abre contexto persistente separado con `SINIESTROS_PROFILE_DIR`.
    - Navega a Siniestros ED.
    - Busca folios y descarga PDFs.
    - Almacena PDFs en `data/siniestros-pdf/`.
    - Mantiene histórico de últimos 50 PDFs.
```

---

## FASE 5: Actualizar Dockerfile

**Archivo:** `Dockerfile`

**Cambio:**
```dockerfile
# ANTES:
FROM mcr.microsoft.com/playwright:v1.50.0-noble

# DESPUÉS:
FROM mcr.microsoft.com/playwright:v1.60.0-noble
```

**Validar:**
```bash
# En máquina con Docker disponible:
docker build -t gnp-monitor:1.1.0 .
docker run --rm gnp-monitor:1.1.0 npm test
```

---

## FASE 6: Validación Final

```bash
# 1. Ejecutar tests completos
npm test

# 2. Ejecutar npm audit
npm audit

# 3. Validar sintaxis
node --check gnp-monitor.js
node --check public/app.js

# 4. Revisar package.json
npm list --all | grep -E "playwright|xlsx|qs|express"

# 5. Crear changelog
cat > CHANGELOG.md << 'EOF'
# Changelog

## [1.1.0] - 2026-05-28

### Added
- Nuevo módulo Siniestros - Expediente Digital
- Endpoints: /api/siniestros/search, /api/siniestros/import-excel, /api/siniestros/pdf/{id}
- Importación de folios desde Excel para búsqueda de expedientes
- Gestión de PDFs descargados con rotación automática
- Perfil persistente separado para Siniestros

### Changed
- Actualizado Playwright a 1.60.0 (security fix)
- Normalizado line endings a LF
- Mejorado manejo de contextos del navegador para Siniestros

### Fixed
- Corregidas vulnerabilidades CVE-2024-XXXX (Playwright SSL verification)
- Corregida vulnerabilidad DoS en qs

### Security
- Todos endpoints Siniestros protegidos con MONITOR_TOKEN
- Validación de tamaño de archivos Excel
- Sanitización de paths de PDF
EOF
```

---

## FASE 7: Control de Cambios - Git

```bash
# Asegurarse de que todo está en orden
git status

# Agregar todos los cambios
git add -A

# Commit con mensaje claro
git commit -m "Fix security vulnerabilities and complete Siniestros integration

- Update Playwright to 1.60.0 (fix SSL certificate verification CVE)
- Run npm audit fix (fix qs DoS vulnerability)  
- Normalize line endings to LF via .gitattributes
- Add documentation for SINIESTROS_* environment variables
- Update Dockerfile to use Playwright 1.60.0
- Complete Siniestros feature with token protection and validation

Pre-production validation checklist completed."

# Revisar commits recientes
git log --oneline -5

# Crear tag para producción
git tag -a v1.1.0 -m "Release 1.1.0 - Siniestros module + security fixes"

# Revisar tag
git tag -l
```

---

## FASE 8: Deployment a Staging (Validación)

```bash
# En servidor de staging:

# 1. Clonar/actualizar código
git clone <repo> gnp-monitor-staging
cd gnp-monitor-staging
git checkout v1.1.0

# 2. Instalar dependencias
npm install

# 3. Crear .env desde example
cp .env.example .env
# Editar .env con credenciales reales de staging

# 4. Testear
npm test
npm start

# 5. En otra terminal, validar endpoints
curl http://localhost:3000/api/health
curl -H "x-monitor-token: <token>" http://localhost:3000/api/status

# 6. Validar logs
tail -f data/logs/monitor.log
```

---

## ✅ Checklist Final

- [ ] Paso 1.1: Playwright actualizado a 1.60.0
- [ ] Paso 1.2: npm audit fix ejecutado
- [ ] Paso 1.3: XLSX validado (Opción A)
- [ ] Paso 2: Line endings normalizados y .gitattributes agregado
- [ ] Paso 3: Tests para parseSiniestrosExcel agregados (opcional)
- [ ] Paso 4.1: .env.example actualizado con SINIESTROS_URL y SINIESTROS_PROFILE_DIR
- [ ] Paso 4.2: DEPLOYMENT.md actualizado con sección Siniestros
- [ ] Paso 4.3: INTEGRACION_CODEX.md actualizado
- [ ] Paso 5: Dockerfile actualizado a 1.60.0
- [ ] Paso 6: Validaciones ejecutadas (npm test, npm audit, etc.)
- [ ] Paso 7: Cambios commiteados y tagged con v1.1.0
- [ ] Paso 8: Staging deployment validado

---

## 📊 Tiempo Estimado

| Fase | Tiempo |
|------|--------|
| 1 - Vulnerabilidades | 30 min |
| 2 - Line endings | 10 min |
| 3 - Tests | 20 min |
| 4 - Documentación | 30 min |
| 5 - Dockerfile | 5 min |
| 6 - Validación | 20 min |
| 7 - Git control | 15 min |
| 8 - Staging test | 30 min |
| **Total** | **2.5 horas** |

---

## 🚀 Después de Completar

Una vez todos los pasos anteriores estén completos:

```bash
# En production:
git pull origin main
git checkout v1.1.0

npm install
npm test

pm2 restart gnp-monitor
pm2 save

# Validar healthcheck
curl http://localhost:3000/api/health
```

---

**Documento de referencia rápida:**
```bash
# Comando único para fases 1-2-6 (si npm audit fix no rompe nada):
npm install playwright@1.60.0
npm audit fix
npm test
git add .gitattributes .
git commit -m "Security updates and line endings"
```
