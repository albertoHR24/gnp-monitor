require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const { chromium } = require("playwright");

const app = express();

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "si"].includes(String(value).trim().toLowerCase());
}

function parseListEnv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const CONFIG = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  monitorToken: process.env.MONITOR_TOKEN || "",
  allowedIps: parseListEnv(process.env.ALLOWED_IPS),
  trustProxy: parseBooleanEnv(process.env.TRUST_PROXY, false),
  loginUrl: process.env.LOGIN_URL || "https://portalintermediarios.gnp.com.mx/sesion",
  dashboardUrl:
    process.env.DASHBOARD_URL ||
    process.env.INICIO_URL ||
    "https://portalintermediarios.gnp.com.mx/home/dashboard",
  consultaUrl:
    process.env.CONSULTA_URL ||
    "https://portalintermediarios.gnp.com.mx/home/pagina-iframe?tipo=aplicacion&menu=Todos%20los%20ramos%20Consulta",
  browserChannel: process.env.BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : ""),
  profileDir:
    process.env.PROFILE_DIR ||
    "C:\\Users\\TI\\AppData\\Local\\GNPMonitorProfile",
  email: process.env.GNP_EMAIL || "",
  password: process.env.GNP_PASSWORD || "",
  workflowName: process.env.WORKFLOW_NAME || "Gastos Medicos Mayores",
  headless: parseBooleanEnv(process.env.HEADLESS, false),
  useDirectApi: String(process.env.USE_DIRECT_API || "false").toLowerCase() === "true",
  autoRefreshMinutes: Math.max(Number(process.env.AUTO_REFRESH_MINUTES || 0), 0),
  manualLoginTimeoutMinutes: Math.max(Number(process.env.MANUAL_LOGIN_TIMEOUT_MINUTES || 10), 1),
  runTimeoutMinutes: Math.max(Number(process.env.RUN_TIMEOUT_MINUTES || 5), 1),
  pageRecoveryAttempts: Math.max(Number(process.env.PAGE_RECOVERY_ATTEMPTS || 3), 1),
  queryRecoveryAttempts: Math.max(Number(process.env.QUERY_RECOVERY_ATTEMPTS || 2), 1),
  consultaReadyTimeoutMs: Math.max(Number(process.env.CONSULTA_READY_TIMEOUT_MS || 25000), 5000),
  keepScreenshots: Math.max(Number(process.env.KEEP_SCREENSHOTS || 100), 10),
  maxLogBytes: Math.max(Number(process.env.MAX_LOG_BYTES || 1024 * 1024), 64 * 1024),
  directQueryMaxPages: Math.max(Number(process.env.DIRECT_QUERY_MAX_PAGES || 20), 1),
  tvRowsPerPage: Math.max(Number(process.env.TV_ROWS_PER_PAGE || 18), 8),
  tvPageSeconds: Math.max(Number(process.env.TV_PAGE_SECONDS || 25), 5),
  tvHideTerminadas: parseBooleanEnv(process.env.TV_HIDE_TERMINADAS, true),
  tvStaleMinutes: Math.max(Number(process.env.TV_STALE_MINUTES || 20), 1),
  tvSoundEnabled: parseBooleanEnv(process.env.TV_SOUND_ENABLED, false),
  tvStatusPollSeconds: Math.max(Number(process.env.TV_STATUS_POLL_SECONDS || 10), 2),
  tvAutoScroll: parseBooleanEnv(process.env.TV_AUTO_SCROLL, true),
  tvScrollPixels: Math.max(Number(process.env.TV_SCROLL_PIXELS || 1), 1),
  tvScrollIntervalMs: Math.max(Number(process.env.TV_SCROLL_INTERVAL_MS || 90), 20),
  queryDateFrom: process.env.QUERY_DATE_FROM || "",
  queryDateTo: process.env.QUERY_DATE_TO || "today",
  dataDir: path.join(__dirname, "data"),
  screenshotsDir: path.join(__dirname, "data", "screenshots"),
  sessionInfoFile: path.join(__dirname, "data", "session-info.json"),
  previousFile: path.join(__dirname, "data", "estado-anterior.json"),
  currentFile: path.join(__dirname, "data", "estado-actual.json"),
  diffFile: path.join(__dirname, "data", "cambios.json"),
  rawFile: path.join(__dirname, "data", "raw-response.json"),
  extractedFile: path.join(__dirname, "data", "items-extraidos.json"),
  debugCapturedFile: path.join(__dirname, "data", "debug-captured.json"),
  debugRequestsFile: path.join(__dirname, "data", "debug-requests.json"),
  bitacoraFile: path.join(__dirname, "data", "bitacora.json"),
  bitacoraExcelFile: path.join(__dirname, "data", "bitacora-seguimiento.xls"),
  databaseFile: path.join(__dirname, "data", "gnp-monitor.db"),
  logFile: path.join(__dirname, "data", "monitor.log"),
};

if (CONFIG.trustProxy) {
  app.set("trust proxy", true);
}

for (const dir of [CONFIG.dataDir, CONFIG.screenshotsDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const LOGIN_SELECTORS = {
  form: [
    'form',
    'mat-card',
    '.mat-mdc-card',
    '.login',
  ],
  email: [
    'input[id^="mat-input-"][type="text"]',
    'input[type="text"]',
    'input[type="email"]',
    'input[name*="correo" i]',
    'input[id*="correo" i]',
    'input[placeholder*="correo" i]',
    'input[name*="user" i]',
  ],
  password: [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
    'input[placeholder*="contra" i]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Iniciar")',
    'button:has-text("Entrar")',
    'button:has-text("Acceder")',
    'button:has-text("Ingresar")',
  ],
  captcha: [
    'iframe[src*="recaptcha"]',
    'iframe[title*="recaptcha" i]',
    ".g-recaptcha",
    'textarea[name="g-recaptcha-response"]',
  ],
};

const CONSULTA_SELECTORS = {
  workflowForm: [
    'form#workflow-select',
  ],
  workflowCombo: [
    'form#workflow-select md-select[ng-model="workflow2.workflow"]',
    'form#workflow-select md-select#select_32',
    'form#workflow-select md-select[aria-label="Selecciona tu Workflow"]',
    'form#workflow-select md-select.workfl',
    'form#workflow-select md-select',
    '[role="combobox"]',
    'md-select[id^="select_"]',
    'md-select[name*="workflow" i]',
    'md-select[aria-label*="workflow" i]',
    'md-select[placeholder*="workflow" i]',
    'md-select[ng-model*="workflow" i]',
    ".mat-select-trigger",
    ".mat-mdc-select-trigger",
    "mat-select",
    ".md-select-value",
    ".md-select-value span",
    'text=Selecciona tu Workflow',
    'text=Workflow',
  ],
  workflowOption: [
    'form#workflow-select md-option[value="gmm"]',
    'form#workflow-select #select_option_64',
    'md-option[value="gmm"]',
    'text=/Gastos M[eÃ©]dicos Mayores/i',
    'mat-option:has-text("Gastos MÃ©dicos Mayores")',
    'mat-option:has-text("Gastos Medicos Mayores")',
    '[role="option"]:has-text("Gastos MÃ©dicos Mayores")',
    '[role="option"]:has-text("Gastos Medicos Mayores")',
    '.mat-option-text:has-text("Gastos MÃ©dicos Mayores")',
    '.mat-option-text:has-text("Gastos Medicos Mayores")',
  ],
  consultar: [
    'form#workflow-select button[ng-class*="main-btn"][ng-disabled*="workflowSelection.workflowSelection.$valid"]',
    'form#workflow-select button[ng-class*="main-btn"]',
    'form#workflow-select button[ng-disabled*="workflowSelection.workflowSelection.$valid"]',
    'form#workflow-select button.main-btn:not([disabled])',
    'form#workflow-select button.main-btn',
    'form#workflow-select button:has-text("Consultar")',
    'form#workflow-select button:not([disabled])',
    'button.main-btn:has-text("Consultar")',
    'button:has-text("Consultar")',
    'input[value="Consultar"]',
    '[role="button"]:has-text("Consultar")',
  ],
  buscar: [
    'button:has-text("Buscar")',
    '[role="button"]:has-text("Buscar")',
    'input[value="Buscar"]',
  ],
};

const WORKFLOW_LABELS = [
  "Gastos Medicos Mayores",
  "Gastos MÃ©dicos Mayores",
];

const WORKFLOW_OPTION_SELECTORS = [
  'form#workflow-select md-option[value="gmm"]',
  'form#workflow-select md-option[ng-value="workflow.value"][value="gmm"]',
  'md-option[value="gmm"]',
  'md-option[id^="select_option_"][value="gmm"]',
  'md-option[ng-value="workflow.value"][value="gmm"]',
  'md-option[value="gmm"] .md-text',
  '#select_option_64',
  '#select_option_64 .md-text',
  'text=/Gastos M[eÃ©]dicos Mayores/i',
  'text=Gastos Medicos Mayores',
  'text=Gastos MÃ©dicos Mayores',
  'mat-option:has-text("Gastos MÃ©dicos Mayores")',
  'mat-option:has-text("Gastos Medicos Mayores")',
  '[role="option"]:has-text("Gastos MÃ©dicos Mayores")',
  '[role="option"]:has-text("Gastos Medicos Mayores")',
  '.mat-option-text:has-text("Gastos MÃ©dicos Mayores")',
  '.mat-option-text:has-text("Gastos Medicos Mayores")',
  'md-option:has-text("Gastos MÃ©dicos Mayores")',
  'md-option:has-text("Gastos Medicos Mayores")',
  '.md-text:has-text("Gastos MÃ©dicos Mayores")',
  '.md-text:has-text("Gastos Medicos Mayores")',
];

const WORKFLOW_TARGET = {
  value: "gmm",
  label: "Gastos Medicos Mayores",
};

const DIRECT_QUERY_LIMIT = 50;
let db = null;

function writeJson(file, data) {
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempFile, file);
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function formatCompactDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDisplayDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function parseConfiguredDate(value, fallbackDate) {
  const text = normalizeText(value).toLowerCase();
  if (!text || text === "default") {
    return fallbackDate;
  }
  if (text === "today" || text === "hoy") {
    return new Date();
  }

  const ymdDashed = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdDashed) {
    const [, year, month, day] = ymdDashed;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
  }

  const ymdCompact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymdCompact) {
    const [, year, month, day] = ymdCompact;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
  }

  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
  }

  return fallbackDate;
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 3);

  const configuredStart = parseConfiguredDate(CONFIG.queryDateFrom, start);
  const configuredEnd = parseConfiguredDate(CONFIG.queryDateTo, end);

  const range = {
    start: formatCompactDate(configuredStart),
    end: formatCompactDate(configuredEnd),
    displayStart: formatDisplayDate(configuredStart),
    displayEnd: formatDisplayDate(configuredEnd),
  };

  return range;
}

function getCurrentMonthDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);

  return {
    start: formatCompactDate(start),
    end: formatCompactDate(end),
    displayStart: formatDisplayDate(start),
    displayEnd: formatDisplayDate(end),
  };
}

function tryParseJsonArray(rawValue) {
  const text = normalizeText(rawValue);
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLoose(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function makeKey(row) {
  return normalizeText(row?.ot || row?.OT || row?.id || "");
}

function parseDateForSort(value) {
  const text = normalizeText(value);
  if (!text) {
    return Number.POSITIVE_INFINITY;
  }

  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function parseGnpDate(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTrackingKey(value) {
  return normalizeLoose(value).replace(/[^a-z0-9]/g, "");
}

function normalizePolicyKey(value) {
  const compact = normalizeTrackingKey(value);
  return compact.replace(/^0+/, "") || compact;
}

function makeBitacoraId() {
  return `bit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initDatabase() {
  if (db) {
    return db;
  }

  db = new Database(CONFIG.databaseFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS bitacora (
      id TEXT PRIMARY KEY,
      dias_atraso TEXT,
      fecha_entrada_correo TEXT,
      fecha_entrega TEXT,
      tramite TEXT,
      estado TEXT,
      cliente TEXT,
      poliza TEXT,
      aseguradora TEXT,
      descripcion TEXT,
      folio TEXT,
      comentarios TEXT,
      fecha_salida TEXT,
      responsable TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      archived_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bitacora_folio ON bitacora(folio);
    CREATE INDEX IF NOT EXISTS idx_bitacora_poliza ON bitacora(poliza);
    CREATE INDEX IF NOT EXISTS idx_bitacora_responsable ON bitacora(responsable);

    CREATE TABLE IF NOT EXISTS bitacora_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      action TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT,
      reason TEXT,
      before_json TEXT,
      after_json TEXT,
      FOREIGN KEY (entry_id) REFERENCES bitacora(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bitacora_history_entry ON bitacora_history(entry_id, version DESC);

    CREATE TABLE IF NOT EXISTS monitor_snapshots (
      id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      source TEXT,
      total INTEGER NOT NULL DEFAULT 0,
      diff_json TEXT,
      raw_json TEXT,
      debug_json TEXT
    );

    CREATE TABLE IF NOT EXISTS monitor_rows (
      snapshot_id TEXT NOT NULL,
      ot TEXT,
      usuario_creador TEXT,
      estatus TEXT,
      poliza TEXT,
      agente TEXT,
      contratante TEXT,
      tipo_solicitud TEXT,
      producto TEXT,
      fecha_compromiso TEXT,
      fecha_registro TEXT,
      primer_ingreso TEXT,
      ultimo_ingreso TEXT,
      guia TEXT,
      medio_apertura TEXT,
      rol TEXT,
      row_json TEXT,
      PRIMARY KEY (snapshot_id, ot),
      FOREIGN KEY (snapshot_id) REFERENCES monitor_snapshots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_rows_ot ON monitor_rows(ot);
    CREATE INDEX IF NOT EXISTS idx_monitor_rows_poliza ON monitor_rows(poliza);
    CREATE INDEX IF NOT EXISTS idx_monitor_rows_agente ON monitor_rows(agente);

    CREATE TABLE IF NOT EXISTS bitacora_comparativas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id TEXT,
      generated_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES monitor_snapshots(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comparison_id INTEGER,
      type TEXT,
      severity TEXT,
      title TEXT,
      message TEXT,
      ot TEXT,
      entry_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (comparison_id) REFERENCES bitacora_comparativas(id) ON DELETE CASCADE
    );
  `);

  ensureBitacoraAuditSchema(db);
  migrateBitacoraJsonToDb();
  return db;
}

function ensureBitacoraAuditSchema(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(bitacora)").all().map((column) => column.name));
  const addColumn = (name, sql) => {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE bitacora ADD COLUMN ${sql}`);
      columns.add(name);
    }
  };

  addColumn("version", "version INTEGER NOT NULL DEFAULT 1");
  addColumn("archived_at", "archived_at TEXT");
  addColumn("archived_reason", "archived_reason TEXT");
  database.exec("UPDATE bitacora SET archived_at = NULL WHERE archived_at = ''");
  database.exec("CREATE INDEX IF NOT EXISTS idx_bitacora_archived_at ON bitacora(archived_at)");

  const historyColumns = new Set(database.prepare("PRAGMA table_info(bitacora_history)").all().map((column) => column.name));
  const addHistoryColumn = (name, sql) => {
    if (!historyColumns.has(name)) {
      database.exec(`ALTER TABLE bitacora_history ADD COLUMN ${sql}`);
      historyColumns.add(name);
    }
  };

  addHistoryColumn("changed_by", "changed_by TEXT");
  addHistoryColumn("reason", "reason TEXT");
}

function migrateBitacoraJsonToDb() {
  const database = db || initDatabase();
  const count = database.prepare("SELECT COUNT(*) AS total FROM bitacora").get().total;
  if (count > 0 || !fs.existsSync(CONFIG.bitacoraFile)) {
    return;
  }

  const entries = readJsonSafe(CONFIG.bitacoraFile, []);
  if (!Array.isArray(entries) || !entries.length) {
    return;
  }

  const insert = database.prepare(`
    INSERT OR IGNORE INTO bitacora (
      id, dias_atraso, fecha_entrada_correo, fecha_entrega, tramite, estado, cliente,
      poliza, aseguradora, descripcion, folio, comentarios, fecha_salida, responsable,
      version, archived_at, archived_reason, created_at, updated_at
    ) VALUES (
      @id, @diasAtraso, @fechaEntradaCorreo, @fechaEntrega, @tramite, @estado, @cliente,
      @poliza, @aseguradora, @descripcion, @folio, @comentarios, @fechaSalida, @responsable,
      @version, @archivedAt, @archivedReason, @createdAt, @updatedAt
    )
  `);

  const migrate = database.transaction((items) => {
    for (const item of items) {
      const entry = sanitizeBitacoraEntry(item);
      insert.run(entry);
      recordBitacoraHistory(database, entry.id, entry.version, "migrate", null, entry, {
        changedBy: "Sistema",
        reason: "Migracion desde bitacora.json",
      });
    }
  });
  migrate(entries);
}

function dbRowToBitacora(row) {
  return {
    id: row.id,
    diasAtraso: row.dias_atraso || "",
    fechaEntradaCorreo: row.fecha_entrada_correo || "",
    fechaEntrega: row.fecha_entrega || "",
    tramite: row.tramite || "",
    estado: row.estado || "",
    cliente: row.cliente || "",
    poliza: row.poliza || "",
    aseguradora: row.aseguradora || "",
    descripcion: row.descripcion || "",
    folio: row.folio || "",
    comentarios: row.comentarios || "",
    fechaSalida: row.fecha_salida || "",
    responsable: row.responsable || "",
    version: Number(row.version || 1),
    archivedAt: row.archived_at || "",
    archivedReason: row.archived_reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readBitacora(options = {}) {
  const includeArchived = Boolean(options.includeArchived);
  const onlyArchived = Boolean(options.onlyArchived);
  if (db) {
    const where = onlyArchived
      ? "WHERE archived_at IS NOT NULL AND archived_at <> ''"
      : includeArchived
        ? ""
        : "WHERE archived_at IS NULL OR archived_at = ''";
    return db
      .prepare(`SELECT * FROM bitacora ${where} ORDER BY updated_at DESC, created_at DESC`)
      .all()
      .map(dbRowToBitacora);
  }

  const items = readJsonSafe(CONFIG.bitacoraFile, []);
  if (!Array.isArray(items)) {
    return [];
  }
  return includeArchived ? items : items.filter((item) => !item.archivedAt);
}

function countBitacoraRecords() {
  const database = initDatabase();
  return {
    total: database.prepare("SELECT COUNT(*) AS total FROM bitacora").get().total,
    active: database.prepare("SELECT COUNT(*) AS total FROM bitacora WHERE archived_at IS NULL OR archived_at = ''").get().total,
    archived: database.prepare("SELECT COUNT(*) AS total FROM bitacora WHERE archived_at IS NOT NULL AND archived_at <> ''").get().total,
  };
}

function sanitizeBitacoraEntry(input = {}, previous = {}) {
  const now = nowIso();
  const clean = {
    ...previous,
    id: normalizeText(previous.id || input.id) || makeBitacoraId(),
    diasAtraso: normalizeText(input.diasAtraso),
    fechaEntradaCorreo: normalizeText(input.fechaEntradaCorreo),
    fechaEntrega: normalizeText(input.fechaEntrega),
    tramite: normalizeText(input.tramite),
    estado: normalizeText(input.estado),
    cliente: normalizeText(input.cliente),
    poliza: normalizeText(input.poliza),
    aseguradora: normalizeText(input.aseguradora),
    descripcion: normalizeText(input.descripcion),
    folio: normalizeText(input.folio),
    comentarios: normalizeText(input.comentarios),
    fechaSalida: normalizeText(input.fechaSalida),
    responsable: normalizeText(input.responsable),
    version: Number(previous.version || input.version || 1),
    archivedAt: normalizeText(previous.archivedAt || input.archivedAt) || null,
    archivedReason: normalizeText(previous.archivedReason || input.archivedReason),
    updatedAt: now,
  };

  if (!clean.createdAt) {
    clean.createdAt = now;
  }

  return clean;
}

function normalizeHeader(value) {
  return normalizeLoose(value).replace(/[^a-z0-9]/g, "");
}

function excelValueToText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 25000 && value < 80000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  return normalizeText(value);
}

function pickExcelValue(row, headerMap, names) {
  for (const name of names) {
    const index = headerMap.get(normalizeHeader(name));
    if (index !== undefined) {
      const value = excelValueToText(row[index]);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function findExcelHeaderRow(rows) {
  let best = { index: -1, score: 0 };
  rows.forEach((row, index) => {
    const headers = new Set((row || []).map(normalizeHeader));
    const score = [
      "folio",
      "poliza",
      "cliente",
      "estado",
      "tramite",
      "comentarios",
      "fechadeentrega",
      "fechadeentradacorreo",
    ].filter((header) => headers.has(header)).length;
    if (score > best.score) {
      best = { index, score };
    }
  });
  return best.score >= 2 ? best.index : -1;
}

function parseBitacoraExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName =
    workbook.SheetNames.find((name) => normalizeLoose(name).includes("pendientes")) ||
    workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: "",
  });
  const headerIndex = findExcelHeaderRow(rows);
  if (headerIndex === -1) {
    return [];
  }

  const headers = rows[headerIndex] || [];
  const headerMap = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !headerMap.has(key)) {
      headerMap.set(key, index);
    }
  });

  return rows
    .slice(headerIndex + 1)
    .map((row) => ({
      diasAtraso: pickExcelValue(row, headerMap, ["DIAS DE ATRASO"]),
      fechaEntradaCorreo: pickExcelValue(row, headerMap, ["FECHA DE ENTRADA CORREO"]),
      fechaEntrega: pickExcelValue(row, headerMap, ["FECHA DE ENTREGA"]),
      tramite: pickExcelValue(row, headerMap, ["TRAMITE"]),
      estado: pickExcelValue(row, headerMap, ["ESTADO"]),
      cliente: pickExcelValue(row, headerMap, ["CLIENTE", "ASEGURADO"]),
      poliza: pickExcelValue(row, headerMap, ["POLIZA", "NUMERO DE POLIZA", "NUMERO POLIZA"]),
      aseguradora: pickExcelValue(row, headerMap, ["ASEGURADORA", "COMPANIA"]),
      descripcion: pickExcelValue(row, headerMap, ["DESCRIPCION", "DESCRIPCION ", "PENDIENTE"]),
      folio: pickExcelValue(row, headerMap, ["FOLIO", "OT"]),
      comentarios: pickExcelValue(row, headerMap, ["COMENTARIOS"]),
      fechaSalida: pickExcelValue(row, headerMap, ["FECHA DE SALIDA"]),
      responsable: pickExcelValue(row, headerMap, ["RESPONSABLE", "ASESOR", "AGENTE SEGUIMIENTO"]),
    }))
    .filter((entry) => entry.folio || entry.poliza || entry.cliente);
}

function findExistingBitacoraEntry(entry) {
  const database = initDatabase();
  const folio = normalizeText(entry.folio);
  const polizaKey = normalizePolicyKey(entry.poliza);
  if (folio) {
    const found = database
      .prepare("SELECT * FROM bitacora WHERE archived_at IS NULL OR archived_at = ''")
      .all()
      .find((row) => normalizeText(row.folio) === folio);
    if (found) return dbRowToBitacora(found);
  }
  if (polizaKey) {
    const found = database
      .prepare("SELECT * FROM bitacora WHERE archived_at IS NULL OR archived_at = ''")
      .all()
      .find((row) => normalizePolicyKey(row.poliza) === polizaKey);
    if (found) return dbRowToBitacora(found);
  }
  return null;
}

function buildAuditMeta(input = {}, fallbackReason = "") {
  return {
    reason: normalizeText(input.reason || input.changeReason || fallbackReason),
    changedBy: normalizeText(input.changedBy || input.operator || "Operador local"),
  };
}

function buildAuditMetaFromRequest(req, fallbackReason = "") {
  return buildAuditMeta(
    {
      ...(req.body && !Buffer.isBuffer(req.body) ? req.body : {}),
      reason: req.body?.reason || req.body?.changeReason || req.get("x-change-reason") || fallbackReason,
      changedBy: req.body?.changedBy || req.body?.operator || req.get("x-operator") || "Operador local",
    },
    fallbackReason
  );
}

function requireAuditReason(req, res) {
  const reason = normalizeText(req.body?.reason || req.body?.changeReason);
  if (!reason) {
    res.status(400).json({
      ok: false,
      message: "Captura el motivo del cambio para guardar el historial.",
    });
    return null;
  }
  return buildAuditMeta(req.body);
}

function importBitacoraEntries(entries, audit = buildAuditMeta({}, "Importacion desde Excel")) {
  const stats = { imported: entries.length, inserted: 0, updated: 0 };
  const database = initDatabase();
  const save = database.transaction((items) => {
    for (const item of items) {
      const previous = findExistingBitacoraEntry(item);
      if (previous) {
        updateBitacoraEntry(sanitizeBitacoraEntry(item, previous), previous, "import", audit);
        stats.updated += 1;
      } else {
        insertBitacoraEntry(sanitizeBitacoraEntry(item), "import", audit);
        stats.inserted += 1;
      }
    }
  });
  save(entries);
  return stats;
}

function recordBitacoraHistory(database, entryId, version, action, beforeEntry, afterEntry, audit = {}) {
  database
    .prepare(`
      INSERT INTO bitacora_history (
        entry_id, version, action, changed_at, changed_by, reason, before_json, after_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      entryId,
      version,
      action,
      nowIso(),
      normalizeText(audit.changedBy || "Sistema"),
      normalizeText(audit.reason),
      beforeEntry ? JSON.stringify(beforeEntry) : null,
      afterEntry ? JSON.stringify(afterEntry) : null
    );
}

function readBitacoraHistory(entryId) {
  return initDatabase()
    .prepare("SELECT * FROM bitacora_history WHERE entry_id = ? ORDER BY version DESC, changed_at DESC")
    .all(entryId)
    .map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      version: Number(row.version || 1),
      action: row.action,
      changedAt: row.changed_at,
      changedBy: row.changed_by || "",
      reason: row.reason || "",
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
    }));
}

function attachBitacoraHistoryMeta(items) {
  if (!items.length) {
    return items;
  }
  const database = initDatabase();
  const countHistory = database.prepare("SELECT COUNT(*) AS total FROM bitacora_history WHERE entry_id = ?");
  return items.map((item) => ({
    ...item,
    historyCount: countHistory.get(item.id).total,
  }));
}

function insertBitacoraEntry(entry, action = "create", audit = buildAuditMeta({}, "Captura inicial")) {
  const database = initDatabase();
  const insert = database.transaction((item) => {
    database
    .prepare(`
      INSERT INTO bitacora (
        id, dias_atraso, fecha_entrada_correo, fecha_entrega, tramite, estado, cliente,
        poliza, aseguradora, descripcion, folio, comentarios, fecha_salida, responsable,
        version, archived_at, archived_reason, created_at, updated_at
      ) VALUES (
        @id, @diasAtraso, @fechaEntradaCorreo, @fechaEntrega, @tramite, @estado, @cliente,
        @poliza, @aseguradora, @descripcion, @folio, @comentarios, @fechaSalida, @responsable,
        @version, @archivedAt, @archivedReason, @createdAt, @updatedAt
      )
    `)
      .run(item);
    recordBitacoraHistory(database, item.id, item.version, action, null, item, audit);
  });
  insert(entry);
}

function updateBitacoraEntry(entry, previous = null, action = "update", audit = {}) {
  const database = initDatabase();
  const before =
    previous ||
    dbRowToBitacora(database.prepare("SELECT * FROM bitacora WHERE id = ?").get(entry.id) || {});
  const next = {
    ...entry,
    version: Number(before.version || 1) + 1,
    updatedAt: nowIso(),
  };
  const update = database.transaction((item) => {
    const result = database
    .prepare(`
      UPDATE bitacora SET
        dias_atraso = @diasAtraso,
        fecha_entrada_correo = @fechaEntradaCorreo,
        fecha_entrega = @fechaEntrega,
        tramite = @tramite,
        estado = @estado,
        cliente = @cliente,
        poliza = @poliza,
        aseguradora = @aseguradora,
        descripcion = @descripcion,
        folio = @folio,
        comentarios = @comentarios,
        fecha_salida = @fechaSalida,
        responsable = @responsable,
        version = @version,
        archived_at = @archivedAt,
        archived_reason = @archivedReason,
        updated_at = @updatedAt
      WHERE id = @id
    `)
      .run(item);
    if (result.changes) {
      recordBitacoraHistory(database, item.id, item.version, action, before, item, audit);
    }
    return result;
  });
  return update(next);
}

function archiveBitacoraEntry(id, audit = buildAuditMeta({}, "Archivado desde UI")) {
  const database = initDatabase();
  const current = database.prepare("SELECT * FROM bitacora WHERE id = ?").get(id);
  if (!current) {
    return { changes: 0 };
  }

  const previous = dbRowToBitacora(current);
  if (previous.archivedAt) {
    return { changes: 0 };
  }

  return updateBitacoraEntry(
    {
      ...previous,
      archivedAt: nowIso(),
      archivedReason: normalizeText(audit.reason || "Archivado desde UI"),
    },
    previous,
    "archive",
    audit
  );
}

function restoreBitacoraEntry(id, audit = buildAuditMeta({}, "Restaurado desde UI")) {
  const database = initDatabase();
  const current = database.prepare("SELECT * FROM bitacora WHERE id = ?").get(id);
  if (!current) {
    return { changes: 0 };
  }

  const previous = dbRowToBitacora(current);
  if (!previous.archivedAt) {
    return { changes: 0 };
  }

  return updateBitacoraEntry(
    {
      ...previous,
      archivedAt: null,
      archivedReason: "",
    },
    previous,
    "restore",
    audit
  );
}

function isClosedStatus(value) {
  const status = normalizeLoose(value);
  return ["terminada", "cancelada", "rechazada", "cerrada", "finalizada"].some((item) =>
    status.includes(item)
  );
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDiffFromToday(value) {
  const parsed = parseGnpDate(value);
  if (!parsed) {
    return null;
  }
  return Math.round((startOfDay(parsed).getTime() - startOfDay().getTime()) / 86400000);
}

function buildMonitorIndexes(rows) {
  const byOt = new Map();
  const byPolicy = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const otKey = normalizeTrackingKey(row.ot);
    const policyKey = normalizePolicyKey(row.poliza);
    if (otKey && !byOt.has(otKey)) {
      byOt.set(otKey, row);
    }
    if (policyKey && !byPolicy.has(policyKey)) {
      byPolicy.set(policyKey, row);
    }
  }

  return { byOt, byPolicy };
}

function findMonitorMatch(entry, indexes) {
  const folioKey = normalizeTrackingKey(entry.folio);
  const policyKey = normalizePolicyKey(entry.poliza);

  if (folioKey && indexes.byOt.has(folioKey)) {
    return { row: indexes.byOt.get(folioKey), matchBy: "folio" };
  }
  if (policyKey && indexes.byPolicy.has(policyKey)) {
    return { row: indexes.byPolicy.get(policyKey), matchBy: "poliza" };
  }

  return { row: null, matchBy: null };
}

function classifyBitacoraEntry(entry, monitorRow) {
  if (!monitorRow) {
    return {
      key: "sin_monitor",
      label: "Sin OT en monitor",
      severity: "warning",
    };
  }

  const manualClosed = isClosedStatus(entry.estado);
  const monitorClosed = isClosedStatus(monitorRow.estatus);
  const dueDays = dayDiffFromToday(entry.fechaEntrega || monitorRow.fechaCompromiso);

  if (manualClosed !== monitorClosed) {
    return {
      key: "inconsistente",
      label: "Estado inconsistente",
      severity: "danger",
    };
  }
  if (!manualClosed && dueDays !== null && dueDays < 0) {
    return {
      key: "vencida",
      label: `${Math.abs(dueDays)} dias vencida`,
      severity: "danger",
    };
  }
  if (!normalizeText(entry.responsable)) {
    return {
      key: "sin_responsable",
      label: "Sin responsable",
      severity: "warning",
    };
  }
  if (monitorClosed) {
    return {
      key: "cerrada",
      label: "Cerrada",
      severity: "ok",
    };
  }

  return {
    key: "al_corriente",
    label: "Al corriente",
    severity: "ok",
  };
}

function buildBitacoraComparison(entries, monitorRows) {
  const indexes = buildMonitorIndexes(monitorRows);
  const matchedOts = new Set();

  const activeEntries = (Array.isArray(entries) ? entries : []).filter((entry) => !entry.archivedAt);
  const items = attachBitacoraHistoryMeta(activeEntries.map((entry) => {
    const match = findMonitorMatch(entry, indexes);
    if (match.row && match.row.ot) {
      matchedOts.add(normalizeTrackingKey(match.row.ot));
    }
    const seguimiento = classifyBitacoraEntry(entry, match.row);
    const dueDays = dayDiffFromToday(entry.fechaEntrega || match.row?.fechaCompromiso);
    return {
      ...entry,
      matchBy: match.matchBy,
      monitor: match.row
        ? {
            ot: match.row.ot,
            estatus: match.row.estatus,
            poliza: match.row.poliza,
            agente: match.row.agente,
            contratante: match.row.contratante,
            tipoSolicitud: match.row.tipoSolicitud,
            fechaCompromiso: match.row.fechaCompromiso,
          }
        : null,
      seguimiento,
      diasParaEntrega: dueDays,
    };
  }));

  const sinBitacora = (Array.isArray(monitorRows) ? monitorRows : [])
    .filter((row) => {
      if (isClosedStatus(row.estatus)) {
        return false;
      }
      const key = normalizeTrackingKey(row.ot);
      return key && !matchedOts.has(key);
    })
    .map((row) => ({
      ot: row.ot,
      estatus: row.estatus,
      poliza: row.poliza,
      agente: row.agente,
      contratante: row.contratante,
      fechaCompromiso: row.fechaCompromiso,
    }));

  const counts = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.seguimiento.key] = (acc[item.seguimiento.key] || 0) + 1;
      return acc;
    },
    { total: 0 }
  );
  counts.sin_bitacora = sinBitacora.length;

  const alerts = [
    ...items
      .filter((item) => ["inconsistente", "vencida", "sin_monitor", "sin_responsable"].includes(item.seguimiento.key))
      .map((item) => ({
        type: item.seguimiento.key,
        severity: item.seguimiento.severity,
        title: item.seguimiento.label,
        message: `${item.folio || item.poliza || item.cliente || "Registro"} - ${item.cliente || "Sin cliente"}`,
        entryId: item.id,
      })),
    ...sinBitacora.slice(0, 20).map((row) => ({
      type: "sin_bitacora",
      severity: "warning",
      title: "OT sin bitacora",
      message: `${row.ot} - ${row.contratante || row.poliza || "Sin referencia"}`,
      ot: row.ot,
    })),
  ];

  return {
    items,
    archived: attachBitacoraHistoryMeta(readBitacora({ onlyArchived: true })),
    sinBitacora,
    alerts,
    summary: counts,
    updatedAt: nowIso(),
  };
}

function excelCell(value) {
  const text = normalizeText(value);
  return `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelRow(values) {
  return `<Row>${values.map(excelCell).join("")}</Row>`;
}

function excelSheet(name, headers, rows) {
  const headerRow = excelRow(headers);
  const dataRows = rows.map((row) => excelRow(row)).join("");
  return `<Worksheet ss:Name="${escapeXml(name).slice(0, 31)}"><Table>${headerRow}${dataRows}</Table></Worksheet>`;
}

function writeBitacoraExcel(comparison) {
  const report = comparison || buildBitacoraComparison(readBitacora(), runtime.data);
  const generatedAt = nowIso();

  const bitacoraHeaders = [
    "Generado",
    "Seguimiento",
    "Folio / OT manual",
    "OT monitor",
    "Coincidencia",
    "Poliza manual",
    "Poliza monitor",
    "Cliente manual",
    "Contratante monitor",
    "Tramite",
    "Estado manual",
    "Estatus monitor",
    "Responsable",
    "Version",
    "Agente monitor",
    "Fecha entrada correo",
    "Fecha entrega manual",
    "Fecha compromiso monitor",
    "Fecha salida",
    "Aseguradora",
    "Descripcion",
    "Comentarios",
    "Archivado",
    "Motivo archivo",
    "Actualizado",
  ];

  const bitacoraRows = report.items.map((item) => [
    generatedAt,
    item.seguimiento?.label,
    item.folio,
    item.monitor?.ot,
    item.matchBy || "sin coincidencia",
    item.poliza,
    item.monitor?.poliza,
    item.cliente,
    item.monitor?.contratante,
    item.tramite,
    item.estado,
    item.monitor?.estatus,
    item.responsable,
    item.version,
    item.monitor?.agente,
    item.fechaEntradaCorreo,
    item.fechaEntrega,
    item.monitor?.fechaCompromiso,
    item.fechaSalida,
    item.aseguradora,
    item.descripcion,
    item.comentarios,
    item.archivedAt,
    item.archivedReason,
    item.updatedAt,
  ]);

  const sinBitacoraHeaders = ["Generado", "OT", "Estatus", "Poliza", "Agente", "Contratante", "Fecha compromiso"];
  const sinBitacoraRows = report.sinBitacora.map((row) => [
    generatedAt,
    row.ot,
    row.estatus,
    row.poliza,
    row.agente,
    row.contratante,
    row.fechaCompromiso,
  ]);

  const alertHeaders = ["Generado", "Tipo", "Severidad", "Titulo", "Detalle", "OT", "Registro bitacora"];
  const alertRows = report.alerts.map((alert) => [
    generatedAt,
    alert.type,
    alert.severity,
    alert.title,
    alert.message,
    alert.ot,
    alert.entryId,
  ]);

  const historyHeaders = [
    "Fecha",
    "Registro",
    "Version",
    "Accion",
    "Operador",
    "Motivo",
    "Folio / OT",
    "Poliza",
    "Cliente",
    "Estado",
    "Responsable",
    "Comentarios",
  ];
  const historyRows = initDatabase()
    .prepare("SELECT * FROM bitacora_history ORDER BY changed_at DESC, id DESC")
    .all()
    .map((row) => {
      const after = row.after_json ? JSON.parse(row.after_json) : {};
      const before = row.before_json ? JSON.parse(row.before_json) : {};
      const snapshot = Object.keys(after).length ? after : before;
      return [
        row.changed_at,
        row.entry_id,
        row.version,
        row.action,
        row.changed_by,
        row.reason,
        snapshot.folio,
        snapshot.poliza,
        snapshot.cliente,
        snapshot.estado,
        snapshot.responsable,
        snapshot.comentarios,
      ];
    });

  const xml = [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    excelSheet("Bitacora", bitacoraHeaders, bitacoraRows),
    excelSheet("Sin bitacora", sinBitacoraHeaders, sinBitacoraRows),
    excelSheet("Alertas", alertHeaders, alertRows),
    excelSheet("Historial", historyHeaders, historyRows),
    "</Workbook>",
  ].join("");

  fs.writeFileSync(CONFIG.bitacoraExcelFile, xml, "utf8");
  return CONFIG.bitacoraExcelFile;
}

function saveMonitorSnapshot(result, currentRows, diff) {
  if (!db) {
    return null;
  }

  const snapshotId = diff?.timestamp || nowIso();
  const save = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO monitor_snapshots (
        id, captured_at, source, total, diff_json, raw_json, debug_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      snapshotId,
      result?.debug?.source || "",
      Array.isArray(currentRows) ? currentRows.length : 0,
      JSON.stringify(diff || null),
      JSON.stringify(result?.raw || null),
      JSON.stringify(result?.debug || null)
    );

    db.prepare("DELETE FROM monitor_rows WHERE snapshot_id = ?").run(snapshotId);
    const insertRow = db.prepare(`
      INSERT OR REPLACE INTO monitor_rows (
        snapshot_id, ot, usuario_creador, estatus, poliza, agente, contratante,
        tipo_solicitud, producto, fecha_compromiso, fecha_registro, primer_ingreso,
        ultimo_ingreso, guia, medio_apertura, rol, row_json
      ) VALUES (
        @snapshotId, @ot, @usuarioCreador, @estatus, @poliza, @agente, @contratante,
        @tipoSolicitud, @producto, @fechaCompromiso, @fechaRegistro, @primerIngreso,
        @ultimoIngreso, @guia, @medioApertura, @rol, @rowJson
      )
    `);

    for (const row of Array.isArray(currentRows) ? currentRows : []) {
      insertRow.run({
        snapshotId,
        ot: normalizeText(row.ot),
        usuarioCreador: normalizeText(row.usuarioCreador),
        estatus: normalizeText(row.estatus),
        poliza: normalizeText(row.poliza),
        agente: normalizeText(row.agente),
        contratante: normalizeText(row.contratante),
        tipoSolicitud: normalizeText(row.tipoSolicitud),
        producto: normalizeText(row.producto),
        fechaCompromiso: normalizeText(row.fechaCompromiso),
        fechaRegistro: normalizeText(row.fechaRegistro),
        primerIngreso: normalizeText(row.primerIngreso),
        ultimoIngreso: normalizeText(row.ultimoIngreso),
        guia: normalizeText(row.guia),
        medioApertura: normalizeText(row.medioApertura),
        rol: normalizeText(row.rol),
        rowJson: JSON.stringify(row),
      });
    }
  });

  save();
  return snapshotId;
}

function saveComparisonHistory(comparison, snapshotId = null) {
  if (!db || !comparison) {
    return null;
  }

  const generatedAt = comparison.updatedAt || nowIso();
  const save = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO bitacora_comparativas (snapshot_id, generated_at, summary_json)
      VALUES (?, ?, ?)
    `).run(snapshotId, generatedAt, JSON.stringify(comparison.summary || {}));

    const insertAlert = db.prepare(`
      INSERT INTO alertas (
        comparison_id, type, severity, title, message, ot, entry_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const alert of comparison.alerts || []) {
      insertAlert.run(
        info.lastInsertRowid,
        alert.type || "",
        alert.severity || "",
        alert.title || "",
        alert.message || "",
        alert.ot || "",
        alert.entryId || "",
        generatedAt
      );
    }

    return info.lastInsertRowid;
  });

  return save();
}

function seedDatabaseFromCurrentState() {
  if (!db || !Array.isArray(runtime.data) || !runtime.data.length) {
    return;
  }

  const snapshotId = runtime.dataVersion || runtime.lastUpdate || "initial";
  const exists = db.prepare("SELECT 1 FROM monitor_snapshots WHERE id = ?").get(snapshotId);
  if (exists) {
    return;
  }

  const result = {
    raw: readJsonSafe(CONFIG.rawFile, null),
    debug: readJsonSafe(CONFIG.debugCapturedFile, { source: "estado-actual" }),
  };
  saveMonitorSnapshot(result, runtime.data, runtime.diff);
  saveComparisonHistory(buildBitacoraComparison(readBitacora(), runtime.data), snapshotId);
}

function previewToken(token) {
  const clean = normalizeText(token);
  if (!clean) {
    return null;
  }
  if (clean.length <= 24) {
    return clean;
  }
  return `${clean.slice(0, 20)}...${clean.slice(-10)}`;
}

function serializeError(error) {
  return normalizeText(error?.message || error?.toString() || "Error desconocido.");
}

function appendPersistentLog(entry) {
  try {
    if (fs.existsSync(CONFIG.logFile)) {
      const size = fs.statSync(CONFIG.logFile).size;
      if (size > CONFIG.maxLogBytes) {
        const rotated = `${CONFIG.logFile}.1`;
        if (fs.existsSync(rotated)) {
          fs.unlinkSync(rotated);
        }
        fs.renameSync(CONFIG.logFile, rotated);
      }
    }

    fs.appendFileSync(CONFIG.logFile, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {}
}

function parseJsonResponseText(text, source = "respuesta") {
  try {
    return JSON.parse(text);
  } catch (error) {
    const snippet = normalizeText(text).slice(0, 180);
    throw new Error(`No pude interpretar JSON de ${source}. ${snippet ? `Inicio de respuesta: ${snippet}` : "Respuesta vacia."}`);
  }
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) {
      return obj[key];
    }
  }
  return "";
}

function extractItems(apiJson) {
  if (Array.isArray(apiJson)) return apiJson;
  if (Array.isArray(apiJson?.pages)) {
    return apiJson.pages.flatMap((page) => extractItems(page.body || page));
  }
  if (Array.isArray(apiJson?.data)) return apiJson.data;
  if (Array.isArray(apiJson?.items)) return apiJson.items;
  if (Array.isArray(apiJson?.registros)) return apiJson.registros;
  if (Array.isArray(apiJson?.pendientes)) return apiJson.pendientes;
  if (Array.isArray(apiJson?.content)) return apiJson.content;
  if (Array.isArray(apiJson?.ordenes)) return apiJson.ordenes;
  return [];
}

function mapItem(item) {
  return {
    ot: pick(item, ["ot", "OT", "ordenTrabajo", "numeroOt", "numeroOT", "num_ot"]),
    usuarioCreador: pick(item, ["usuarioCreador", "usuario", "nombreUsuario", "usuario_creador"]),
    estatus: pick(item, ["estatus", "status"]),
    poliza: pick(item, ["poliza", "numeroPoliza", "prepoliza"]),
    agente: pick(item, ["agente", "codigoAgente", "cve_agente"]),
    contratante: pick(item, ["contratante", "nombreContratante"]),
    tipoSolicitud: pick(item, ["tipoSolicitud", "tipo_solicitud"]),
    producto: pick(item, ["producto"]),
    fechaCompromiso: pick(item, ["fechaCompromiso", "fecha_compromiso"]),
    fechaRegistro: pick(item, ["fechaRegistro", "fecha_registro", "fechaCreacion"]),
    primerIngreso: pick(item, ["primerIngreso", "primer_ingreso", "fechaPrimerIngreso"]),
    ultimoIngreso: pick(item, ["ultimoIngreso", "ultimo_ingreso", "fechaUltimoIngreso"]),
    guia: pick(item, ["guia", "numeroGuia", "noGuia"]),
    medioApertura: pick(item, ["medioApertura", "medio_apertura"]),
    rol: pick(item, ["rol"]),
    raw: item,
  };
}

function createEmptyDiff(totalActual = 0) {
  return {
    timestamp: null,
    summary: {
      totalAnterior: 0,
      totalActual,
      nuevos: 0,
      cambiados: 0,
      eliminados: 0,
      iguales: totalActual,
    },
    nuevos: [],
    cambiados: [],
    eliminados: [],
    iguales: [],
  };
}

function sortRows(rows) {
  return [...rows].sort((left, right) => {
    const first = parseDateForSort(left.fechaCompromiso) - parseDateForSort(right.fechaCompromiso);
    if (first !== 0) {
      return first;
    }
    return normalizeText(left.ot).localeCompare(normalizeText(right.ot), "es");
  });
}

function isTerminada(row) {
  return normalizeLoose(row?.estatus) === "terminada";
}

function isCurrentMonthRow(row, today = new Date()) {
  const date = parseGnpDate(row?.fechaCompromiso);
  if (!date) {
    return false;
  }

  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
}

function getReferenceMonth(rows, fallback = new Date()) {
  const dates = (Array.isArray(rows) ? rows : [])
    .map((row) => parseGnpDate(row?.fechaCompromiso))
    .filter((date) => date && !Number.isNaN(date.getTime()));

  if (!dates.length) {
    return fallback;
  }

  return dates.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest), dates[0]);
}

function shouldKeepRowForCurrentView(row, referenceDate = new Date()) {
  return isCurrentMonthRow(row, referenceDate) || !isTerminada(row);
}

function mergeCurrentMonthWithOpenOlderRows(currentMonthRows, normalRows) {
  const referenceDate = getReferenceMonth(currentMonthRows);
  const merged = currentMonthRows.filter((row) => shouldKeepRowForCurrentView(row, referenceDate));
  const currentKeys = new Set(merged.map(makeKey).filter(Boolean));

  for (const row of normalRows) {
    const key = makeKey(row);
    if (!key || currentKeys.has(key) || !shouldKeepRowForCurrentView(row, referenceDate)) {
      continue;
    }

    merged.push(row);
    currentKeys.add(key);
  }

  return sortRows(merged);
}

function compareRows(previousRows, currentRows) {
  const duplicateKeys = [];
  const toMap = (rows, label) => {
    const map = new Map();
    const seen = new Set();

    for (const row of rows) {
      const key = makeKey(row);
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        duplicateKeys.push({ source: label, ot: key });
      }
      seen.add(key);
      map.set(key, row);
    }

    return map;
  };

  const previousMap = toMap(previousRows, "previous");
  const currentMap = toMap(currentRows, "current");

  const nuevos = [];
  const cambiados = [];
  const eliminados = [];
  const iguales = [];

  const fieldsToCheck = [
    "estatus",
    "fechaCompromiso",
    "poliza",
    "agente",
    "contratante",
    "tipoSolicitud",
    "producto",
    "fechaRegistro",
    "primerIngreso",
    "ultimoIngreso",
    "guia",
    "medioApertura",
    "rol",
  ];

  for (const [key, current] of currentMap.entries()) {
    const previous = previousMap.get(key);

    if (!previous) {
      nuevos.push(current);
      continue;
    }

    const changes = [];
    for (const field of fieldsToCheck) {
      const before = normalizeText(previous[field]);
      const after = normalizeText(current[field]);
      if (before !== after) {
        changes.push({ field, before, after });
      }
    }

    if (changes.length > 0) {
      cambiados.push({
        ot: current.ot,
        previous,
        current,
        changes,
      });
    } else {
      iguales.push(current);
    }
  }

  for (const [key, previous] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      eliminados.push(previous);
    }
  }

  return {
    timestamp: nowIso(),
    summary: {
      totalAnterior: previousRows.length,
      totalActual: currentRows.length,
      nuevos: nuevos.length,
      cambiados: cambiados.length,
      eliminados: eliminados.length,
      iguales: iguales.length,
    },
    nuevos: sortRows(nuevos),
    cambiados: cambiados.sort((left, right) =>
      normalizeText(left.ot).localeCompare(normalizeText(right.ot), "es")
    ),
    eliminados: sortRows(eliminados),
    iguales: sortRows(iguales),
    warnings: duplicateKeys.length
      ? [
          {
            type: "duplicate_ot",
            message: "Se detectaron OT duplicadas; la comparacion usa la ultima fila de cada OT.",
            items: duplicateKeys,
          },
        ]
      : [],
  };
}

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const runtime = {
  browserContext: null,
  page: null,
  busy: false,
  mode: "idle",
  message: "Listo para consultar.",
  error: null,
  lastUpdate: readJsonSafe(CONFIG.diffFile, {}).timestamp || null,
  dataVersion: readJsonSafe(CONFIG.diffFile, {}).timestamp || "initial",
  data: readJsonSafe(CONFIG.currentFile, []),
  diff: readJsonSafe(
    CONFIG.diffFile,
    createEmptyDiff(readJsonSafe(CONFIG.currentFile, []).length)
  ),
  cancelRequested: false,
  executionLog: [],
  sessionInfo: {
    alive: false,
    lastCheckedAt: null,
    lastUrl: null,
    lastLoginMethod: null,
    note: null,
    ...readJsonSafe(CONFIG.sessionInfoFile, {}),
  },
  activeRun: null,
  manualLogin: {
    required: false,
    reason: null,
    promptedAt: null,
    expiresAt: null,
    emailFilled: false,
    passwordFilled: false,
    detectedCaptcha: false,
    instructions: [],
  },
  manualLoginDeferred: null,
  manualWatcher: null,
  manualLoginTimeout: null,
  manualWatcherBusy: false,
  scheduler: {
    enabled: CONFIG.autoRefreshMinutes > 0,
    everyMinutes: CONFIG.autoRefreshMinutes,
    lastTrigger: null,
    nextTrigger: null,
    timer: null,
  },
  validationWarnings: [],
  lastRunEndedAt: null,
  lastSuccessfulRunAt: null,
  lastFailedRunAt: null,
};

function assertNotCancelled() {
  if (runtime.cancelRequested) {
    throw new Error("Ejecucion cancelada por el usuario.");
  }
}

function pushLog(step, message, extra = {}) {
  const entry = {
    at: nowIso(),
    step,
    message,
    ...extra,
  };

  runtime.executionLog = [entry, ...runtime.executionLog].slice(0, 50);
  appendPersistentLog(entry);
}

function setState(mode, message) {
  runtime.mode = mode;
  runtime.message = message;
}

function saveSessionInfo(patch) {
  runtime.sessionInfo = {
    alive: false,
    lastCheckedAt: runtime.sessionInfo.lastCheckedAt || null,
    lastUrl: runtime.sessionInfo.lastUrl || null,
    lastLoginMethod: runtime.sessionInfo.lastLoginMethod || null,
    note: runtime.sessionInfo.note || null,
    ...patch,
  };
  writeJson(CONFIG.sessionInfoFile, runtime.sessionInfo);
}

function sanitizeUrlForClient(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`;
  } catch {
    return text.split("?")[0] || null;
  }
}

function publicSessionInfo(sessionInfo) {
  return {
    alive: Boolean(sessionInfo?.alive),
    lastCheckedAt: sessionInfo?.lastCheckedAt || null,
    lastUrl: sanitizeUrlForClient(sessionInfo?.lastUrl),
    lastLoginMethod: sessionInfo?.lastLoginMethod || null,
    note: sessionInfo?.note || null,
  };
}

function publicSchedulerInfo(scheduler) {
  return {
    enabled: Boolean(scheduler.enabled),
    everyMinutes: scheduler.everyMinutes,
    lastTrigger: scheduler.lastTrigger,
    nextTrigger: scheduler.nextTrigger,
  };
}

function isLocalHost(host) {
  const value = String(host || "").trim().toLowerCase();
  return ["127.0.0.1", "localhost", "::1"].includes(value);
}

function normalizeIpAddress(value) {
  let ip = String(value || "").trim();
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  if (ip === "::1") {
    return "127.0.0.1";
  }
  return ip;
}

function getClientIp(req) {
  return normalizeIpAddress(req.ip || req.socket?.remoteAddress || "");
}

function ipv4ToInt(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return bytes.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
}

function matchesIpRule(clientIp, rule) {
  const normalizedRule = normalizeIpAddress(rule);
  if (!normalizedRule) return false;
  if (!normalizedRule.includes("/")) {
    return clientIp === normalizedRule;
  }

  const [baseIp, prefixText] = normalizedRule.split("/");
  const prefix = Number(prefixText);
  const client = ipv4ToInt(clientIp);
  const base = ipv4ToInt(baseIp);
  if (client === null || base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (client & mask) === (base & mask);
}

function getAllowedIpRules() {
  return [
    "127.0.0.1",
    ...CONFIG.allowedIps,
  ].filter(Boolean);
}

function requireAllowedIp(req, res, next) {
  const allowedIps = getAllowedIpRules();
  const clientIp = getClientIp(req);

  if (!CONFIG.allowedIps.length || allowedIps.some((rule) => matchesIpRule(clientIp, rule))) {
    next();
    return;
  }

  pushLog("security", "Solicitud bloqueada por lista blanca de IP.", {
    ip: clientIp,
    path: req.path,
  });

  res.status(403).json({
    ok: false,
    message: "Acceso no permitido desde esta IP.",
  });
}

function applySecurityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function hasValidMonitorToken(req) {
  if (!CONFIG.monitorToken) {
    return true;
  }

  const headerToken = req.get("x-monitor-token") || "";
  const bodyToken = req.body && typeof req.body.monitorToken === "string" ? req.body.monitorToken : "";
  const queryToken = typeof req.query.monitorToken === "string" ? req.query.monitorToken : "";
  return [headerToken, bodyToken, queryToken].some((token) => token === CONFIG.monitorToken);
}

function requireMonitorToken(req, res, next) {
  if (hasValidMonitorToken(req)) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    authRequired: true,
    message: "Token local requerido. Configura MONITOR_TOKEN o envia X-Monitor-Token.",
  });
}

app.use(applySecurityHeaders);
app.use(requireAllowedIp);
app.use("/api/bitacora/import-excel", express.raw({
  type: "application/octet-stream",
  limit: "25mb",
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function validateConfig() {
  const warnings = [];

  if (!CONFIG.email) {
    warnings.push("GNP_EMAIL no esta configurado; podria requerir login manual.");
  }
  if (!CONFIG.password) {
    warnings.push("GNP_PASSWORD no esta configurado; podria requerir login manual.");
  }
  if (!CONFIG.consultaUrl.includes("/home/pagina-iframe")) {
    warnings.push("CONSULTA_URL no parece apuntar a la vista de consulta.");
  }
  if (!CONFIG.dashboardUrl.includes("/home/dashboard")) {
    warnings.push("DASHBOARD_URL/INICIO_URL no parece apuntar al dashboard principal.");
  }
  if (!CONFIG.profileDir) {
    warnings.push("PROFILE_DIR no esta configurado.");
  }
  if (!CONFIG.monitorToken && !isLocalHost(CONFIG.host)) {
    warnings.push("MONITOR_TOKEN no esta configurado y HOST permite acceso fuera de localhost.");
  }
  if (!CONFIG.allowedIps.length && !isLocalHost(CONFIG.host)) {
    warnings.push("ALLOWED_IPS no esta configurado y HOST permite acceso fuera de localhost.");
  }
  if (CONFIG.trustProxy && !CONFIG.allowedIps.length) {
    warnings.push("TRUST_PROXY esta activo, pero ALLOWED_IPS no esta configurado.");
  }

  runtime.validationWarnings = warnings;
  warnings.forEach((message) => pushLog("config", message));
  return warnings;
}

function cleanupOldScreenshots() {
  try {
    const files = fs
      .readdirSync(CONFIG.screenshotsDir)
      .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
      .map((name) => {
        const file = path.join(CONFIG.screenshotsDir, name);
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    const stale = files.slice(CONFIG.keepScreenshots);
    stale.forEach((item) => {
      fs.unlinkSync(item.file);
    });

    if (stale.length) {
      pushLog("system", "Screenshots antiguos eliminados.", {
        deleted: stale.length,
        kept: CONFIG.keepScreenshots,
      });
    }
  } catch (error) {
    pushLog("system", "No pude limpiar screenshots antiguos.", {
      error: serializeError(error),
    });
  }
}

function clearManualWatcher() {
  if (runtime.manualWatcher) {
    clearInterval(runtime.manualWatcher);
    runtime.manualWatcher = null;
  }
  if (runtime.manualLoginTimeout) {
    clearTimeout(runtime.manualLoginTimeout);
    runtime.manualLoginTimeout = null;
  }
  runtime.manualWatcherBusy = false;
}

function resetManualLoginState() {
  clearManualWatcher();
  runtime.manualLoginDeferred = null;
  runtime.manualLogin = {
    required: false,
    reason: null,
    promptedAt: null,
    expiresAt: null,
    emailFilled: false,
    passwordFilled: false,
    detectedCaptcha: false,
    instructions: [],
  };
}

async function screenshot(page, name) {
  const file = path.join(CONFIG.screenshotsDir, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  cleanupOldScreenshots();
  return file;
}

function isLoggedInUrl(url) {
  const clean = normalizeText(url).toLowerCase();
  return (
    clean.includes("portalintermediarios.gnp.com.mx") &&
    !clean.includes("/sesion") &&
    (clean.includes("/home/") ||
      clean.includes("/dashboard") ||
      clean.includes("/pagina-iframe"))
  );
}

function isLoginUrl(url) {
  const clean = normalizeText(url).toLowerCase();
  return (
    clean.includes("portalintermediarios.gnp.com.mx") &&
    (clean.endsWith("/") || clean.includes("/sesion"))
  );
}

function getSearchTargets(page) {
  const targets = [page];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      targets.push(frame);
    }
  }
  return targets;
}

function describeTarget(target) {
  if (typeof target.url === "function") {
    return target.url();
  }
  return "page";
}

async function getWorkflowTarget(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const form = target.locator('form#workflow-select').first();
      const visible = await form.isVisible().catch(() => false);
      if (visible) {
        return target;
      }
    } catch {}
  }

  for (const target of getSearchTargets(page)) {
    try {
      const text = normalizeLoose(await target.locator("body").innerText({ timeout: 800 }).catch(() => ""));
      if (text.includes("selecciona tu workflow") || text.includes("consulta por estatus")) {
        return target;
      }
    } catch {}
  }

  return page;
}

async function clickLocator(locator) {
  try {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
  } catch {}

  try {
    await locator.click({ timeout: 2000 });
    return true;
  } catch {
    try {
      await locator.click({ force: true, timeout: 2000 });
      return true;
    } catch {
      try {
        await locator.evaluate((node) => {
          if (node instanceof HTMLElement) {
            node.focus();
            node.click();
            node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          }
        });
        return true;
      } catch {
        try {
          await locator.press("Enter", { timeout: 1500 });
          return true;
        } catch {
          try {
            await locator.press("Space", { timeout: 1500 });
            return true;
          } catch {
            return false;
          }
        }
      }
    }
  }
}

async function findVisibleLocator(page, selectors, timeout = 0, onlyEnabled = false) {
  const deadline = Date.now() + timeout;

  while (true) {
    for (const target of getSearchTargets(page)) {
      for (const selector of selectors) {
        try {
          const locator = target.locator(selector).first();
          const count = await locator.count();
          if (!count) {
            continue;
          }

          const visible = await locator.isVisible().catch(() => false);
          if (!visible) {
            continue;
          }

          if (onlyEnabled) {
            const enabled = await locator.isEnabled().catch(() => true);
            if (!enabled) {
              continue;
            }
          }

          return {
            locator,
            selector,
            target,
          };
        } catch {}
      }
    }

    if (!timeout || Date.now() >= deadline) {
      break;
    }
    await page.waitForTimeout(300);
  }

  return null;
}

async function clickFirst(page, selectors, timeout = 10000, onlyEnabled = false) {
  const found = await findVisibleLocator(page, selectors, timeout, onlyEnabled);
  if (!found) {
    return false;
  }
  return clickLocator(found.locator);
}

async function fillFirst(page, selectors, value, timeout = 10000) {
  const found = await findVisibleLocator(page, selectors, timeout, false);
  if (!found) {
    return false;
  }

  try {
    await found.locator.fill("");
    await found.locator.fill(String(value ?? ""));
    return true;
  } catch {
    return false;
  }
}

async function isLoginFormVisible(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const email = target.locator(LOGIN_SELECTORS.email.join(", ")).first();
      const password = target.locator(LOGIN_SELECTORS.password.join(", ")).first();
      const emailVisible = await email.isVisible().catch(() => false);
      const passwordVisible = await password.isVisible().catch(() => false);

      if (emailVisible && passwordVisible) {
        return true;
      }
    } catch {}
  }

  try {
    const bodyText = await page.locator("body").innerText({ timeout: 1200 });
    return /correo electronico|contrase[nÃ±]a|iniciar sesi[oÃ³]n/i.test(bodyText);
  } catch {
    return false;
  }
}

async function detectCaptcha(page) {
  const found = await findVisibleLocator(page, LOGIN_SELECTORS.captcha, 1000, false);
  if (found) {
    return true;
  }

  try {
    const bodyText = await page.locator("body").innerText({ timeout: 1500 });
    if (/captcha|recaptcha/i.test(bodyText)) {
      return true;
    }
  } catch {}

  return false;
}

async function appearsLoggedIn(page) {
  if (await isLoginFormVisible(page)) {
    return false;
  }

  const url = page.url();

  try {
    const bodyText = await page.locator("body").innerText({ timeout: 1200 });
    const looksLikePortal =
      /bienvenido|herramientas de cotizacion|consulta por estatus|servicios asistidos|selecciona tu workflow/i.test(
        bodyText
      ) && !/iniciar sesi[oÃ³]n|correo electronico|contrase[nÃ±]a/i.test(bodyText);

    if (looksLikePortal && isLoggedInUrl(url)) {
      return true;
    }
  } catch {}

  return false;
}

async function dismissBlockingOverlays(page) {
  try {
    await page.keyboard.press("Escape").catch(() => {});
  } catch {}

  await clickFirst(
    page,
    [
      'button[aria-label*="Cerrar" i]',
      'button[title*="Cerrar" i]',
      'button:has-text("Cerrar")',
      'button:has-text("No gracias")',
      'button:has-text("Entendido")',
      '[aria-label="Close"]',
    ],
    800
  ).catch(() => {});
}

async function describePageHealth(page) {
  const fallback = {
    url: "",
    title: "",
    bodyLength: 0,
    bodyText: "",
    hasConsultaFrame: false,
    hasWorkflowForm: false,
    hasWorkflowText: false,
    hasTableRows: false,
    isBlankLike: true,
    isConsultaShellStalled: false,
  };

  if (!page || page.isClosed()) {
    return fallback;
  }

  try {
    const frameUrls = page.frames().map((frame) => frame.url()).filter(Boolean);
    const info = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const iframe = document.querySelector("#wfdaiframe") ||
        document.querySelector('iframe[src*="wf-consultasdas.gnp.com.mx"]') ||
        document.querySelector('iframe[src*="wf-da-busqueda.gnp.com.mx"]');

      return {
        title: document.title || "",
        bodyText,
        bodyLength: bodyText.length,
        iframeSrc: iframe instanceof HTMLIFrameElement ? iframe.src || iframe.getAttribute("src") || "" : "",
        hasWorkflowForm: Boolean(document.querySelector("form#workflow-select")),
        hasWorkflowText: /selecciona tu workflow|consulta por estatus|gastos m[eé]dicos mayores/i.test(bodyText),
        hasTableRows: Boolean(document.querySelector("table tbody tr")),
      };
    }).catch(() => null);

    const url = page.url();
    const hasConsultaFrame =
      /wf-consultasdas\.gnp\.com\.mx|wf-da-busqueda\.gnp\.com\.mx/i.test(
        [info?.iframeSrc || "", ...frameUrls].join(" ")
      );
    const bodyLength = Number(info?.bodyLength || 0);
    const isBlankLike = bodyLength < 80 && !hasConsultaFrame && !info?.hasWorkflowForm && !info?.hasTableRows;
    const isConsultaShellStalled =
      url.includes("/home/pagina-iframe") &&
      !hasConsultaFrame &&
      !info?.hasWorkflowForm &&
      !info?.hasWorkflowText &&
      !info?.hasTableRows;

    return {
      url,
      title: info?.title || "",
      bodyLength,
      bodyText: normalizeText(info?.bodyText || "").slice(0, 180),
      hasConsultaFrame,
      hasWorkflowForm: Boolean(info?.hasWorkflowForm),
      hasWorkflowText: Boolean(info?.hasWorkflowText),
      hasTableRows: Boolean(info?.hasTableRows),
      isBlankLike,
      isConsultaShellStalled,
    };
  } catch {
    return {
      ...fallback,
      url: page.url(),
    };
  }
}

async function closeBrowserContext(reason = "reinicio solicitado") {
  const context = runtime.browserContext;
  runtime.browserContext = null;
  runtime.page = null;

  if (context) {
    pushLog("browser", `Cerrando navegador: ${reason}.`);
    await context.close().catch(() => {});
  }
}

async function preparePageForUse(page) {
  if (page.__gnpMonitorPrepared) {
    return;
  }
  page.__gnpMonitorPrepared = true;
  page.setDefaultTimeout(15000);

  page.on("dialog", async (dialog) => {
    pushLog("browser", "Dialogo del navegador cerrado automaticamente.", {
      type: dialog.type(),
      message: normalizeText(dialog.message()).slice(0, 160),
    });
    await dialog.dismiss().catch(() => {});
  });

  page.on("crash", () => {
    pushLog("browser", "La pagina controlada por Playwright reporto crash.");
  });

  page.on("pageerror", (error) => {
    pushLog("browser", "Error de pagina detectado.", {
      error: serializeError(error).slice(0, 180),
    });
  });
}

async function waitForConsultaReady(page, timeout = CONFIG.consultaReadyTimeoutMs) {
  const deadline = Date.now() + timeout;
  let lastHealth = await describePageHealth(page);

  while (Date.now() < deadline) {
    assertNotCancelled();
    lastHealth = await describePageHealth(page);

    if (
      lastHealth.hasConsultaFrame ||
      lastHealth.hasWorkflowForm ||
      lastHealth.hasWorkflowText ||
      lastHealth.hasTableRows
    ) {
      return {
        ready: true,
        health: lastHealth,
      };
    }

    await page.waitForTimeout(700);
  }

  return {
    ready: false,
    health: lastHealth,
  };
}

async function waitForDashboardReady(page, timeout = 12000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    assertNotCancelled();

    const health = await describePageHealth(page);
    const onDashboard = health.url.includes("/home/dashboard");
    const portalResponded =
      health.bodyLength > 120 ||
      /dashboard|inicio|bienvenido|herramientas|portal intermediarios/i.test(health.bodyText);

    if (onDashboard && portalResponded && !health.isBlankLike) {
      return true;
    }

    await page.waitForTimeout(700);
  }

  return false;
}

async function navigateDashboardThenConsulta(page, reason = "cambio de pantalla") {
  pushLog("recovery", "Rebotando por dashboard antes de volver a consulta.", {
    reason,
    dashboardUrl: sanitizeUrlForClient(CONFIG.dashboardUrl),
    consultaUrl: sanitizeUrlForClient(CONFIG.consultaUrl),
  });

  await page.goto(CONFIG.dashboardUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await dismissBlockingOverlays(page);
  const dashboardReady = await waitForDashboardReady(page, 12000);
  pushLog("recovery", dashboardReady ? "Inicio respondio; vuelvo a consulta." : "Inicio no confirmo carga completa; intento consulta de todos modos.", {
    url: sanitizeUrlForClient(page.url()),
  });

  await page.goto(CONFIG.consultaUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissBlockingOverlays(page);

  return page;
}

async function ensureConsultaOperational(page, reason = "validacion de consulta") {
  await preparePageForUse(page);

  if (page.isClosed()) {
    throw new Error("La pagina de consulta se cerro.");
  }

  let health = await describePageHealth(page);
  if (!health.url.includes("/home/pagina-iframe")) {
    pushLog("recovery", "La pagina activa no esta en consulta; navegare a consulta.", {
      reason,
      url: sanitizeUrlForClient(health.url),
    });
    await page.goto(CONFIG.consultaUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await dismissBlockingOverlays(page);
  }

  let ready = await waitForConsultaReady(page, 10000);
  if (!ready.ready || ready.health.isBlankLike || ready.health.isConsultaShellStalled) {
    page = await recoverConsultaPage(page, reason);
    ready = await waitForConsultaReady(page, 12000);
  }

  health = ready.health || (await describePageHealth(page));
  if (!ready.ready || health.isBlankLike || health.isConsultaShellStalled) {
    throw new Error("La vista de consulta sigue sin responder despues de recuperarla.");
  }

  if (!(await appearsLoggedIn(page))) {
    saveSessionInfo({
      alive: false,
      lastCheckedAt: nowIso(),
      lastUrl: page.url(),
      note: "La sesion se perdio durante la consulta.",
    });
    throw new Error("La sesion se perdio durante la consulta.");
  }

  runtime.page = page;
  return page;
}

async function recoverConsultaPage(page, reason) {
  let currentPage = page;

  for (let attempt = 1; attempt <= CONFIG.pageRecoveryAttempts; attempt += 1) {
    assertNotCancelled();
    const health = await describePageHealth(currentPage);
    pushLog("recovery", "Intentando recuperar la pagina de consulta.", {
      reason,
      attempt,
      url: sanitizeUrlForClient(health.url),
      bodyLength: health.bodyLength,
      hasConsultaFrame: health.hasConsultaFrame,
      hasWorkflowForm: health.hasWorkflowForm,
      isBlankLike: health.isBlankLike,
      isConsultaShellStalled: health.isConsultaShellStalled,
    });

    try {
      if (attempt === 1 && !currentPage.isClosed()) {
        await navigateDashboardThenConsulta(currentPage, reason).catch(async () => {
          await currentPage.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(async () => {
            await currentPage.goto(CONFIG.consultaUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          });
        });
      } else if (attempt === 2 && runtime.browserContext) {
        const freshPage = await runtime.browserContext.newPage();
        await preparePageForUse(freshPage);
        await navigateDashboardThenConsulta(freshPage, reason);
        if (!currentPage.isClosed()) {
          await currentPage.close().catch(() => {});
        }
        currentPage = freshPage;
        runtime.page = freshPage;
      } else {
        await closeBrowserContext("pagina de consulta colgada");
        const context = await getContext();
        currentPage = context.pages()[0] || (await context.newPage());
        await preparePageForUse(currentPage);
        await navigateDashboardThenConsulta(currentPage, reason);
      }

      await currentPage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await currentPage.waitForTimeout(1500);
      await dismissBlockingOverlays(currentPage);

      const ready = await waitForConsultaReady(currentPage, Math.min(CONFIG.consultaReadyTimeoutMs, 12000));
      if (ready.ready) {
        pushLog("recovery", "Pagina de consulta recuperada.", {
          attempt,
          url: sanitizeUrlForClient(currentPage.url()),
          hasConsultaFrame: ready.health.hasConsultaFrame,
          hasWorkflowForm: ready.health.hasWorkflowForm,
        });
        runtime.page = currentPage;
        return currentPage;
      }
    } catch (error) {
      pushLog("recovery", "Fallo un intento de recuperacion de pagina.", {
        attempt,
        error: serializeError(error),
      });
    }
  }

  throw new Error(`La pagina de consulta no cargo despues de ${CONFIG.pageRecoveryAttempts} intentos de recuperacion.`);
}

async function getContext() {
  if (runtime.browserContext) {
    if (!runtime.page || runtime.page.isClosed()) {
      runtime.page = runtime.browserContext.pages()[0] || (await runtime.browserContext.newPage());
    }
    await preparePageForUse(runtime.page);
    return runtime.browserContext;
  }

  const launchOptions = {
    headless: CONFIG.headless,
    viewport: { width: 1600, height: 900 },
    slowMo: CONFIG.headless ? 0 : 70,
    args: [
      "--disable-session-crashed-bubble",
      "--disable-features=InfiniteSessionRestore,msEdgeRestorePage",
    ],
  };

  if (CONFIG.browserChannel) {
    launchOptions.channel = CONFIG.browserChannel;
  }

  runtime.browserContext = await chromium.launchPersistentContext(CONFIG.profileDir, launchOptions);

  runtime.page = runtime.browserContext.pages()[0] || (await runtime.browserContext.newPage());
  await preparePageForUse(runtime.page);

  runtime.browserContext.on("page", (page) => {
    void preparePageForUse(page);
  });

  pushLog("browser", "Se abrio el navegador persistente.");
  return runtime.browserContext;
}

async function getActivePage() {
  await getContext();

  const pages = runtime.browserContext.pages().filter((page) => !page.isClosed());
  const currentPage =
    runtime.page && !runtime.page.isClosed()
      ? runtime.page
      : pages.find((page) => /gnp\.com\.mx|portalintermediarios/i.test(page.url())) ||
        pages[0] ||
        (await runtime.browserContext.newPage());

  for (const page of runtime.browserContext.pages()) {
    if (page !== currentPage && !page.isClosed()) {
      try {
        const url = page.url();
        const shouldClose =
          url === "about:blank" ||
          (url === currentPage.url() && /gnp\.com\.mx|portalintermediarios/i.test(url));

        if (shouldClose) {
          await page.close();
        }
      } catch {}
    }
  }

  await preparePageForUse(currentPage);
  runtime.page = currentPage;
  return runtime.page;
}

async function verifyExistingSession(page) {
  setState("checking_session", "Revisando si la sesion guardada sigue viva...");
  pushLog("session", "Revisando si la sesion guardada sigue viva...");

  await page.goto(CONFIG.consultaUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

  const alive = await appearsLoggedIn(page);
  saveSessionInfo({
    alive,
    lastCheckedAt: nowIso(),
    lastUrl: page.url(),
    lastLoginMethod: alive ? "session" : runtime.sessionInfo.lastLoginMethod,
    note: alive ? "Sesion recuperada con perfil persistente." : "No habia sesion vigente.",
  });

  return alive;
}

async function prepareLoginPage(page) {
  await page.goto(CONFIG.loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  await dismissBlockingOverlays(page);

  if (!(await isLoginFormVisible(page))) {
    await page.goto("https://portalintermediarios.gnp.com.mx/sesion", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1000);
    await dismissBlockingOverlays(page);
  }

  let emailFilled = CONFIG.email
    ? await fillFirst(page, LOGIN_SELECTORS.email, CONFIG.email, 12000)
    : false;
  let passwordFilled = CONFIG.password
    ? await fillFirst(page, LOGIN_SELECTORS.password, CONFIG.password, 12000)
    : false;

  if (!emailFilled && CONFIG.email) {
    try {
      const textInput = page.locator('input[type="text"]:visible, input[id^="mat-input-"]:visible').first();
      await textInput.fill("");
      await textInput.type(CONFIG.email, { delay: 20 });
      emailFilled = true;
    } catch {}
  }

  if (!passwordFilled && CONFIG.password) {
    try {
      const passwordInput = page.locator('input[type="password"]:visible').first();
      await passwordInput.fill("");
      await passwordInput.type(CONFIG.password, { delay: 20 });
      passwordFilled = true;
    } catch {}
  }

  const captchaDetected = await detectCaptcha(page);

  saveSessionInfo({
    alive: false,
    lastCheckedAt: nowIso(),
    lastUrl: page.url(),
    note: emailFilled || passwordFilled ? "Pantalla de login preparada." : "Pantalla de login abierta sin autollenado.",
  });

  return {
    emailFilled,
    passwordFilled,
    captchaDetected,
  };
}

async function autoResolveManualLogin() {
  if (!runtime.manualLoginDeferred || runtime.manualWatcherBusy) {
    return false;
  }

  runtime.manualWatcherBusy = true;

  try {
    const page = runtime.page;
    if (!page || page.isClosed()) {
      return false;
    }

    if (!(await appearsLoggedIn(page))) {
      return false;
    }

    saveSessionInfo({
      alive: true,
      lastCheckedAt: nowIso(),
      lastUrl: page.url(),
      lastLoginMethod: "manual",
      note: "Sesion manual detectada automaticamente.",
    });

    pushLog("manual_login", "Sesion detectada automaticamente despues del login manual.");
    setState("querying", "Sesion manual detectada. Entrando a la consulta...");

    const deferred = runtime.manualLoginDeferred;
    resetManualLoginState();
    deferred.resolve(page);
    return true;
  } finally {
    runtime.manualWatcherBusy = false;
  }
}

function waitForManualLogin(prepared, reason) {
  const deferred = createDeferred();

  runtime.manualLoginDeferred = deferred;
  runtime.manualLogin = {
    required: true,
    reason,
    promptedAt: nowIso(),
    expiresAt: new Date(Date.now() + CONFIG.manualLoginTimeoutMinutes * 60 * 1000).toISOString(),
    emailFilled: Boolean(prepared.emailFilled),
    passwordFilled: Boolean(prepared.passwordFilled),
    detectedCaptcha: Boolean(prepared.captchaDetected),
    instructions: [
      "Usa la ventana del navegador que el sistema dejo abierta.",
      "Termina el login manual y resuelve el reCAPTCHA si aparece.",
      "No hace falta tocar el boton si el sistema detecta la sesion solo.",
      "Si no avanza solo, entonces pulsa el boton para continuar.",
    ],
  };

  setState(
    "waiting_manual_login",
    "Login manual requerido. La ventana del navegador sigue abierta y el sistema esta esperando sesion valida."
  );
  pushLog("manual_login", reason);

  clearManualWatcher();
  runtime.manualWatcher = setInterval(() => {
    void autoResolveManualLogin();
  }, 1500);
  runtime.manualLoginTimeout = setTimeout(() => {
    const activeDeferred = runtime.manualLoginDeferred;
    if (!activeDeferred) {
      return;
    }
    const message = `Login manual agotado despues de ${CONFIG.manualLoginTimeoutMinutes} minutos. Vuelve a ejecutar la consulta.`;
    pushLog("manual_login", message);
    activeDeferred.reject(new Error(message));
  }, CONFIG.manualLoginTimeoutMinutes * 60 * 1000);

  return deferred.promise;
}

async function continueAfterManualLogin() {
  if (!runtime.manualLoginDeferred) {
    const page = runtime.page;
    if (page && !page.isClosed() && (await appearsLoggedIn(page))) {
      saveSessionInfo({
        alive: true,
        lastCheckedAt: nowIso(),
        lastUrl: page.url(),
        lastLoginMethod: runtime.sessionInfo.lastLoginMethod || "manual",
        note: "La sesion ya estaba activa.",
      });

      return {
        ok: true,
        message: "La sesion ya estaba activa. No hacia falta continuar manualmente.",
      };
    }

    return {
      ok: false,
      message: "No se esta esperando login manual ni veo una sesion activa.",
    };
  }

  const detected = await autoResolveManualLogin();
  if (detected) {
    return {
      ok: true,
      message: "Sesion detectada. La consulta continua.",
    };
  }

  return {
    ok: false,
    message: "Todavia no detecto una sesion valida despues del login manual.",
  };
}

async function ensureLoggedIn(page) {
  const alive = await verifyExistingSession(page);
  if (alive) {
    pushLog("session", "La sesion persistente sigue activa.");
    return page;
  }

  setState("auto_login", "No hay sesion activa. Intentando login automatico...");
  pushLog("login", "No habia sesion activa. Se prepara el login automatico.");

  const prepared = await prepareLoginPage(page);
  pushLog("login", "Formulario de login preparado.", prepared);

  if (!prepared.emailFilled || !prepared.passwordFilled) {
    return waitForManualLogin(
      prepared,
      "No pude dejar listo el formulario completo. Termina el acceso manualmente."
    );
  }

  if (prepared.captchaDetected) {
    return waitForManualLogin(prepared, "Se detecto reCAPTCHA antes de enviar el formulario.");
  }

  setState("auto_login", "Credenciales listas. Intentando entrar...");
  pushLog("login", "Se intenta enviar el formulario de login.");

  const submitted = await clickFirst(page, LOGIN_SELECTORS.submit, 10000, true);
  if (!submitted) {
    return waitForManualLogin(prepared, "No encontre el boton para iniciar sesion.");
  }

  await page.waitForTimeout(7000);
  await page.waitForLoadState("networkidle").catch(() => {});

  if (await appearsLoggedIn(page)) {
    saveSessionInfo({
      alive: true,
      lastCheckedAt: nowIso(),
      lastUrl: page.url(),
      lastLoginMethod: "automatic",
      note: "Login automatico completado.",
    });
    pushLog("login", "Login automatico confirmado.");
    return page;
  }

  const afterSubmitCaptcha = await detectCaptcha(page);
  const preparedAgain = {
    emailFilled: true,
    passwordFilled: true,
    captchaDetected: afterSubmitCaptcha,
  };

  return waitForManualLogin(
    preparedAgain,
    afterSubmitCaptcha
      ? "GNP pidio captcha o bloqueo despues del submit automatico."
      : "El portal no confirmo el login automatico."
  );
}

async function gotoConsulta(page) {
  setState("querying", "Entrando directo a la ventana de consulta...");
  await preparePageForUse(page);
  const alreadyInConsulta = page.url().includes("/home/pagina-iframe");

  if (!alreadyInConsulta) {
    pushLog("query", "Se navega directo a la URL de consulta.");
    await page.goto(CONFIG.consultaUrl, { waitUntil: "domcontentloaded" });
  } else {
    pushLog("query", "La pagina ya esta en la URL de consulta.");
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await dismissBlockingOverlays(page);

  let ready = await waitForConsultaReady(page);
  if (!ready.ready || ready.health.isBlankLike || ready.health.isConsultaShellStalled) {
    page = await recoverConsultaPage(page, "consulta sin iframe ni workflow despues de navegar");
    ready = await waitForConsultaReady(page, 12000);
  }

  if (!(await appearsLoggedIn(page))) {
    throw new Error("La sesion se perdio al intentar entrar a la consulta.");
  }

  saveSessionInfo({
    alive: true,
    lastCheckedAt: nowIso(),
    lastUrl: page.url(),
    note: "Dentro de la ventana de consulta.",
  });

  return page;
}

async function openWorkflowCombo(page) {
  const comboSelectors = [
    ...CONSULTA_SELECTORS.workflowCombo,
    'md-select[id^="select_"]',
    'md-select[aria-label*="Workflow" i]',
    'md-select[aria-label*="Selecciona tu Workflow" i]',
    'md-select[ng-model*="workflow" i]',
    'md-select[name*="workflow" i]',
    'md-input-container md-select',
    '.workflow md-select',
    '.workflow .md-select-value',
    '.workflow .md-select-value span',
  ];

  const optionSelectors = [
    ...WORKFLOW_OPTION_SELECTORS,
    'md-option:has-text("Gastos Medicos Mayores")',
    'md-option:has-text("Gastos MÃ©dicos Mayores")',
    '.md-text:has-text("Gastos Medicos Mayores")',
    '.md-text:has-text("Gastos MÃ©dicos Mayores")',
  ];

  for (const target of getSearchTargets(page)) {
    try {
      const containers = target.locator("md-input-container");
      const count = await containers.count();

      for (let index = 0; index < count; index += 1) {
        const container = containers.nth(index);
        const text = normalizeLoose(await container.innerText().catch(() => ""));
        if (!text.includes("workflow")) {
          continue;
        }

        const visible = await container.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        pushLog("query", "Intentando abrir workflow desde contenedor.", {
          target: describeTarget(target),
          text,
        });

        const clicked =
          (await clickLocator(container.locator('md-select[id^="select_"]').first())) ||
          (await clickLocator(container.locator("md-select").first())) ||
          (await clickLocator(container.locator(".md-select-value").first())) ||
          (await clickLocator(container.locator(".md-select-icon").first())) ||
          (await clickLocator(container.locator("label").first())) ||
          (await clickLocator(container));

        if (!clicked) {
          continue;
        }

        await page.waitForTimeout(700);

        const optionFound = await findVisibleLocator(page, optionSelectors, 1800, false);
        if (optionFound) {
          return true;
        }
      }
    } catch {}
  }

  for (const selector of comboSelectors) {
    const found = await findVisibleLocator(page, [selector], 2500, false);
    if (!found) {
      continue;
    }

    pushLog("query", "Intentando abrir workflow.", {
      selector,
      target: describeTarget(found.target),
    });

    const clicked =
      (await clickLocator(found.locator)) ||
      (await clickLocator(found.locator.locator(".md-select-value").first())) ||
      (await clickLocator(found.locator.locator(".md-select-icon").first())) ||
      (await clickLocator(found.locator.locator("span").first()));

    if (!clicked) {
      continue;
    }

    await page.waitForTimeout(700);

    const optionFound = await findVisibleLocator(page, optionSelectors, 1500, false);
    if (optionFound) {
      return true;
    }
  }

  return false;
}

async function isWorkflowSelected(page) {
  const wanted = normalizeLoose(WORKFLOW_TARGET.label);

  for (const target of getSearchTargets(page)) {
    try {
      const combo = target.locator('form#workflow-select md-select#select_32, md-select#select_32').first();
      const visible = await combo.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const comboText = normalizeLoose(await combo.innerText().catch(() => ""));
      if (comboText.includes(wanted)) {
        return true;
      }

       const ariaInvalid = await combo.getAttribute("aria-invalid").catch(() => null);
       if (ariaInvalid === "false") {
         return true;
       }
    } catch {}
  }

  const consultarReady = await findVisibleLocator(page, CONSULTA_SELECTORS.consultar, 1200, true);
  return Boolean(consultarReady);
}

async function setWorkflowViaAngular(page) {
  try {
    const target = await getWorkflowTarget(page);
    const changed = await target.evaluate((workflowValue) => {
      const angularApi = window.angular;
      const form = document.querySelector("form#workflow-select");
      const select =
        document.querySelector('form#workflow-select md-select[ng-model="workflow2.workflow"]') ||
        document.querySelector("form#workflow-select md-select");

      if (!form || !select || !angularApi?.element) {
        return { ok: false, reason: "missing_form_or_angular" };
      }

      const formScope =
        angularApi.element(form).scope?.() ||
        angularApi.element(form).isolateScope?.();
      const selectScope =
        angularApi.element(select).scope?.() ||
        angularApi.element(select).isolateScope?.();
      const ngModelCtrl = angularApi.element(select).controller?.("ngModel");

      let scope = formScope || selectScope || null;
      while (scope) {
        if (scope.workflow2 && typeof scope.workflow2 === "object") {
          scope.workflow2.workflow = workflowValue;

          if (ngModelCtrl) {
            ngModelCtrl.$setViewValue?.(workflowValue);
            ngModelCtrl.$render?.();
          }

          const formState = scope.workflowSelection?.workflowSelection;
          formState?.$setDirty?.();
          formState?.$setTouched?.();
          formState?.$validate?.();

          scope.$apply?.();
          scope.$applyAsync?.();

          select.dispatchEvent(new Event("change", { bubbles: true }));
          select.dispatchEvent(new Event("input", { bubbles: true }));

          return {
            ok: true,
            workflow: scope.workflow2.workflow,
            email: scope.email || null,
            da: scope.da || scope.searchState?.da || null,
            claveDA: scope.claveDA || scope.searchState?.claveDA || null,
            formValid: formState?.$valid ?? null,
          };
        }

        scope = scope.$parent;
      }

      return { ok: false, reason: "workflow_scope_not_found" };
    }, WORKFLOW_TARGET.value);

    if (changed?.ok) {
      await page.waitForTimeout(1200);
      pushLog("query", "Workflow forzado por Angular scope a gmm.", changed);
      return true;
    }

    pushLog("query", "No pude forzar el workflow con Angular.", changed || {});
  } catch (error) {
    pushLog("query", "No pude forzar el workflow con Angular.", {
      error: serializeError(error),
    });
  }

  return false;
}

async function clickWorkflowOptionByCoordinates(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const options = [
        target.locator('form#workflow-select md-option[value="gmm"]').first(),
        target.locator('md-option[value="gmm"]').first(),
        target.locator('#select_option_64').first(),
      ];

      for (const option of options) {
        const visible = await option.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        const box = await option.boundingBox().catch(() => null);
        if (!box) {
          continue;
        }

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(1200);

        pushLog("query", "Workflow intentado por coordenadas sobre opcion gmm.", {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
        });

        if (await isWorkflowSelected(page)) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

async function clickWorkflowOptionByDom(page) {
  try {
    const clicked = await page.evaluate(() => {
      const option =
        document.querySelector('form#workflow-select md-option[value="gmm"]') ||
        document.querySelector('md-option[value="gmm"]') ||
        document.querySelector("#select_option_64");

      if (!(option instanceof HTMLElement)) {
        return false;
      }

      const target =
        option.querySelector(".md-text") ||
        option.querySelector("div") ||
        option;

      if (!(target instanceof HTMLElement)) {
        return false;
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      for (const eventName of ["mouseenter", "mouseover", "mousedown", "mouseup", "click"]) {
        target.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      }

      option.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      return true;
    });

    if (clicked) {
      await page.waitForTimeout(1200);
      pushLog("query", "Workflow intentado por DOM sobre opcion gmm.");
      if (await isWorkflowSelected(page)) {
        return true;
      }
    }
  } catch (error) {
    pushLog("query", "No pude intentar workflow por DOM.", {
      error: serializeError(error),
    });
  }

  return false;
}

async function closeWorkflowMenuIfOpen(page) {
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  } catch {}

  try {
    await page.evaluate(() => {
      const backdrop =
        document.querySelector(".md-select-backdrop") ||
        document.querySelector(".md-click-catcher");

      if (backdrop instanceof HTMLElement) {
        backdrop.click();
      }
    });
    await page.waitForTimeout(500);
  } catch {}
}

async function findConsultarButton(page, timeout = 0) {
  for (const target of getSearchTargets(page)) {
    try {
      const candidates = [
        target
          .locator('form#workflow-select button[ng-class*="main-btn"][ng-disabled*="workflowSelection.workflowSelection.$valid"]')
          .first(),
        target.locator('form#workflow-select button[ng-class*="main-btn"]').first(),
        target
          .locator('form#workflow-select button[ng-disabled*="workflowSelection.workflowSelection.$valid"]')
          .first(),
        target.locator('form#workflow-select button.main-btn').first(),
        target.locator('form#workflow-select button:has-text("Consultar")').first(),
        target.locator('button.main-btn:has-text("Consultar")').first(),
        target.locator('button:has-text("Consultar")').first(),
      ];

      for (const locator of candidates) {
        const count = await locator.count().catch(() => 0);
        if (!count) {
          continue;
        }

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        return locator;
      }
    } catch {}
  }

  const found = await findVisibleLocator(page, CONSULTA_SELECTORS.consultar, timeout, false);
  return found?.locator || null;
}

async function clickConsultarByCoordinates(page, locator) {
  try {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) {
      return false;
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1000);

    pushLog("query", 'Boton "Consultar" intentado por coordenadas.', {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    });
    return true;
  } catch {
    return false;
  }
}

async function clickConsultarByDom(page) {
  try {
    const clicked = await page.evaluate(() => {
      const button =
        document.querySelector(
          'form#workflow-select button[ng-class*="main-btn"][ng-disabled*="workflowSelection.workflowSelection.$valid"]'
        ) ||
        document.querySelector('form#workflow-select button[ng-class*="main-btn"]') ||
        document.querySelector("form#workflow-select button.main-btn") ||
        Array.from(document.querySelectorAll("button")).find((node) =>
          /consultar/i.test(node.textContent || "")
        );

      if (!(button instanceof HTMLElement)) {
        return false;
      }

      button.scrollIntoView({ block: "center", inline: "center" });
      button.focus();
      for (const eventName of ["mouseenter", "mouseover", "mousedown", "mouseup", "click"]) {
        button.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      }

      return true;
    });

    if (clicked) {
      await page.waitForTimeout(1000);
      pushLog("query", 'Boton "Consultar" intentado por DOM.');
      return true;
    }
  } catch (error) {
    pushLog("query", 'No pude intentar "Consultar" por DOM.', {
      error: serializeError(error),
    });
  }

  return false;
}

async function submitWorkflowFormViaAngular(page) {
  try {
    const target = await getWorkflowTarget(page);
    const result = await target.evaluate((workflowValue) => {
      const form = document.querySelector("form#workflow-select");
      const select =
        document.querySelector('form#workflow-select md-select[ng-model="workflow2.workflow"]') ||
        document.querySelector("form#workflow-select md-select");
      const angularApi = window.angular;

      if (!form || !select || !angularApi?.element) {
        return { ok: false, reason: "angular_unavailable" };
      }

      const scopes = [];
      const seedNodes = [form, select];

      for (const node of seedNodes) {
        const scope =
          angularApi.element(node).isolateScope?.() ||
          angularApi.element(node).scope?.();

        if (scope) {
          scopes.push(scope);
        }
      }

      for (const baseScope of scopes) {
        let cursor = baseScope;

        for (let depth = 0; depth < 8 && cursor; depth += 1) {
          if (cursor.workflow2 && typeof cursor.workflow2 === "object") {
            cursor.workflow2.workflow = workflowValue;
          }

          const formState = cursor.workflowSelection?.workflowSelection;
          if (formState) {
            formState.$setDirty?.();
            formState.$setTouched?.();
            formState.$validate?.();
          }

          if (
            typeof cursor.doActionBuscarByUser === "function" &&
            Object.prototype.hasOwnProperty.call(cursor, "searchState")
          ) {
            try {
              const ngModelCtrl = angularApi.element(select).controller?.("ngModel");
              ngModelCtrl?.$setViewValue?.(workflowValue);
              ngModelCtrl?.$render?.();
              cursor.doActionBuscarByUser(cursor.searchState, cursor.email);
              cursor.$applyAsync?.();
              form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              return {
                ok: true,
                scopeKeys: Object.keys(cursor).slice(0, 20),
                searchState: cursor.searchState ?? null,
                hasEmail: Boolean(cursor.email),
              };
            } catch (error) {
              return {
                ok: false,
                reason: error?.message || String(error),
              };
            }
          }

          cursor = cursor.$parent;
        }
      }

      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return { ok: true, fallback: "submit_event_only" };
    }, WORKFLOW_TARGET.value);

    pushLog("query", "Intento de submit directo del formulario workflow-select.", result);
    if (result?.ok) {
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
      return true;
    }
  } catch (error) {
    pushLog("query", "No pude ejecutar el ng-submit del workflow.", {
      error: serializeError(error),
    });
  }

  return false;
}

async function selectWorkflowOption(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const exactOptions = [
        target.locator('form#workflow-select md-option[value="gmm"]').first(),
        target.locator('form#workflow-select md-option[value="gmm"] .md-text').first(),
        target.locator('md-option[value="gmm"]').first(),
        target.locator('md-option[value="gmm"] .md-text').first(),
        target.locator('#select_option_64').first(),
        target.locator('#select_option_64 .md-text').first(),
      ];

      for (const option of exactOptions) {
        const count = await option.count().catch(() => 0);
        if (!count) {
          continue;
        }

        const visible = await option.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        const text = normalizeText(await option.innerText().catch(() => ""));
        const clicked = await clickLocator(option);
        if (clicked) {
          await page.waitForTimeout(1200);
          pushLog("query", "Workflow seleccionado con selector exacto gmm.", {
            target: describeTarget(target),
            text,
          });
          if (await isWorkflowSelected(page)) {
            return true;
          }
        }
      }
    } catch {}
  }

  const coordinateHit = await clickWorkflowOptionByCoordinates(page);
  if (coordinateHit) {
    return true;
  }

  const domHit = await clickWorkflowOptionByDom(page);
  if (domHit) {
    return true;
  }

  const directHit = await clickFirst(page, WORKFLOW_OPTION_SELECTORS, 2500, false);
  if (directHit) {
    await page.waitForTimeout(1200);
    if (await isWorkflowSelected(page)) {
      return true;
    }
  }

  for (const target of getSearchTargets(page)) {
    try {
      const combo = target.locator('form#workflow-select md-select#select_32, md-select#select_32').first();
      const count = await combo.count().catch(() => 0);
      if (!count) {
        continue;
      }

      const visible = await combo.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      await combo.focus().catch(() => {});
      const listbox = target.locator('#select_listbox_34, [role="listbox"][aria-label*="Workflow" i]').first();
      const listboxVisible = await listbox.isVisible().catch(() => false);

      if (listboxVisible) {
        await listbox.focus().catch(() => {});
        await listbox.press("Home").catch(() => {});
        await listbox.press("Enter").catch(() => {});
      } else {
        await combo.press("Home").catch(() => {});
        await combo.press("Enter").catch(() => {});
      }

      await page.waitForTimeout(1200);

      pushLog("query", "Workflow seleccionado por teclado sobre md-select#select_32.");
      if (await isWorkflowSelected(page)) {
        return true;
      }
    } catch {}
  }

  for (const target of getSearchTargets(page)) {
    try {
      const optionLocators = [
        target.locator("md-option:visible"),
        target.locator("[role='option']:visible"),
        target.locator(".md-select-menu-container md-option"),
        target.locator(".md-select-menu-container [role='option']"),
      ];

      for (const options of optionLocators) {
        const count = await options.count().catch(() => 0);
        if (!count) {
          continue;
        }

        for (let index = 0; index < count; index += 1) {
          const option = options.nth(index);
          const visible = await option.isVisible().catch(() => false);
          if (!visible) {
            continue;
          }

          const text = normalizeText(await option.innerText().catch(() => ""));
          const clicked = await clickLocator(option);
          if (clicked) {
            await page.waitForTimeout(1200);
            pushLog("query", "Workflow seleccionado usando la primera opcion visible.", {
              target: describeTarget(target),
              index,
              text,
            });
            if (await isWorkflowSelected(page)) {
              return true;
            }
          }
        }
      }
    } catch {}
  }

  const wantedLabels = WORKFLOW_LABELS.map((label) => normalizeLoose(label));

  for (const target of getSearchTargets(page)) {
    for (const selector of ["md-option", "[role='option']", ".md-text", ".mat-option-text", "li"]) {
      try {
        const options = target.locator(selector);
        const count = await options.count();

        for (let index = 0; index < count; index += 1) {
          const option = options.nth(index);
          const text = normalizeLoose(await option.innerText().catch(() => ""));
          if (!text) {
            continue;
          }

          if (!wantedLabels.some((label) => text.includes(label))) {
            continue;
          }

          const visible = await option.isVisible().catch(() => false);
          if (!visible) {
            continue;
          }

          const clicked = await clickLocator(option);
          if (clicked) {
            await page.waitForTimeout(1200);
            pushLog("query", "Workflow seleccionado desde opcion visible.", {
              selector,
              target: describeTarget(target),
              text,
            });
            if (await isWorkflowSelected(page)) {
              return true;
            }
          }
        }
      } catch {}
    }
  }

  return setWorkflowViaAngular(page);
}

async function selectWorkflow(page) {
  setState("querying", "Seleccionando workflow...");
  pushLog("query", `Se busca el workflow "${CONFIG.workflowName}".`);

  let lastError = null;

  for (let attempt = 1; attempt <= CONFIG.pageRecoveryAttempts + 1; attempt += 1) {
    assertNotCancelled();
    await dismissBlockingOverlays(page);

    try {
      const ready = await waitForConsultaReady(page, attempt === 1 ? 8000 : 12000);
      if (!ready.ready || ready.health.isBlankLike || ready.health.isConsultaShellStalled) {
        page = await recoverConsultaPage(page, "workflow no disponible");
        runtime.page = page;
      }

      const angularFirst = await setWorkflowViaAngular(page);
      if (angularFirst) {
        await closeWorkflowMenuIfOpen(page);
        const consultReadyDirect = await findConsultarButton(page, 4000);
        if (consultReadyDirect) {
          pushLog("query", "Workflow resuelto por Angular antes de abrir el combo.");
          return page;
        }
      }

      const comboClicked = await openWorkflowCombo(page);
      if (!comboClicked) {
        throw new Error("No pude abrir el selector del workflow.");
      }

      await page.waitForTimeout(800);

      const optionClicked = await selectWorkflowOption(page);
      if (!optionClicked) {
        throw new Error('No pude seleccionar "Gastos Medicos Mayores".');
      }

      await page.waitForTimeout(800);
      await closeWorkflowMenuIfOpen(page);
      await setWorkflowViaAngular(page).catch(() => {});
      await page.waitForTimeout(800);

      const consultReady = await findConsultarButton(page, 6000);
      if (!consultReady) {
        pushLog("query", 'Workflow elegido. "Consultar" no se detecto visualmente; seguire con submit Angular.');
      }

      pushLog("query", "Workflow seleccionado: Gastos Medicos Mayores.");
      return page;
    } catch (error) {
      lastError = error;
      if (attempt > CONFIG.pageRecoveryAttempts) {
        break;
      }
      page = await recoverConsultaPage(page, serializeError(error));
      runtime.page = page;
    }
  }

  throw lastError || new Error("No pude seleccionar el workflow.");
}

function createGetPendientesCapture(context) {
  let settled = false;
  const captured = {
    source: "network",
    capturedAt: null,
    apiJson: null,
    bearerToken: null,
    getPendientesUrl: null,
    responseStatus: null,
    requests: [],
  };

  let resolvePromise;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const finish = (fn) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    context.off("request", onRequest);
    context.off("response", onResponse);
    fn();
  };

  const onRequest = (request) => {
    try {
      const url = request.url();
      if (!url.includes("getPendientes")) {
        return;
      }

      const headers = request.headers();
      const auth = headers.authorization || headers.Authorization || "";

      captured.getPendientesUrl = url;
      captured.bearerToken = auth.replace(/^Bearer\s+/i, "");
      captured.requests.push({
        at: nowIso(),
        method: request.method(),
        url,
      });
    } catch {}
  };

  const onResponse = async (response) => {
    try {
      const url = response.url();
      if (!url.includes("getPendientes")) {
        return;
      }

      captured.getPendientesUrl = url;
      captured.capturedAt = nowIso();
      captured.responseStatus = response.status();
      captured.apiJson = parseJsonResponseText(await response.text(), "getPendientes capturado por red");
      finish(() => resolvePromise(captured));
    } catch (error) {
      finish(() => rejectPromise(error));
    }
  };

  const timer = setTimeout(() => {
    finish(() => rejectPromise(new Error("Timeout esperando la respuesta getPendientes.")));
  }, 45000);

  context.on("request", onRequest);
  context.on("response", onResponse);

  return {
    promise,
    captured,
    cleanup: () => finish(() => {}),
  };
}

async function clickConsultar(page) {
  setState("querying", 'Lanzando la consulta con "Consultar"...');
  pushLog("query", 'Se pulsa el boton "Consultar".');

  page = await ensureConsultaOperational(page, 'antes de pulsar "Consultar"');
  await closeWorkflowMenuIfOpen(page);
  await setWorkflowViaAngular(page).catch(() => {});

  const locator = await findConsultarButton(page, 15000);
  if (!locator) {
    const submittedWithoutButton = await submitWorkflowFormViaAngular(page);
    if (!submittedWithoutButton) {
      throw new Error('No encontre el boton "Consultar" ni pude ejecutar el formulario.');
    }
    return;
  }

  const buttonInfo = {
    text: normalizeText(await locator.innerText().catch(() => "")),
    disabledAttr: await locator.getAttribute("disabled").catch(() => null),
    className: await locator.getAttribute("class").catch(() => null),
    ariaDisabled: await locator.getAttribute("aria-disabled").catch(() => null),
  };
  pushLog("query", 'Boton "Consultar" detectado.', buttonInfo);

  let clicked = await clickLocator(locator);
  if (!clicked) {
    clicked = await clickConsultarByCoordinates(page, locator);
  }
  if (!clicked) {
    clicked = await clickConsultarByDom(page);
  }
  if (!clicked) {
    clicked = await submitWorkflowFormViaAngular(page);
  }
  if (!clicked) {
    throw new Error('Encontre "Consultar", pero no pude disparar la consulta.');
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

async function clickBuscarIfVisible(page) {
  page = await ensureConsultaOperational(page, 'antes de pulsar "Buscar"');
  const clicked = await clickFirst(page, CONSULTA_SELECTORS.buscar, 4000, true);
  if (clicked) {
    pushLog("query", 'Se pulso el boton "Buscar" como apoyo para disparar la consulta.');
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  return clicked;
}

async function setConsultaDateRange(page, range = getDefaultDateRange()) {
  page = await ensureConsultaOperational(page, "antes de ajustar fechas");

  for (const target of getSearchTargets(page)) {
    try {
      const result = await target.evaluate(({ start, end }) => {
        const isVisible = (node) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }

          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };

        const scoreDateInput = (input) => {
          const text = [
            input.value,
            input.placeholder,
            input.name,
            input.id,
            input.getAttribute("aria-label"),
            input.getAttribute("ng-model"),
            input.closest("md-input-container")?.innerText,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (/fecha\s+inicial|fechainicial|fecha_inicio|fecha inicial/.test(text)) {
            return 3;
          }
          if (/fecha\s+final|fechafinal|fecha_fin|fecha final/.test(text)) {
            return 2;
          }
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test((input.value || "").trim())) {
            return 1;
          }
          return 0;
        };

        const inputs = Array.from(document.querySelectorAll("input"))
          .filter((input) => isVisible(input) && input.type !== "hidden")
          .map((input, index) => ({ input, index, score: scoreDateInput(input) }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index);

        const initial =
          inputs.find((candidate) => /fecha\s+inicial|fechainicial|fecha_inicio/.test(
            [
              candidate.input.placeholder,
              candidate.input.name,
              candidate.input.id,
              candidate.input.getAttribute("aria-label"),
              candidate.input.getAttribute("ng-model"),
              candidate.input.closest("md-input-container")?.innerText,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
          )) || inputs[0];
        const final =
          inputs.find((candidate) => candidate !== initial && /fecha\s+final|fechafinal|fecha_fin/.test(
            [
              candidate.input.placeholder,
              candidate.input.name,
              candidate.input.id,
              candidate.input.getAttribute("aria-label"),
              candidate.input.getAttribute("ng-model"),
              candidate.input.closest("md-input-container")?.innerText,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
          )) || inputs.find((candidate) => candidate !== initial);

        const setValue = (candidate, value) => {
          if (!candidate?.input) {
            return false;
          }

          const input = candidate.input;
          const previous = input.value;
          const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
          descriptor?.set?.call(input, value);
          input.value = value;
          input.focus();
          for (const eventName of ["input", "change", "keyup", "blur"]) {
            input.dispatchEvent(new Event(eventName, { bubbles: true, cancelable: true }));
          }

          try {
            const angularApi = window.angular;
            const ngModel = angularApi?.element(input).controller?.("ngModel");
            if (ngModel) {
              ngModel.$setViewValue?.(value);
              ngModel.$render?.();
              const scope = angularApi.element(input).scope?.() || angularApi.element(input).isolateScope?.();
              scope?.$applyAsync?.();
            }
          } catch {}

          return previous !== value;
        };

        const changedStart = setValue(initial, start);
        const changedEnd = setValue(final, end);

        return {
          ok: Boolean(initial || final),
          changed: changedStart || changedEnd,
          count: inputs.length,
          startValue: initial?.input?.value || "",
          endValue: final?.input?.value || "",
        };
      }, { start: range.displayStart, end: range.displayEnd });

      if (result?.ok) {
        await page.waitForTimeout(700);
        pushLog("query", "Rango de fechas configurado en la vista de GNP.", {
          start: range.displayStart,
          end: range.displayEnd,
          changed: result.changed,
          inputs: result.count,
          target: describeTarget(target),
        });
        return true;
      }
    } catch {}
  }

  pushLog("query", "No pude confirmar los campos visibles de fecha en GNP.", {
    start: range.displayStart,
    end: range.displayEnd,
  });
  return false;
}

function mapScrapedRow(headers, values) {
  const row = {};
  headers.forEach((header, index) => {
    row[header] = values[index] || "";
  });

  return {
    ot: row.ot || row["orden de trabajo"] || row["orden trabajo"] || "",
    usuarioCreador: row["usuario creador"] || row.usuario || "",
    estatus: row.estatus || "",
    fechaCompromiso: row["fecha compromiso"] || "",
    poliza: row.poliza || "",
    agente: row.agente || "",
    contratante: row.contratante || "",
    tipoSolicitud: row["tipo de solicitud"] || "",
    producto: row.producto || "",
    guia: row["no. de guia"] || row["no de guia"] || "",
    fechaRegistro: row["fecha registro"] || "",
    primerIngreso: row["primer ingreso"] || "",
    ultimoIngreso: row["ultimo ingreso"] || "",
    medioApertura: row["medio apertura"] || "",
    rol: row.rol || "",
    raw: row,
  };
}

async function scrapeTableRows(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const headerLocator = target.locator("table thead th");
      const rowLocator = target.locator("table tbody tr");

      const headerCount = await headerLocator.count();
      const rowCount = await rowLocator.count();

      if (!headerCount || !rowCount) {
        continue;
      }

      const headers = (await headerLocator.allInnerTexts()).map((text) =>
        normalizeText(text).toLowerCase()
      );

      if (!headers.some((header) => header.includes("ot"))) {
        continue;
      }

      const rows = [];
      for (let index = 0; index < Math.min(rowCount, 200); index += 1) {
        const cellTexts = await rowLocator
          .nth(index)
          .locator("td")
          .allInnerTexts()
          .catch(() => []);

        const values = cellTexts.map((text) => normalizeText(text));
        if (!values.length) {
          continue;
        }

        const mapped = mapScrapedRow(headers, values);
        if (makeKey(mapped)) {
          rows.push(mapped);
        }
      }

      if (rows.length > 0) {
        pushLog("capture", "Se obtuvieron datos por scraping visible de la tabla.", {
          rows: rows.length,
          target: describeTarget(target),
        });
        return rows;
      }
    } catch {}
  }

  return [];
}

function inferDirectQueryParams(scopeInfo = {}) {
  const currentRows = readJsonSafe(CONFIG.currentFile, []);
  const rawResponse = readJsonSafe(CONFIG.rawFile, {});
  const firstKnownRow =
    (Array.isArray(currentRows) && currentRows[0]) ||
    (Array.isArray(rawResponse?.ordenes) && rawResponse.ordenes[0]) ||
    null;

  const dateRange = getDefaultDateRange();
  const savedUrl = normalizeText(runtime.sessionInfo?.getPendientesUrl || "");
  let savedParams = null;

  if (savedUrl) {
    try {
      savedParams = Object.fromEntries(new URL(savedUrl).searchParams.entries());
    } catch {}
  }

  const codigo = normalizeText(
    scopeInfo.codigo ||
      scopeInfo.cve_agente ||
      scopeInfo.agentCode ||
      savedParams?.codigo ||
      firstKnownRow?.agente ||
      firstKnownRow?.cve_agente
  );

  const da = normalizeText(
    scopeInfo.da ||
      scopeInfo.claveDA ||
      scopeInfo.searchState?.da ||
      savedParams?.da ||
      firstKnownRow?.da
  );

  const claveDA = normalizeText(
    scopeInfo.claveDA ||
      scopeInfo.searchState?.claveDA ||
      savedParams?.claveDA ||
      da
  );

  const usuario = normalizeText(
    scopeInfo.email ||
      scopeInfo.usuario ||
      scopeInfo.searchState?.email ||
      savedParams?.usuario ||
      CONFIG.email
  ).toLowerCase();

  return {
    tipo: "consulta",
    num_pag: String(savedParams?.num_pag || 1),
    registrosPorPagina: String(savedParams?.registrosPorPagina || DIRECT_QUERY_LIMIT),
    usuario,
    primerCarga: String(savedParams?.primerCarga || true),
    fechainicial: normalizeText(dateRange.start),
    fechafinal: normalizeText(dateRange.end),
    claveDA,
    da,
    codigo,
  };
}

function inferDirectQueryParamsFromIframe(iframeInfo = {}, scopeInfo = {}) {
  const fallback = inferDirectQueryParams(scopeInfo);
  const iframeDaList = tryParseJsonArray(iframeInfo.da);
  const iframeDa = normalizeText(iframeDaList[0] || iframeInfo.da || "");
  const iframeEmail = normalizeText(iframeInfo.email || "").toLowerCase();
  const iframeCodigo = normalizeText(iframeInfo.codIntermediario || iframeInfo.codigo || "");

  return {
    ...fallback,
    usuario: iframeEmail || fallback.usuario,
    claveDA: iframeDa || fallback.claveDA,
    da: iframeDa || fallback.da,
    codigo: iframeCodigo || fallback.codigo,
  };
}

function buildGetPendientesUrl(params) {
  const url = new URL("https://wf-da-services.gnp.com.mx/consultaendpoints/gmm/v1/getPendientes");
  for (const [key, value] of Object.entries(params)) {
    if (normalizeText(value)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readAngularQueryContext(page) {
  try {
    const info = await page.evaluate(() => {
      const angularApi = window.angular;
      const form = document.querySelector("form#workflow-select");
      const select = document.querySelector("form#workflow-select md-select#select_32");

      if (!angularApi?.element) {
        return null;
      }

      const scopes = [];
      for (const node of [form, select, document.body]) {
        if (!node) {
          continue;
        }

        const scope =
          angularApi.element(node).isolateScope?.() ||
          angularApi.element(node).scope?.();

        if (scope) {
          scopes.push(scope);
        }
      }

      const result = {};

      for (const baseScope of scopes) {
        let cursor = baseScope;

        for (let depth = 0; depth < 10 && cursor; depth += 1) {
          if (!result.email && cursor.email) {
            result.email = cursor.email;
          }

          if (!result.searchState && cursor.searchState) {
            result.searchState = JSON.parse(JSON.stringify(cursor.searchState));
          }

          if (!result.workflow2 && cursor.workflow2) {
            result.workflow2 = JSON.parse(JSON.stringify(cursor.workflow2));
          }

          if (!result.codigo && (cursor.codigo || cursor.cve_agente)) {
            result.codigo = cursor.codigo || cursor.cve_agente;
          }

          if (!result.da && cursor.da) {
            result.da = cursor.da;
          }

          if (!result.claveDA && cursor.claveDA) {
            result.claveDA = cursor.claveDA;
          }

          cursor = cursor.$parent;
        }
      }

      try {
        const ls = {};
        for (const key of Object.keys(window.localStorage || {})) {
          const value = window.localStorage.getItem(key);
          if (typeof value === "string" && /codigo|agente|email|usuario|da|token/i.test(key)) {
            ls[key] = value;
          }
        }
        result.localStorage = ls;
      } catch {}

      return result;
    });

    if (info) {
      pushLog("query", "Contexto Angular detectado para consulta directa.", {
        hasSearchState: Boolean(info.searchState),
        hasEmail: Boolean(info.email),
        hasCodigo: Boolean(info.codigo),
        hasDa: Boolean(info.da || info.claveDA || info.searchState?.da || info.searchState?.claveDA),
      });
    }

    return info || {};
  } catch (error) {
    pushLog("query", "No pude leer el contexto Angular de la consulta.", {
      error: serializeError(error),
    });
    return {};
  }
}

async function readConsultaIframeInfo(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const targetUrl = typeof target.url === "function" ? target.url() : "";
      if (!/wf-consultasdas\.gnp\.com\.mx|wf-da-busqueda\.gnp\.com\.mx/i.test(targetUrl)) {
        continue;
      }

      const url = new URL(targetUrl);
      const info = {
        src: url.toString(),
        origin: url.origin,
        pathname: url.pathname,
        ...Object.fromEntries(url.searchParams.entries()),
      };

      pushLog("query", "App de consulta detectada en frame.", {
        src: info.src,
        email: info.email || null,
        da: info.da || null,
        codIntermediario: info.codIntermediario || null,
      });

      return info;
    } catch {}
  }

  try {
    const info = await page.evaluate(() => {
      const iframe =
        document.querySelector("#wfdaiframe") ||
        document.querySelector('iframe[src*="wf-consultasdas.gnp.com.mx"]');

      const src =
        iframe instanceof HTMLIFrameElement
          ? iframe.getAttribute("src") || iframe.src || ""
          : "";

      if (!src) {
        return null;
      }

      const url = new URL(src);
      const entries = Object.fromEntries(url.searchParams.entries());
      return {
        src: url.toString(),
        origin: url.origin,
        pathname: url.pathname,
        ...entries,
      };
    });

    if (info?.src) {
      pushLog("query", "Iframe de consulta detectado.", {
        src: info.src,
        email: info.email || null,
        da: info.da || null,
        codIntermediario: info.codIntermediario || null,
      });
      return info;
    }
  } catch {}

  try {
    const html = await page.content();
    const match = html.match(/<iframe[^>]+id=["']wfdaiframe["'][^>]+src=["']([^"']+)["']/i);
    if (!match?.[1]) {
      return null;
    }

    const url = new URL(match[1]);
    const info = {
      src: url.toString(),
      origin: url.origin,
      pathname: url.pathname,
      ...Object.fromEntries(url.searchParams.entries()),
    };

    pushLog("query", "Iframe de consulta detectado por HTML.", {
      src: info.src,
      email: info.email || null,
      da: info.da || null,
      codIntermediario: info.codIntermediario || null,
    });

    return info;
  } catch (error) {
    pushLog("query", "No pude leer el iframe de consulta.", {
      error: serializeError(error),
    });
    return null;
  }
}

async function openConsultaIframeApp(page, iframeInfo) {
  if (!iframeInfo?.src) {
    return false;
  }

  pushLog("query", "Se usara el frame interno ya cargado para la consulta directa.", {
    src: iframeInfo.src,
  });
  return true;
}

async function waitForConsultaIframeInfo(page, timeout = 15000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const info = await readConsultaIframeInfo(page);
    if (info?.src) {
      return info;
    }

    await page.waitForTimeout(500);
  }

  return null;
}

function getConsultaAppTarget(page) {
  for (const target of getSearchTargets(page)) {
    try {
      const targetUrl = typeof target.url === "function" ? target.url() : "";
      if (/wf-consultasdas\.gnp\.com\.mx|wf-da-busqueda\.gnp\.com\.mx/i.test(targetUrl)) {
        return target;
      }
    } catch {}
  }

  return page;
}

async function waitForConsultaAppTarget(page, timeout = 12000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const target = getConsultaAppTarget(page);
    const targetUrl = typeof target.url === "function" ? target.url() : "";

    if (/wf-consultasdas\.gnp\.com\.mx|wf-da-busqueda\.gnp\.com\.mx/i.test(targetUrl)) {
      return target;
    }

    await page.waitForTimeout(500);
  }

  return page;
}

async function requestGetPendientesWithContext(context, url) {
  try {
    const response = await context.request.get(url, {
      headers: {
        Origin: "https://wf-da-busqueda.gnp.com.mx",
        Referer: "https://wf-da-busqueda.gnp.com.mx/",
      },
    });

    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} ${response.statusText()}`.trim());
    }

    return {
      ok: true,
      status: response.status(),
      text,
    };
  } catch (error) {
    pushLog("query", "Fallo el request directo con Playwright context.", {
      error: serializeError(error),
      url,
    });
    return null;
  }
}

async function requestGetPendientesFromAppTarget(appTarget, context, url, page) {
  let response = null;

  try {
    response = await appTarget.evaluate(async (requestUrl) => {
      const tokenCandidates = [];

      try {
        for (const key of Object.keys(window.localStorage || {})) {
          const value = window.localStorage.getItem(key);
          if (typeof value === "string" && /eyJ[A-Za-z0-9_-]+\./.test(value)) {
            tokenCandidates.push(value);
          }
        }
      } catch {}

      const headers = {};
      if (tokenCandidates[0]) {
        headers.Authorization = `Bearer ${tokenCandidates[0]}`;
      }

      const response = await fetch(requestUrl, {
        method: "GET",
        credentials: "include",
        headers,
      });

      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
        tokenPreview: tokenCandidates[0] ? `${tokenCandidates[0].slice(0, 20)}...` : null,
      };
    }, url);
  } catch (error) {
    pushLog("query", "El fetch del navegador fallo; probare con Playwright request context.", {
      error: serializeError(error),
      targetUrl: typeof appTarget.url === "function" ? appTarget.url() : page.url(),
    });
  }

  if (!response?.ok) {
    const contextResponse = await requestGetPendientesWithContext(context, url);
    if (contextResponse?.ok) {
      response = {
        ok: true,
        status: contextResponse.status,
        statusText: "",
        text: contextResponse.text,
        tokenPreview: null,
      };
    }
  }

  if (!response?.ok) {
    throw new Error(`HTTP ${response?.status || "?"} ${response?.statusText || ""}`.trim());
  }

  return response;
}

async function fetchGetPendientesDirect(page, context) {
  await page.waitForTimeout(3000);
  const iframeInfo = await waitForConsultaIframeInfo(page, 15000);
  await openConsultaIframeApp(page, iframeInfo);

  const appTarget = await waitForConsultaAppTarget(page, 12000);
  await setConsultaDateRange(page).catch((error) => {
    pushLog("query", "No pude ajustar el rango visible de fechas antes de la consulta directa.", {
      error: serializeError(error),
    });
  });
  const scopeInfo = await readAngularQueryContext(page);
  const params = inferDirectQueryParamsFromIframe(iframeInfo || {}, scopeInfo);

  if (!params.usuario || !params.codigo || !(params.claveDA || params.da)) {
    pushLog("query", "Faltan parametros para la consulta directa.", {
      usuario: Boolean(params.usuario),
      codigo: Boolean(params.codigo),
      claveDA: Boolean(params.claveDA),
      da: Boolean(params.da),
    });
    return null;
  }

  const url = buildGetPendientesUrl(params);
  pushLog("query", "Intentando getPendientes directo.", {
    url,
    fechainicial: params.fechainicial,
    fechafinal: params.fechafinal,
    pageUrl: typeof appTarget.url === "function" ? appTarget.url() : page.url(),
  });

  try {
    const pages = [];
    const requests = [];
    const allItems = [];
    let tokenPreview = null;
    let responseStatus = null;
    const limit = Number(params.registrosPorPagina || DIRECT_QUERY_LIMIT);

    for (let pageNumber = Number(params.num_pag || 1); pageNumber <= CONFIG.directQueryMaxPages; pageNumber += 1) {
      assertNotCancelled();
      const pageParams = { ...params, num_pag: String(pageNumber) };
      const pageUrl = buildGetPendientesUrl(pageParams);
      const response = await requestGetPendientesFromAppTarget(appTarget, context, pageUrl, page);
      const apiJson = parseJsonResponseText(response.text, `getPendientes directo pagina ${pageNumber}`);
      const items = extractItems(apiJson);

      pages.push({
        page: pageNumber,
        url: pageUrl,
        status: response.status,
        body: apiJson,
        itemCount: items.length,
      });
      requests.push({
        at: nowIso(),
        method: "GET",
        url: pageUrl,
        direct: true,
      });
      allItems.push(...items);
      tokenPreview = response.tokenPreview || tokenPreview;
      responseStatus = response.status;

      if (items.length < limit) {
        break;
      }
    }

    saveSessionInfo({
      getPendientesUrl: url,
      bearerTokenPreview: tokenPreview || runtime.sessionInfo?.bearerTokenPreview || null,
    });

    return {
      rows: allItems.map(mapItem).filter((row) => makeKey(row)),
      raw: pages.length === 1 ? pages[0].body : { source: "direct-api", pages },
      requests,
      debug: {
        source: "direct-api",
        capturedAt: nowIso(),
        getPendientesUrl: url,
        pagesFetched: pages.length,
        bearerTokenPreview: tokenPreview || null,
        responseStatus,
        finalUrl: page.url(),
      },
    };
  } catch (error) {
    pushLog("query", "Fallo la consulta directa a getPendientes.", {
      error: serializeError(error),
      url,
    });
    return null;
  }
}

function persistRunData(result, currentRows, diff) {
  const previousRows = readJsonSafe(CONFIG.currentFile, readJsonSafe(CONFIG.previousFile, []));

  writeJson(CONFIG.previousFile, previousRows);
  writeJson(CONFIG.currentFile, currentRows);
  writeJson(CONFIG.diffFile, diff);
  writeJson(CONFIG.rawFile, result.raw);
  writeJson(CONFIG.extractedFile, currentRows);
  writeJson(CONFIG.debugCapturedFile, result.debug);
  writeJson(CONFIG.debugRequestsFile, result.requests || []);
  const comparison = buildBitacoraComparison(readBitacora(), currentRows);
  const snapshotId = saveMonitorSnapshot(result, currentRows, diff);
  saveComparisonHistory(comparison, snapshotId);
  writeBitacoraExcel(comparison);
}

async function waitForCapturedRows(capture, page, timeout = 12000) {
  const captured = await Promise.race([
    capture.promise,
    page.waitForTimeout(timeout).then(() => null),
  ]);

  if (!captured) {
    return null;
  }

  const items = extractItems(captured.apiJson);
  const rows = items.map(mapItem).filter((row) => makeKey(row));

  if (!rows.length) {
    return null;
  }

  return {
    rows,
    raw: captured.apiJson,
    requests: captured.requests,
    debug: {
      source: "network",
      capturedAt: captured.capturedAt,
      getPendientesUrl: captured.getPendientesUrl,
      bearerTokenPreview: previewToken(captured.bearerToken),
      responseStatus: captured.responseStatus,
      finalUrl: page.url(),
    },
  };
}

async function fetchCurrentRows(page, context) {
  page = await ensureConsultaOperational(page, "preparando captura de consulta");
  context = runtime.browserContext || context;
  let capture = createGetPendientesCapture(context);
  let normalQueryResult = null;

  try {
    // Primera consulta inicial: normalmente GNP trae un rango amplio.
    // Se conserva para rescatar OTs no terminadas que queden fuera del mes actual.
    await clickConsultar(page);
    page = runtime.page || page;
    context = runtime.browserContext || context;
    
    try {
      const result = await waitForCapturedRows(capture, page, 12000);
      if (result) {
        normalQueryResult = result;
        pushLog("query", "Primera consulta completada; revisare pendientes abiertos fuera del mes actual.", {
          total: result.rows.length,
        });
      }
    } catch (error) {
      pushLog("capture", "Primera consulta sin resultados, continuando con ajuste de fecha.", {
        error: serializeError(error),
      });
    }

    if (!normalQueryResult) {
      const scrapedNormalRows = await scrapeTableRows(page).catch(() => []);
      if (scrapedNormalRows.length) {
        normalQueryResult = {
          rows: scrapedNormalRows,
          raw: {
            source: "scraping-initial",
            capturedAt: nowIso(),
            rows: scrapedNormalRows,
          },
          requests: capture.captured.requests || [],
          debug: {
            source: "scraping-initial",
            capturedAt: nowIso(),
            getPendientesUrl: capture.captured.getPendientesUrl,
            responseStatus: capture.captured.responseStatus,
            finalUrl: page.url(),
          },
        };
        pushLog("query", "Primera consulta recuperada por scraping visible antes de ajustar fechas.", {
          total: scrapedNormalRows.length,
        });
      }
    }

    // Ajustar fechas al mes actual y realizar segunda consulta.
    const currentMonthRange = getCurrentMonthDateRange();
    const datesReady = await setConsultaDateRange(page, currentMonthRange).catch((error) => {
      pushLog("query", "No pude ajustar el rango visible de fechas antes de buscar.", {
        error: serializeError(error),
      });
      return false;
    });
    page = runtime.page || page;
    context = runtime.browserContext || context;

    if (datesReady) {
      capture.cleanup();
      capture = createGetPendientesCapture(context);

      const searchedWithDates = await clickBuscarIfVisible(page);
      page = runtime.page || page;
      context = runtime.browserContext || context;
      if (searchedWithDates) {
        const result = await waitForCapturedRows(capture, page, 15000);
        if (result) {
          const rows = mergeCurrentMonthWithOpenOlderRows(result.rows, normalQueryResult?.rows || []);
          const extraOpenRows = rows.length - result.rows.length;
          pushLog("query", "Consulta del mes actual completada.", {
            start: currentMonthRange.displayStart,
            end: currentMonthRange.displayEnd,
            totalMesActual: result.rows.length,
            pendientesAbiertosPrevios: Math.max(extraOpenRows, 0),
            totalMostrado: rows.length,
          });

          return {
            ...result,
            rows,
            debug: {
              ...result.debug,
              normalQueryRows: normalQueryResult?.rows?.length || 0,
              currentMonthRows: result.rows.length,
              extraOpenRows: Math.max(extraOpenRows, 0),
              effectiveRows: rows.length,
            },
          };
        }
      }

      capture.cleanup();
      capture = createGetPendientesCapture(context);
    }

    try {
      const result = await waitForCapturedRows(capture, page, 12000);
      if (result) {
        const rows = mergeCurrentMonthWithOpenOlderRows(result.rows, normalQueryResult?.rows || []);
        const extraOpenRows = rows.length - result.rows.length;

        return {
          ...result,
          rows,
          debug: {
            ...result.debug,
            normalQueryRows: normalQueryResult?.rows?.length || 0,
            currentMonthRows: result.rows.length,
            extraOpenRows: Math.max(extraOpenRows, 0),
            effectiveRows: rows.length,
          },
        };
      }

      capture.cleanup();
      capture = createGetPendientesCapture(context);
      await clickBuscarIfVisible(page);
      page = runtime.page || page;
      context = runtime.browserContext || context;
      const resultAfterBuscar = await waitForCapturedRows(capture, page, 15000);
      if (resultAfterBuscar) {
        const rows = mergeCurrentMonthWithOpenOlderRows(resultAfterBuscar.rows, normalQueryResult?.rows || []);
        const extraOpenRows = rows.length - resultAfterBuscar.rows.length;

        return {
          ...resultAfterBuscar,
          rows,
          debug: {
            ...resultAfterBuscar.debug,
            normalQueryRows: normalQueryResult?.rows?.length || 0,
            currentMonthRows: resultAfterBuscar.rows.length,
            extraOpenRows: Math.max(extraOpenRows, 0),
            effectiveRows: rows.length,
          },
        };
      }

      throw new Error("No se recibieron filas desde getPendientes.");
    } catch (error) {
      pushLog("capture", "No pude capturar getPendientes por red. Intentare scraping visible.", {
        error: serializeError(error),
      });

      const scrapedRows = await scrapeTableRows(page);
      if (!scrapedRows.length) {
        throw error;
      }

      return {
        rows: mergeCurrentMonthWithOpenOlderRows(scrapedRows, normalQueryResult?.rows || []),
        raw: {
          source: "scraping",
          capturedAt: nowIso(),
          rows: scrapedRows,
        },
        requests: capture.captured.requests,
        debug: {
          source: "scraping",
          capturedAt: nowIso(),
          getPendientesUrl: capture.captured.getPendientesUrl,
          bearerTokenPreview: previewToken(capture.captured.bearerToken),
          responseStatus: capture.captured.responseStatus,
          finalUrl: page.url(),
        },
      };
    }
  } finally {
    capture.cleanup();
  }
}

async function fetchCurrentRowsWithRecovery(page, context) {
  let lastError = null;
  let currentPage = page;
  let currentContext = context;

  for (let attempt = 1; attempt <= CONFIG.queryRecoveryAttempts; attempt += 1) {
    assertNotCancelled();

    try {
      currentPage = await ensureConsultaOperational(
        currentPage,
        attempt === 1 ? "antes de consultar pendientes" : "reintento de consulta"
      );
      runtime.page = currentPage;
      currentContext = runtime.browserContext || currentContext;

      if (attempt > 1) {
        currentPage = await selectWorkflow(currentPage);
        runtime.page = currentPage;
        currentContext = runtime.browserContext || currentContext;
      }

      const result = await fetchCurrentRows(currentPage, currentContext);
      if (result?.rows?.length) {
        if (attempt > 1) {
          pushLog("recovery", "Consulta recuperada despues de reintento.", {
            attempt,
            total: result.rows.length,
          });
        }

        return {
          page: currentPage,
          context: currentContext,
          result,
        };
      }

      throw new Error("La consulta termino sin filas validas.");
    } catch (error) {
      lastError = error;
      pushLog("recovery", "Fallo el intento de consulta visual.", {
        attempt,
        maxAttempts: CONFIG.queryRecoveryAttempts,
        error: serializeError(error),
      });

      if (currentPage && !currentPage.isClosed()) {
        await screenshot(currentPage, `query-attempt-${attempt}`).catch(() => {});
      }

      if (attempt >= CONFIG.queryRecoveryAttempts) {
        break;
      }

      currentPage = await recoverConsultaPage(currentPage, serializeError(error));
      runtime.page = currentPage;
      currentContext = runtime.browserContext || currentContext;
    }
  }

  throw lastError || new Error("La consulta visual fallo despues de reintentos.");
}

async function runMonitor(trigger = "manual") {
  if (runtime.busy) {
    return false;
  }

  if (runtime.scheduler.timer) {
    clearTimeout(runtime.scheduler.timer);
    runtime.scheduler.timer = null;
  }

  runtime.busy = true;
  runtime.error = null;
  runtime.cancelRequested = false;
  runtime.activeRun = {
    id: Date.now(),
    trigger,
    startedAt: nowIso(),
  };
  resetManualLoginState();
  setState("booting", "Preparando navegador y flujo de consulta...");
  pushLog("run", `Inicio de ejecucion (${trigger}).`);
  cleanupOldScreenshots();

  const runTimeout = setTimeout(() => {
    const message = `La consulta supero ${CONFIG.runTimeoutMinutes} minutos; se reiniciara el navegador.`;
    runtime.cancelRequested = true;
    runtime.error = message;
    setState("error", message);
    pushLog("timeout", message);
    void closeBrowserContext("timeout total de consulta");
  }, CONFIG.runTimeoutMinutes * 60 * 1000);

  try {
    let context = await getContext();
    assertNotCancelled();
    let page = await getActivePage();

    page = await ensureLoggedIn(page);
    assertNotCancelled();
    runtime.page = page;

    page = await gotoConsulta(page);
    runtime.page = page;
    context = runtime.browserContext || context;
    assertNotCancelled();
    let result = null;

    if (CONFIG.useDirectApi) {
      result = await fetchGetPendientesDirect(page, context);
      assertNotCancelled();
    }

    if (!result || !result.rows.length) {
      pushLog(
        "query",
        CONFIG.useDirectApi
          ? "La consulta directa no alcanzo datos. Entro al flujo visual como respaldo."
          : "Consulta directa omitida. Entro al flujo visual optimizado."
      );
      page = await selectWorkflow(page);
      runtime.page = page;
      context = runtime.browserContext || context;
      assertNotCancelled();
      const recovered = await fetchCurrentRowsWithRecovery(page, context);
      page = recovered.page;
      context = recovered.context;
      runtime.page = page;
      result = recovered.result;
    }

    assertNotCancelled();
    const previousRows = readJsonSafe(CONFIG.currentFile, readJsonSafe(CONFIG.previousFile, []));
    const currentRows = result.rows;
    const diff = compareRows(previousRows, currentRows);

    persistRunData(result, currentRows, diff);

    runtime.data = currentRows;
    runtime.diff = diff;
    runtime.lastUpdate = diff.timestamp;
    runtime.dataVersion = diff.timestamp;
    saveSessionInfo({
      alive: true,
      lastCheckedAt: nowIso(),
      lastUrl: page.url(),
      note: `Consulta completada por ${result.debug.source}.`,
    });

    setState("done", "Consulta completada. La tabla ya fue actualizada.");
    pushLog("run", "Consulta completada.", {
      source: result.debug.source,
      totalActual: diff.summary.totalActual,
      nuevos: diff.summary.nuevos,
      cambiados: diff.summary.cambiados,
      eliminados: diff.summary.eliminados,
    });
    runtime.lastSuccessfulRunAt = nowIso();

    return true;
  } catch (error) {
    runtime.error = serializeError(error);
    setState("error", runtime.error);
    pushLog("error", runtime.error);
    runtime.lastFailedRunAt = nowIso();

    try {
      if (runtime.page && !runtime.page.isClosed()) {
        await screenshot(runtime.page, "error");
      }
    } catch {}

    return false;
  } finally {
    resetManualLoginState();
    clearTimeout(runTimeout);
    runtime.busy = false;
    runtime.cancelRequested = false;
    runtime.activeRun = null;
    runtime.lastRunEndedAt = nowIso();
    scheduleNextAutoRefresh();
  }
}

async function cancelRun() {
  if (!runtime.busy) {
    return { ok: false, message: "No hay una ejecucion en curso." };
  }

  const error = new Error("Ejecucion cancelada por el usuario.");
  runtime.cancelRequested = true;
  runtime.error = error.message;
  setState("error", error.message);
  pushLog("cancel", error.message);

  const deferred = runtime.manualLoginDeferred;
  if (deferred) {
    clearManualWatcher();
    runtime.manualLoginDeferred = null;
    deferred.reject(error);
  }

  await closeBrowserContext("ejecucion cancelada");

  return { ok: true, message: error.message };
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function buildStatusPayload(includeData) {
  const summary =
    runtime.diff && runtime.diff.summary
      ? runtime.diff.summary
      : createEmptyDiff(runtime.data.length).summary;
  const dateRange = getDefaultDateRange();
  const bitacora = buildBitacoraComparison(readBitacora(), runtime.data);

  return {
    busy: runtime.busy,
    mode: runtime.mode,
    message: runtime.message,
    error: runtime.error,
    lastUpdate: runtime.lastUpdate,
    dataVersion: runtime.dataVersion,
    summary,
    data: includeData ? runtime.data : null,
    diff: includeData ? runtime.diff : null,
    bitacora,
    executionLog: runtime.executionLog,
    sessionInfo: publicSessionInfo(runtime.sessionInfo),
    manualLogin: runtime.manualLogin,
    activeRun: runtime.activeRun,
    scheduler: publicSchedulerInfo(runtime.scheduler),
    auth: {
      postTokenRequired: Boolean(CONFIG.monitorToken),
    },
    query: {
      dateFrom: dateRange.displayStart,
      dateTo: dateRange.displayEnd,
      paramDateFrom: dateRange.start,
      paramDateTo: dateRange.end,
    },
    serverTime: nowIso(),
    tv: {
      rowsPerPage: CONFIG.tvRowsPerPage,
      pageSeconds: CONFIG.tvPageSeconds,
      hideTerminadas: CONFIG.tvHideTerminadas,
      staleMinutes: CONFIG.tvStaleMinutes,
      soundEnabled: CONFIG.tvSoundEnabled,
      statusPollSeconds: CONFIG.tvStatusPollSeconds,
      autoScroll: CONFIG.tvAutoScroll,
      scrollPixels: CONFIG.tvScrollPixels,
      scrollIntervalMs: CONFIG.tvScrollIntervalMs,
    },
  };
}

function buildHealthPayload() {
  const context = runtime.browserContext;
  const page = runtime.page;
  const pageOpen = Boolean(page && !page.isClosed());
  const pages = context ? context.pages().filter((item) => !item.isClosed()) : [];

  return {
    ok: !runtime.error && runtime.mode !== "error",
    busy: runtime.busy,
    mode: runtime.mode,
    message: runtime.message,
    error: runtime.error,
    serverTime: nowIso(),
    lastUpdate: runtime.lastUpdate,
    lastRunEndedAt: runtime.lastRunEndedAt,
    lastSuccessfulRunAt: runtime.lastSuccessfulRunAt,
    lastFailedRunAt: runtime.lastFailedRunAt,
    browser: {
      contextOpen: Boolean(context),
      pageOpen,
      pages: pages.length,
      currentUrl: pageOpen ? sanitizeUrlForClient(page.url()) : null,
    },
    scheduler: publicSchedulerInfo(runtime.scheduler),
    auth: {
      postTokenRequired: Boolean(CONFIG.monitorToken),
    },
    warnings: runtime.validationWarnings,
  };
}

app.get("/api/status", requireMonitorToken, (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : "";
  const forceFull = req.query.full === "1" || req.query.full === "true";
  const includeData = forceFull || !since || since !== runtime.dataVersion;
  res.json(buildStatusPayload(includeData));
});

app.get("/api/health", (_req, res) => {
  const payload = buildHealthPayload();
  res.status(payload.ok ? 200 : 503).json(payload);
});

app.get("/api/bitacora", requireMonitorToken, (_req, res) => {
  res.json({
    ...buildBitacoraComparison(readBitacora(), runtime.data),
    db: countBitacoraRecords(),
  });
});

app.get("/api/bitacora/:id/history", requireMonitorToken, (_req, res) => {
  const current = initDatabase()
    .prepare("SELECT * FROM bitacora WHERE id = ?")
    .get(_req.params.id);
  if (!current) {
    res.json({
      ok: true,
      current: null,
      history: [],
    });
    return;
  }

  res.json({
    ok: true,
    current: dbRowToBitacora(current),
    history: readBitacoraHistory(_req.params.id),
  });
});

app.get("/api/bitacora/excel", requireMonitorToken, (_req, res) => {
  const file = writeBitacoraExcel(buildBitacoraComparison(readBitacora(), runtime.data));
  res.download(file, "bitacora-seguimiento.xls");
});

app.post("/api/bitacora/import-excel", requireMonitorToken, (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ ok: false, message: "Archivo Excel vacio o no recibido." });
    return;
  }

  const entries = parseBitacoraExcel(req.body);
  if (!entries.length) {
    res.status(400).json({
      ok: false,
      message: "No encontre columnas validas para importar la bitacora.",
    });
    return;
  }

  const stats = importBitacoraEntries(entries, buildAuditMetaFromRequest(req, "Importacion desde Excel"));
  const comparison = buildBitacoraComparison(readBitacora(), runtime.data);
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  pushLog("bitacora", "Bitacora importada desde Excel.", stats);
  res.json({ ...comparison, import: stats });
});

app.post("/api/bitacora", requireMonitorToken, (req, res) => {
  const entry = sanitizeBitacoraEntry(req.body || {});
  const audit = buildAuditMeta(req.body || {}, "Captura inicial");
  if (!entry.folio && !entry.poliza) {
    res.status(400).json({
      ok: false,
      message: "Captura folio/OT o poliza para guardar la bitacora.",
    });
    return;
  }

  const beforeCounts = countBitacoraRecords();
  const existing = findExistingBitacoraEntry(entry);
  let savedEntry = entry;
  let action = "created";

  if (existing) {
    savedEntry = sanitizeBitacoraEntry(entry, existing);
    updateBitacoraEntry(savedEntry, existing, "update", {
      ...audit,
      reason: audit.reason || "Actualizacion de registro existente",
    });
    action = "updated_existing";
  } else {
    insertBitacoraEntry(entry, "create", audit);
  }

  const afterCounts = countBitacoraRecords();
  const items = readBitacora();
  const comparison = buildBitacoraComparison(items, runtime.data);
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  pushLog("bitacora", action === "created" ? "Registro agregado a bitacora." : "Registro existente actualizado en bitacora.", {
    id: existing?.id || entry.id,
    action,
    folio: savedEntry.folio,
    poliza: savedEntry.poliza,
    responsable: savedEntry.responsable,
    beforeActive: beforeCounts.active,
    afterActive: afterCounts.active,
  });
  res.status(action === "created" ? 201 : 200).json({
    ...comparison,
    db: afterCounts,
    save: {
      action,
      duplicate: Boolean(existing),
      id: existing?.id || entry.id,
      folio: savedEntry.folio,
      poliza: savedEntry.poliza,
      before: beforeCounts,
      after: afterCounts,
    },
  });
});

app.put("/api/bitacora/:id", requireMonitorToken, (req, res) => {
  const audit = requireAuditReason(req, res);
  if (!audit) return;

  const current = initDatabase()
    .prepare("SELECT * FROM bitacora WHERE id = ?")
    .get(req.params.id);
  if (!current) {
    res.status(404).json({ ok: false, message: "Registro de bitacora no encontrado." });
    return;
  }

  const previous = dbRowToBitacora(current);
  const entry = sanitizeBitacoraEntry(req.body || {}, previous);
  updateBitacoraEntry(entry, previous, "update", audit);
  const items = readBitacora();
  const comparison = buildBitacoraComparison(items, runtime.data);
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  pushLog("bitacora", "Registro actualizado en bitacora.", {
    id: entry.id,
    folio: entry.folio,
  });
  res.json(comparison);
});

app.delete("/api/bitacora/:id", requireMonitorToken, (req, res) => {
  const audit = requireAuditReason(req, res);
  if (!audit) return;

  const result = archiveBitacoraEntry(req.params.id, audit);
  if (!result.changes) {
    res.status(404).json({ ok: false, message: "Registro de bitacora no encontrado." });
    return;
  }

  const comparison = buildBitacoraComparison(readBitacora(), runtime.data);
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  pushLog("bitacora", "Registro archivado en bitacora.", { id: req.params.id });
  res.json(comparison);
});

app.post("/api/bitacora/:id/restore", requireMonitorToken, (req, res) => {
  const audit = requireAuditReason(req, res);
  if (!audit) return;

  const result = restoreBitacoraEntry(req.params.id, audit);
  if (!result.changes) {
    res.status(404).json({ ok: false, message: "Registro archivado no encontrado." });
    return;
  }

  const comparison = buildBitacoraComparison(readBitacora(), runtime.data);
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  pushLog("bitacora", "Registro restaurado en bitacora.", { id: req.params.id });
  res.json(comparison);
});

app.post("/api/run", requireMonitorToken, (_req, res) => {
  if (runtime.busy) {
    res.json({ ok: false, busy: true, error: "Ya hay una ejecucion en curso." });
    return;
  }

  void runMonitor("manual");
  res.json({ ok: true });
});

app.post("/api/continue-manual-login", requireMonitorToken, async (_req, res) => {
  const result = await continueAfterManualLogin().catch((error) => ({
    ok: false,
    message: serializeError(error),
  }));
  res.json(result);
});

app.post("/api/cancel", requireMonitorToken, async (_req, res) => {
  const result = await cancelRun().catch((error) => ({
    ok: false,
    message: serializeError(error),
  }));
  res.json(result);
});

app.post("/api/restart-browser", requireMonitorToken, async (_req, res) => {
  if (runtime.busy) {
    res.status(409).json({
      ok: false,
      busy: true,
      message: "Hay una ejecucion en curso. Cancela o espera antes de reiniciar el navegador.",
    });
    return;
  }

  await closeBrowserContext("reinicio manual desde UI");
  saveSessionInfo({
    alive: false,
    lastCheckedAt: nowIso(),
    lastUrl: null,
    note: "Navegador reiniciado manualmente.",
  });
  pushLog("browser", "Navegador reiniciado manualmente.");
  res.json({ ok: true });
});

function scheduleNextAutoRefresh(delayMs = CONFIG.autoRefreshMinutes * 60 * 1000) {
  if (CONFIG.autoRefreshMinutes <= 0) {
    runtime.scheduler.nextTrigger = null;
    return;
  }

  if (runtime.scheduler.timer) {
    clearTimeout(runtime.scheduler.timer);
  }

  runtime.scheduler.nextTrigger = new Date(Date.now() + delayMs).toISOString();
  runtime.scheduler.timer = setTimeout(async () => {
    runtime.scheduler.timer = null;

    if (runtime.busy) {
      scheduleNextAutoRefresh(30 * 1000);
      return;
    }

    runtime.scheduler.lastTrigger = nowIso();
    await runMonitor("scheduler");
  }, delayMs);
}

function startServer() {
  validateConfig();
  initDatabase();
  seedDatabaseFromCurrentState();
  cleanupOldScreenshots();
  writeBitacoraExcel(buildBitacoraComparison(readBitacora(), runtime.data));
  scheduleNextAutoRefresh();

  pushLog("system", "Monitor listo.");

  return app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`Monitor disponible en http://${CONFIG.host}:${CONFIG.port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  buildGetPendientesUrl,
  compareRows,
  createEmptyDiff,
  extractItems,
  getCurrentMonthDateRange,
  isLocalHost,
  mapItem,
  mergeCurrentMonthWithOpenOlderRows,
  parseDateForSort,
  publicSessionInfo,
  requireMonitorToken,
  sanitizeUrlForClient,
  sortRows,
  startServer,
  writeJson,
};
