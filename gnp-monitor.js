require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const { chromium } = require("playwright");

const app = express();
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));

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

function getBrowserChannel() {
  const requested = String(process.env.BROWSER_CHANNEL || "").trim();
  if (!requested) {
    return process.platform === "win32" ? "msedge" : "";
  }
  if (process.platform !== "win32" && requested.toLowerCase() === "msedge") {
    return "";
  }
  return requested;
}

function getProfileDir() {
  if (process.env.DATA_DIR) {
    return path.join(DATA_DIR, "browser-profile");
  }

  const requested = process.env.PROFILE_DIR || "";
  if (process.platform !== "win32" && (!requested || /^[A-Za-z]:[\\/]/.test(requested))) {
    return path.join(DATA_DIR, "browser-profile");
  }
  return requested ? path.resolve(requested) : path.join(DATA_DIR, "browser-profile");
}

const CONFIG = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  monitorToken: process.env.MONITOR_TOKEN || "",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || process.env.MONITOR_TOKEN || "admin",
  sessionDays: Math.max(Number(process.env.SESSION_DAYS || 7), 1),
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
  siniestrosUrl:
    process.env.SINIESTROS_URL ||
    "https://portalintermediarios.gnp.com.mx/home/pagina-iframe?tipo=aplicacion&menu=Siniestros%20ED%20CP%20GN",
  axaSiniestrosUrl:
    process.env.AXA_SINIESTROS_URL ||
    "https://axa.mx/web/my-axa/consulta-express",
  browserChannel: getBrowserChannel(),
  profileDir: getProfileDir(),
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
  openWaEnabled: parseBooleanEnv(process.env.OPENWA_ENABLED, false),
  openWaBaseUrl: (process.env.OPENWA_BASE_URL || "http://localhost:2785/api").replace(/\/+$/, ""),
  openWaApiKey: process.env.OPENWA_API_KEY || "",
  openWaSessionId: process.env.OPENWA_SESSION_ID || "",
  openWaChatIds: parseListEnv(process.env.OPENWA_CHAT_IDS),
  openWaMaxChanges: Math.max(Number(process.env.OPENWA_MAX_CHANGES || 10), 1),
  dataDir: DATA_DIR,
  logsDir: path.join(DATA_DIR, "logs"),
  screenshotsDir: path.join(DATA_DIR, "screenshots"),
  backupDir: path.join(DATA_DIR, "backups"),
  siniestrosPdfDir: path.join(DATA_DIR, "siniestros-pdf"),
  siniestrosProfileDir:
    process.env.SINIESTROS_PROFILE_DIR ||
    path.join(path.dirname(getProfileDir()), `${path.basename(getProfileDir())}-siniestros`),
  axaSiniestrosProfileDir:
    process.env.AXA_SINIESTROS_PROFILE_DIR ||
    path.join(path.dirname(getProfileDir()), `${path.basename(getProfileDir())}-axa-siniestros`),
  sessionInfoFile: path.join(DATA_DIR, "session.json"),
  previousFile: path.join(DATA_DIR, "estado-anterior.json"),
  currentFile: path.join(DATA_DIR, "estado-actual.json"),
  diffFile: path.join(DATA_DIR, "cambios.json"),
  axaPreviousFile: path.join(DATA_DIR, "axa-estado-anterior.json"),
  axaCurrentFile: path.join(DATA_DIR, "axa-estado-actual.json"),
  axaDiffFile: path.join(DATA_DIR, "axa-cambios.json"),
  axaRawFile: path.join(DATA_DIR, "axa-raw-response.json"),
  axaDebugFile: path.join(DATA_DIR, "axa-debug.json"),
  rawFile: path.join(DATA_DIR, "raw-response.json"),
  extractedFile: path.join(DATA_DIR, "items-extraidos.json"),
  debugCapturedFile: path.join(DATA_DIR, "debug-captured.json"),
  debugRequestsFile: path.join(DATA_DIR, "debug-requests.json"),
  bitacoraFile: path.join(DATA_DIR, "bitacora.json"),
  bitacoraExcelFile: path.join(DATA_DIR, "bitacora-seguimiento.xls"),
  databaseFile: path.join(DATA_DIR, "gnp-monitor.db"),
  logFile: path.join(DATA_DIR, "logs", "monitor.log"),
};

if (CONFIG.trustProxy) {
  app.set("trust proxy", true);
}

for (const dir of [
  CONFIG.dataDir,
  CONFIG.logsDir,
  CONFIG.screenshotsDir,
  CONFIG.backupDir,
  CONFIG.siniestrosPdfDir,
  CONFIG.profileDir,
  CONFIG.siniestrosProfileDir,
  CONFIG.axaSiniestrosProfileDir,
]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const ACTIVE_USER_ROLES = new Set(["admin", "executive"]);

// Caches para optimizar rendimiento
const DATE_SORT_CACHE = new Map();
const NORMALIZE_TEXT_CACHE = new Map();
const NORMALIZE_LOOSE_CACHE = new Map();
const COLLATOR = new Intl.Collator("es", { numeric: true });

function isAllowedUserRole(role) {
  return ACTIVE_USER_ROLES.has(String(role || ""));
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

const SINIESTROS_SELECTORS = {
  ramo: 'input[name="esRamo_complete"]',
  criterio: 'input[name="esCriterioBusqueda_complete"]',
  numeroTransaccion: 'input[name="esNumeroTransaccion_txt"], #esNumeroTransaccion_txtesNumeroTransaccion_txt',
  buscar: [
    '#esBuscar_btnesBuscar_btn',
    'input.esBuscar_btn[name="esBuscar_btn"][value="Buscar"]',
    'button:has-text("Buscar")',
    'a:has-text("Buscar")',
    'input[type="button"][value*="Buscar" i]',
    'input[type="submit"][value*="Buscar" i]',
    'label:has(input.esBuscar_btn) .hoverBtn',
  ],
  aceptarError: [
    'button:has-text("Aceptar")',
    'input[type="button"][value*="Aceptar" i]',
    'a:has-text("Aceptar")',
  ],
  tablaResultados: '#tbl_busqueda',
  verDocumentos: [
    '#esVerDocumentos_btnesVerDocumentos_btn',
    'input.esVerDocumentos_btn[name="esVerDocumentos_btn"][value="Ver documentos"]',
  ],
};

const AXA_SINIESTROS_SELECTORS = {
  folio: [
    'input[id$=":datosSiniestroForm:reclamacion"]',
    'input[name$=":datosSiniestroForm:reclamacion"]',
    'input.input-siniestros[placeholder*="reclamaci"]',
    'input[placeholder*="reclamaci"]',
  ],
  consultar: [
    'a[id$=":datosSiniestroForm:consult-btn"]:visible',
    'a.btn-siniestros-gmm:has-text("Consultar")',
    'a:has-text("Consultar")',
    'button:has-text("Consultar")',
  ],
  consultarBloqueado: [
    'span[id$=":datosSiniestroForm:consult-btn-block"]',
    '.btn-siniestros-gmm-block',
  ],
  mensajeReclamacion: [
    'span[id$=":datosSiniestroForm:messageReclamacion"]',
    '.wc-error-message-min span',
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
  if (text === "month_end" || text === "fin_mes" || text === "fin-de-mes") {
    return new Date(fallbackDate.getFullYear(), fallbackDate.getMonth() + 1, 0);
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
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

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
  // Usar caché para textos normalizados
  if (NORMALIZE_TEXT_CACHE.has(value)) {
    return NORMALIZE_TEXT_CACHE.get(value);
  }
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  NORMALIZE_TEXT_CACHE.set(value, result);
  return result;
}

function normalizeLoose(value) {
  // Usar caché para búsquedas normalizadas
  if (NORMALIZE_LOOSE_CACHE.has(value)) {
    return NORMALIZE_LOOSE_CACHE.get(value);
  }
  const result = fixMojibakeText(normalizeText(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  NORMALIZE_LOOSE_CACHE.set(value, result);
  return result;
}

function fixMojibakeText(value) {
  return String(value ?? "")
    .replace(/ÃƒÂ±|Ã±/g, "ñ")
    .replace(/ÃƒÂ©|Ã©/g, "é")
    .replace(/ÃƒÂ¡|Ã¡/g, "á")
    .replace(/ÃƒÂ­|Ã­/g, "í")
    .replace(/ÃƒÂ³|Ã³/g, "ó")
    .replace(/ÃƒÂº|Ãº/g, "ú");
}

function makeKey(row) {
  return normalizeText(row?.ot || row?.OT || row?.id || "");
}

function parseDateForSort(value) {
  // Usar caché para evitar reprocesar fechas iguales
  if (DATE_SORT_CACHE.has(value)) {
    return DATE_SORT_CACHE.get(value);
  }

  const text = normalizeText(value);
  let result = Number.POSITIVE_INFINITY;

  if (text) {
    const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      result = new Date(Number(year), Number(month) - 1, Number(day)).getTime();
    } else {
      const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
      if (yyyymmdd) {
        const [, year, month, day] = yyyymmdd;
        result = new Date(Number(year), Number(month) - 1, Number(day)).getTime();
      } else {
        const parsed = new Date(text).getTime();
        result = Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
      }
    }
  }

  DATE_SORT_CACHE.set(value, result);
  return result;
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

function makeUserId() {
  return `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") {
    return false;
  }
  const [, iterationsText, salt, expected] = parts;
  const actual = crypto.pbkdf2Sync(String(password || ""), salt, Number(iterationsText), 32, "sha256").toString("hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: parseBooleanEnv(process.env.SESSION_COOKIE_SECURE, false),
    maxAge: CONFIG.sessionDays * 24 * 60 * 60 * 1000,
  };
}

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const index = item.indexOf("=");
      if (index > -1) {
        cookies[decodeURIComponent(item.slice(0, index))] = decodeURIComponent(item.slice(index + 1));
      }
      return cookies;
    }, {});
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    role: user.role,
    active: user.active !== undefined ? Boolean(user.active) : true,
    createdAt: user.created_at || user.createdAt || "",
    updatedAt: user.updated_at || user.updatedAt || "",
  };
}

function seedAdminUser(database) {
  const total = database
    .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1")
    .get().total;
  if (total > 0) {
    return;
  }
  const now = nowIso();
  const username = normalizeText(CONFIG.adminUsername);
  const existing = database.prepare("SELECT id FROM users WHERE lower(username) = lower(?)").get(username);
  if (existing) {
    database
      .prepare(`
        UPDATE users
        SET role = 'admin',
            active = 1,
            password_hash = ?,
            display_name = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(hashPassword(CONFIG.adminPassword), "Administrador", now, existing.id);
    return;
  }
  database
    .prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
    `)
    .run(makeUserId(), username, "Administrador", hashPassword(CONFIG.adminPassword), now, now);
}

function readUserByUsername(username) {
  return initDatabase()
    .prepare(`
      SELECT *
      FROM users
      WHERE lower(username) = lower(?)
        AND active = 1
        AND role IN ('admin', 'executive')
    `)
    .get(normalizeText(username));
}

function readUserById(id) {
  return initDatabase()
    .prepare(`
      SELECT *
      FROM users
      WHERE id = ?
        AND active = 1
        AND role IN ('admin', 'executive')
    `)
    .get(normalizeText(id));
}

function readAnyUserById(id) {
  return initDatabase()
    .prepare("SELECT * FROM users WHERE id = ? AND role IN ('admin', 'executive')")
    .get(normalizeText(id));
}

function readAdminUsers() {
  return initDatabase()
    .prepare(`
      SELECT id, username, display_name, role, active, created_at, updated_at
      FROM users
      WHERE role IN ('admin', 'executive')
      ORDER BY active DESC, role, display_name
    `)
    .all();
}

function countActiveAdmins(exceptUserId = "") {
  return initDatabase()
    .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1 AND id <> ?")
    .get(normalizeText(exceptUserId)).total;
}

function clearUserSessions(userId) {
  initDatabase().prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(normalizeText(userId));
}

function createAuthSession(user) {
  if (!isAllowedUserRole(user?.role)) {
    throw new Error("Rol de usuario no permitido.");
  }
  const database = initDatabase();
  const token = crypto.randomBytes(32).toString("base64url");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + CONFIG.sessionDays * 24 * 60 * 60 * 1000).toISOString();
  database
    .prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
    .run(hashSessionToken(token), user.id, expiresAt, now, now);
  return token;
}

function getRequestUser(req) {
  if (req.user) {
    return req.user;
  }
  const cookies = parseCookies(req.get("cookie"));
  const token = cookies.gnp_session || "";
  if (!token) {
    return null;
  }
  const database = initDatabase();
  const row = database
    .prepare(`
      SELECT u.*
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
        AND u.active = 1
        AND u.role IN ('admin', 'executive')
    `)
    .get(hashSessionToken(token), nowIso());
  if (row) {
    database.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(nowIso(), hashSessionToken(token));
    req.user = row;
  }
  return row || null;
}

function writeAuditLog(req, action, resource, resourceId = "", detail = {}) {
  try {
    const user = getRequestUser(req);
    initDatabase()
      .prepare(`
        INSERT INTO audit_log (user_id, action, resource, resource_id, created_at, ip, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        user?.id || null,
        action,
        resource,
        normalizeText(resourceId),
        nowIso(),
        getClientIp(req),
        JSON.stringify(detail || {})
      );
  } catch (error) {
    pushLog("audit", `No pude registrar auditoria: ${error.message}`, { error: true });
  }
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
      assigned_user_id TEXT,
      created_by_user_id TEXT,
      created_by_name TEXT,
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bitacora_folio ON bitacora(folio);
    CREATE INDEX IF NOT EXISTS idx_bitacora_poliza ON bitacora(poliza);
    CREATE INDEX IF NOT EXISTS idx_bitacora_responsable ON bitacora(responsable);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'executive')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      resource_id TEXT,
      created_at TEXT NOT NULL,
      ip TEXT,
      detail_json TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

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
  migrateDisallowedUserRoles(db);
  seedAdminUser(db);
  migrateBitacoraJsonToDb();
  return db;
}

function migrateDisallowedUserRoles(database) {
  const now = nowIso();
  const result = database
    .prepare(`
      UPDATE users
      SET active = 0,
          updated_at = ?
      WHERE role NOT IN ('admin', 'executive')
        AND active = 1
    `)
    .run(now);
  database
    .prepare(`
      DELETE FROM auth_sessions
      WHERE user_id IN (
        SELECT id
        FROM users
        WHERE active = 0
           OR role NOT IN ('admin', 'executive')
      )
    `)
    .run();
  if (result.changes) {
    pushLog("security", "Usuarios con rol no permitido fueron desactivados.", {
      count: result.changes,
    });
  }
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
  addColumn("assigned_user_id", "assigned_user_id TEXT");
  addColumn("created_by_user_id", "created_by_user_id TEXT");
  addColumn("created_by_name", "created_by_name TEXT");
  addColumn("archived_at", "archived_at TEXT");
  addColumn("archived_reason", "archived_reason TEXT");
  addColumn("ot_interna", "ot_interna TEXT");
  addColumn("ramo", "ramo TEXT");
  database.exec("UPDATE bitacora SET archived_at = NULL WHERE archived_at = ''");
  database.exec("CREATE INDEX IF NOT EXISTS idx_bitacora_archived_at ON bitacora(archived_at)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_bitacora_assigned_user ON bitacora(assigned_user_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_bitacora_created_by_user ON bitacora(created_by_user_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_bitacora_ot_interna ON bitacora(ot_interna)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_bitacora_ramo ON bitacora(ramo)");

  const historyColumns = new Set(database.prepare("PRAGMA table_info(bitacora_history)").all().map((column) => column.name));
  const addHistoryColumn = (name, sql) => {
    if (!historyColumns.has(name)) {
      database.exec(`ALTER TABLE bitacora_history ADD COLUMN ${sql}`);
      historyColumns.add(name);
    }
  };

  addHistoryColumn("changed_by", "changed_by TEXT");
  addHistoryColumn("reason", "reason TEXT");
  addHistoryColumn("ot_interna", "ot_interna TEXT");
  addHistoryColumn("ramo", "ramo TEXT");
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
      id, assigned_user_id, created_by_user_id, created_by_name, dias_atraso, fecha_entrada_correo, fecha_entrega, tramite, estado, cliente,
      poliza, aseguradora, descripcion, folio, comentarios, fecha_salida, responsable,
      ot_interna, ramo, version, archived_at, archived_reason, created_at, updated_at
    ) VALUES (
      @id, @assignedUserId, @createdByUserId, @createdByName, @diasAtraso, @fechaEntradaCorreo, @fechaEntrega, @tramite, @estado, @cliente,
      @poliza, @aseguradora, @descripcion, @folio, @comentarios, @fechaSalida, @responsable,
      @otInterna, @ramo, @version, @archivedAt, @archivedReason, @createdAt, @updatedAt
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
    assignedUserId: row.assigned_user_id || "",
    createdByUserId: row.created_by_user_id || "",
    createdByName: row.created_by_name || "",
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
    otInterna: row.ot_interna || "",
    ramo: row.ramo || "",
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
    const clauses = [];
    if (onlyArchived) {
      clauses.push("archived_at IS NOT NULL AND archived_at <> ''");
    } else if (!includeArchived) {
      clauses.push("(archived_at IS NULL OR archived_at = '')");
    }
    if (options.user && options.user.role !== "admin") {
      clauses.push(`(
        assigned_user_id = @userId
        OR lower(responsable) = lower(@displayName)
        OR lower(responsable) = lower(@username)
      )`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const params = options.user
      ? {
          userId: options.user.id,
          displayName: options.user.display_name || options.user.username,
          username: options.user.username,
        }
      : {};
    return db
      .prepare(`SELECT * FROM bitacora ${where} ORDER BY updated_at DESC, created_at DESC`)
      .all(params)
      .map(dbRowToBitacora);
  }

  const items = readJsonSafe(CONFIG.bitacoraFile, []);
  if (!Array.isArray(items)) {
    return [];
  }
  const visibleItems = includeArchived ? items : items.filter((item) => !item.archivedAt);
  if (options.user && options.user.role !== "admin") {
    const names = new Set([
      normalizeLoose(options.user.id),
      normalizeLoose(options.user.username),
      normalizeLoose(options.user.display_name || options.user.displayName),
    ].filter(Boolean));
    return visibleItems.filter((item) =>
      names.has(normalizeLoose(item.assignedUserId)) || names.has(normalizeLoose(item.responsable))
    );
  }
  return visibleItems;
}

function readBitacoraForRequest(req, options = {}) {
  return readBitacora({
    ...options,
    user: getRequestUser(req),
  });
}

function countBitacoraRecordsForUser(user = null) {
  if (!user || user.role === "admin") {
    return countBitacoraRecords();
  }
  const database = initDatabase();
  const params = {
    userId: user.id,
    displayName: user.display_name || user.username,
    username: user.username,
  };
  const ownerWhere = `(
    assigned_user_id = @userId
    OR lower(responsable) = lower(@displayName)
    OR lower(responsable) = lower(@username)
  )`;
  return {
    total: database.prepare(`SELECT COUNT(*) AS total FROM bitacora WHERE ${ownerWhere}`).get(params).total,
    active: database
      .prepare(`SELECT COUNT(*) AS total FROM bitacora WHERE ${ownerWhere} AND (archived_at IS NULL OR archived_at = '')`)
      .get(params).total,
    archived: database
      .prepare(`SELECT COUNT(*) AS total FROM bitacora WHERE ${ownerWhere} AND archived_at IS NOT NULL AND archived_at <> ''`)
      .get(params).total,
  };
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
    assignedUserId: normalizeText(input.assignedUserId || input.assigned_user_id || previous.assignedUserId),
    createdByUserId: normalizeText(previous.createdByUserId || previous.created_by_user_id || input.createdByUserId || input.created_by_user_id),
    createdByName: normalizeText(previous.createdByName || previous.created_by_name || input.createdByName || input.created_by_name),
    diasAtraso: normalizeText(input.diasAtraso),
    fechaEntradaCorreo: normalizeText(input.fechaEntradaCorreo || input.fecha_entrada_correo || previous.fechaEntradaCorreo),
    fechaEntrega: normalizeText(input.fechaEntrega),
    tramite: normalizeText(input.tramite),
    estado: normalizeText(input.estado),
    cliente: normalizeText(input.cliente),
    poliza: normalizeText(input.poliza),
    aseguradora: normalizeText(input.aseguradora),
    descripcion: normalizeText(input.descripcion),
    folio: normalizeText(input.folio),
    comentarios: normalizeText(input.comentarios),
    fechaSalida: normalizeText(input.fechaSalida || input.fecha_salida || previous.fechaSalida),
    responsable: normalizeText(input.responsable),
    otInterna: normalizeText(input.otInterna || input.ot_interna || previous.otInterna || previous.ot_interna),
    ramo: normalizeRamo(input.ramo || input.RAMO || previous.ramo),
    version: Number(previous.version || input.version || 1),
    archivedAt: normalizeText(previous.archivedAt || input.archivedAt) || null,
    archivedReason: normalizeText(previous.archivedReason || input.archivedReason),
    updatedAt: now,
  };

  if (!clean.createdAt) {
    clean.createdAt = now;
  }

  if (!clean.otInterna) {
    clean.otInterna = makeGeneratedOtInterna(clean);
  }
  return clean;
}

function makeGeneratedOtInterna(entry = {}) {
  const sourceDate = parseGnpDate(entry.createdAt || entry.fechaEntradaCorreo || entry.updatedAt) || new Date();
  const year = String(sourceDate.getFullYear()).slice(-2);
  const month = String(sourceDate.getMonth() + 1).padStart(2, "0");
  const day = String(sourceDate.getDate()).padStart(2, "0");
  const sourceKey = [entry.id, entry.folio, entry.poliza, entry.createdAt].filter(Boolean).join("|") || String(Date.now());
  const suffix = crypto.createHash("sha1").update(sourceKey).digest("hex").slice(0, 5).toUpperCase();
  return `OT-${year}${month}${day}-${suffix}`;
}

function inferBitacoraRamo(entry = {}, monitorRow = null) {
  const source = normalizeLoose([
    entry.ramo,
    monitorRow?.ramo,
    monitorRow?.rol,
    monitorRow?.producto,
    monitorRow?.tipoSolicitud,
    entry.tramite,
    entry.descripcion,
    entry.comentarios,
  ].filter(Boolean).join(" "));
  if (source.includes("gmm") || source.includes("gastos medicos")) return "GMM";
  if (source.includes("vida")) return "Vida";
  if (source.includes("auto")) return "Autos";
  if (source.includes("dano") || source.includes("danos") || source.includes("da?o")) return "Daño";
  return "";
}

function normalizeRamo(value) {
  const text = normalizeLoose(value);
  if (!text) return "";
  if (text.includes("gmm") || text.includes("gastos medicos")) return "GMM";
  if (text.includes("vida")) return "Vida";
  if (text.includes("auto")) return "Autos";
  if (text.includes("dano") || text.includes("danos") || text.includes("da?o")) return "Daño";
  return "";
}

function completeBitacoraTrackingFields(entry = {}, fallback = {}) {
  if (!entry) return entry;
  return {
    ...entry,
    otInterna: entry.otInterna || entry.ot_interna || fallback.otInterna || fallback.ot_interna || "",
    ramo: normalizeRamo(entry.ramo || fallback.ramo || ""),
  };
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

function excelFolioValueToText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
  }
  return normalizeText(value);
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
      "ramo",
      "otinterna",
    ].filter((header) => headers.has(header)).length;
    if (score > best.score) {
      best = { index, score };
    }
  });
  return best.score >= 2 ? best.index : -1;
}

function validateExcelBuffer(buffer, maxSizeMB = 10) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Excel: se esperaba un archivo binario");
  }
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new Error(`Excel: archivo vacío o demasiado grande (máx ${maxSizeMB}MB)`);
  }
}

function createDatabaseBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
    const backupFile = path.join(CONFIG.backupDir, `gnp-monitor-${timestamp}.db`);
    if (fs.existsSync(CONFIG.databaseFile)) {
      fs.copyFileSync(CONFIG.databaseFile, backupFile);
      pushLog("backup", `Backup creado: ${path.basename(backupFile)}`, { size: fs.statSync(backupFile).size });
    }
    cleanOldBackups();
    return backupFile;
  } catch (err) {
    pushLog("backup", `Error al crear backup: ${err.message}`, { error: true });
    return null;
  }
}

function cleanOldBackups(keepDays = 30) {
  try {
    const backupDir = CONFIG.backupDir;
    if (!fs.existsSync(backupDir)) return;
    const now = Date.now();
    const maxAge = keepDays * 24 * 60 * 60 * 1000;
    fs.readdirSync(backupDir)
      .filter((file) => file.startsWith("gnp-monitor-") && file.endsWith(".db"))
      .forEach((file) => {
        const fullPath = path.join(backupDir, file);
        const age = now - fs.statSync(fullPath).mtime.getTime();
        if (age > maxAge) {
          fs.unlinkSync(fullPath);
          pushLog("backup", `Backup antiguo eliminado: ${file}`, { daysOld: Math.floor(age / (24 * 60 * 60 * 1000)) });
        }
      });
  } catch (err) {
    pushLog("backup", `Error al limpiar backups: ${err.message}`, { error: true });
  }
}

function parseBitacoraExcel(buffer) {
  validateExcelBuffer(buffer);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, defval: "" });
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
      otInterna: pickExcelValue(row, headerMap, ["OT INTERNA", "OT INTERNA / TAREA", "TAREA", "FOLIO INTERNO"]),
      ramo: pickExcelValue(row, headerMap, ["RAMO"]),
    }))
    .filter((entry) => entry.folio || entry.poliza || entry.cliente);
}

function parseSiniestrosExcel(buffer) {
  validateExcelBuffer(buffer);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, defval: "" });
  if (!workbook.SheetNames.length) {
    return [];
  }

  const isFolioHeader = (value) => {
    const header = normalizeHeader(value);
    if (!header) return false;
    return [
      "folio",
      "folios",
      "numerodefolio",
      "numerofolio",
      "nofolio",
      "folioaxa",
      "foliosaxa",
      "foliosiniestro",
      "foliosiniestros",
      "siniestro",
      "siniestros",
      "reclamacion",
      "numerodereclamacion",
      "numeroreclamacion",
      "noreclamacion",
      "numerodetransaccion",
      "numerotransaccion",
      "transaccion",
    ].includes(header) || header.includes("folio");
  };

  const seen = new Set();
  const folios = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: "",
    });

    rows.forEach((row, rowIndex) => {
      const columns = (row || [])
        .map((value, columnIndex) => (isFolioHeader(value) ? columnIndex : -1))
        .filter((columnIndex) => columnIndex !== -1);
      columns.forEach((column) => {
        rows.slice(rowIndex + 1).forEach((dataRow) => {
          const folio = excelFolioValueToText(dataRow?.[column]);
          if (!folio || isFolioHeader(folio) || seen.has(folio)) return;
          seen.add(folio);
          folios.push(folio);
        });
      });
    });
  }

  return folios;
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
  const user = getRequestUser(req);
  return buildAuditMeta(
    {
      ...(req.body && !Buffer.isBuffer(req.body) ? req.body : {}),
      reason: req.body?.reason || req.body?.changeReason || req.get("x-change-reason") || fallbackReason,
      changedBy: user ? (user.display_name || user.username) : req.body?.changedBy || req.body?.operator || req.get("x-operator") || "Operador local",
    },
    fallbackReason
  );
}

function applyLoggedUserCapture(entry, user) {
  if (!entry || !user) return entry;
  entry.createdByUserId = user.id;
  entry.createdByName = user.display_name || user.username;
  return entry;
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
        appendBitacoraFollowup(previous, sanitizeBitacoraEntry(item, previous), {
          ...audit,
          reason: audit.reason || "Seguimiento importado desde Excel",
        });
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
  const completeBefore = completeBitacoraTrackingFields(beforeEntry, afterEntry || {});
  const completeAfter = completeBitacoraTrackingFields(afterEntry, beforeEntry || {});
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
      completeBefore ? JSON.stringify(completeBefore) : null,
      completeAfter ? JSON.stringify(completeAfter) : null
    );
}

function readBitacoraHistory(entryId) {
  const current = dbRowToBitacora(initDatabase().prepare("SELECT * FROM bitacora WHERE id = ?").get(entryId) || {});
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
      before: row.before_json ? completeBitacoraTrackingFields(JSON.parse(row.before_json), current) : null,
      after: row.after_json ? completeBitacoraTrackingFields(JSON.parse(row.after_json), current) : null,
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
        id, assigned_user_id, created_by_user_id, created_by_name, dias_atraso, fecha_entrada_correo, fecha_entrega, tramite, estado, cliente,
        poliza, aseguradora, descripcion, folio, comentarios, responsable,
        fecha_salida, ot_interna, ramo,
        version, archived_at, archived_reason, created_at, updated_at
      ) VALUES (
        @id, @assignedUserId, @createdByUserId, @createdByName, @diasAtraso, @fechaEntradaCorreo, @fechaEntrega, @tramite, @estado, @cliente,
        @poliza, @aseguradora, @descripcion, @folio, @comentarios, @responsable,
        @fechaSalida, @otInterna, @ramo,
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
        assigned_user_id = @assignedUserId,
        created_by_user_id = @createdByUserId,
        created_by_name = @createdByName,
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
        ot_interna = @otInterna,
        ramo = @ramo,
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

function appendBitacoraFollowup(existing, followup, audit = {}) {
  const database = initDatabase();
  const base = existing.id ? existing : dbRowToBitacora(existing);
  const maxHistory = database
    .prepare("SELECT MAX(version) AS version FROM bitacora_history WHERE entry_id = ?")
    .get(base.id);
  const version = Math.max(Number(base.version || 1), Number(maxHistory?.version || 1)) + 1;
  const after = {
    ...base,
    ...followup,
    id: base.id,
    version,
    createdAt: base.createdAt,
    updatedAt: nowIso(),
    archivedAt: base.archivedAt || null,
    archivedReason: base.archivedReason || "",
  };

  const save = database.transaction(() => {
    recordBitacoraHistory(database, base.id, version, "followup", base, after, {
      ...audit,
      reason: audit.reason || "Seguimiento capturado y registro base actualizado",
    });
    database
      .prepare(`
        UPDATE bitacora SET
          assigned_user_id = @assignedUserId,
          created_by_user_id = @createdByUserId,
          created_by_name = @createdByName,
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
          ot_interna = @otInterna,
          ramo = @ramo,
          version = @version,
          archived_at = @archivedAt,
          archived_reason = @archivedReason,
          updated_at = @updatedAt
        WHERE id = @id
      `)
      .run(after);
  });
  save();

  return { changes: 1, version };
}

function withMonitorSnapshot(entry, rows = runtime.data) {
  const indexes = buildMonitorIndexes(filterArchivedMonitorRows(rows));
  const match = findMonitorMatch(entry, indexes);
  return {
    ...entry,
    monitor: match.row || null,
    matchBy: match.matchBy || null,
  };
}

function repairMissingBitacoraTrackingFields(entries, monitorRows) {
  if (!db || !Array.isArray(entries) || !entries.length) {
    return entries;
  }

  const updates = [];
  const repaired = entries.map((entry) => {
    const next = {
      ...entry,
      otInterna: entry.otInterna || makeGeneratedOtInterna(entry),
      ramo: normalizeRamo(entry.ramo),
    };
    if (next.otInterna !== entry.otInterna || next.ramo !== entry.ramo) {
      updates.push(next);
    }
    return next;
  });

  if (updates.length) {
    const update = initDatabase().transaction((items) => {
      const statement = initDatabase().prepare(`
        UPDATE bitacora
        SET ot_interna = COALESCE(NULLIF(ot_interna, ''), @otInterna),
            ramo = COALESCE(NULLIF(ramo, ''), @ramo),
            updated_at = @updatedAt
        WHERE id = @id
      `);
      const history = initDatabase().prepare(`
        INSERT INTO bitacora_history (
          entry_id, version, action, changed_at, changed_by, reason, before_json, after_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        const beforeRow = initDatabase().prepare("SELECT * FROM bitacora WHERE id = ?").get(item.id);
        if (!beforeRow) continue;
        const before = dbRowToBitacora(beforeRow);
        const after = {
          ...before,
          otInterna: before.otInterna || item.otInterna,
          ramo: before.ramo || item.ramo,
          updatedAt: nowIso(),
        };
        statement.run(after);
        history.run(
          after.id,
          after.version,
          "repair_tracking_fields",
          after.updatedAt,
          "Sistema",
          "Ramo y OT interna completados automaticamente",
          JSON.stringify(before),
          JSON.stringify(after)
        );
      }
    });
    update(updates);
  }

  return repaired;
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

  const repairedEntries = repairMissingBitacoraTrackingFields(Array.isArray(entries) ? entries : [], monitorRows);
  const activeEntries = repairedEntries.filter((entry) => !entry.archivedAt);
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
            usuarioCreador: match.row.usuarioCreador,
            agente: match.row.agente,
            contratante: match.row.contratante,
            tipoSolicitud: match.row.tipoSolicitud,
            producto: match.row.producto,
            guia: match.row.guia,
            fechaRegistro: match.row.fechaRegistro,
            primerIngreso: match.row.primerIngreso,
            ultimoIngreso: match.row.ultimoIngreso,
            medioApertura: match.row.medioApertura,
            rol: match.row.rol,
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
      usuarioCreador: row.usuarioCreador,
      agente: row.agente,
      contratante: row.contratante,
      tipoSolicitud: row.tipoSolicitud,
      producto: row.producto,
      guia: row.guia,
      fechaRegistro: row.fechaRegistro,
      primerIngreso: row.primerIngreso,
      ultimoIngreso: row.ultimoIngreso,
      medioApertura: row.medioApertura,
      rol: row.rol,
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
  const report = comparison || buildBitacoraComparison(readBitacora(), filterArchivedMonitorRows(runtime.data));
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
    "Capturado por",
    "Ramo",
    "OT interna",
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
    item.createdByName,
    item.ramo,
    item.otInterna,
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

  const archivedRows = (report.archived || []).map((item) => [
    generatedAt,
    item.folio,
    item.poliza,
    item.cliente,
    item.tramite,
    item.estado,
    item.responsable,
    item.ramo,
    item.otInterna,
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
    "Capturado por",
    "Ramo",
    "OT interna",
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
        snapshot.createdByName,
        snapshot.ramo,
        snapshot.otInterna,
        snapshot.comentarios,
      ];
    });

  const xml = [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    excelSheet("Bitacora", bitacoraHeaders, bitacoraRows),
    excelSheet(
      "Archivados",
      ["Generado", "Folio / OT", "Poliza", "Cliente", "Tramite", "Estado", "Responsable", "Ramo", "OT interna", "Comentarios", "Archivado", "Motivo", "Actualizado"],
      archivedRows
    ),
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
  saveComparisonHistory(buildBitacoraComparison(readBitacora(), filterArchivedMonitorRows(runtime.data)), snapshotId);
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

function mapAxaItem(item) {
  return {
    ...mapItem(item),
    aseguradora: "AXA",
    fuente: "axa",
  };
}

function normalizeMonitorRows(items, mapper = mapItem) {
  return sortRows(
    (Array.isArray(items) ? items : extractItems(items))
      .map(mapper)
      .filter((item) => normalizeText(item.ot))
  );
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
  // Optimizar sort: pre-calcular comparadores y usar Collator reutilizable
  return [...rows].sort((left, right) => {
    const first = parseDateForSort(left.fechaCompromiso) - parseDateForSort(right.fechaCompromiso);
    if (first !== 0) {
      return first;
    }
    return COLLATOR.compare(normalizeText(left.ot), normalizeText(right.ot));
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

function bitacoraMonitorKeySets(entries) {
  const keys = {
    folios: new Set(),
    policies: new Set(),
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    const folio = normalizeTrackingKey(entry.folio);
    const policy = normalizePolicyKey(entry.poliza);
    if (folio) keys.folios.add(folio);
    if (policy) keys.policies.add(policy);
  }

  return keys;
}

function rowMatchesBitacoraKeys(row, keys) {
  if (!row || !keys) return false;
  const ot = normalizeTrackingKey(row.ot);
  const policy = normalizePolicyKey(row.poliza);
  return Boolean((ot && keys.folios.has(ot)) || (policy && keys.policies.has(policy)));
}

function filterArchivedMonitorRows(rows, archivedEntries = readBitacora({ onlyArchived: true })) {
  const archivedKeys = bitacoraMonitorKeySets(archivedEntries);
  return (Array.isArray(rows) ? rows : []).filter((row) => !rowMatchesBitacoraKeys(row, archivedKeys));
}

function shouldKeepRowForCurrentViewWithBitacora(row, referenceDate, activeKeys) {
  return shouldKeepRowForCurrentView(row, referenceDate) || rowMatchesBitacoraKeys(row, activeKeys);
}

function mergeCurrentMonthWithOpenOlderRows(currentMonthRows, normalRows, activeBitacoraEntries = readBitacora()) {
  const referenceDate = getReferenceMonth(currentMonthRows);
  const activeKeys = bitacoraMonitorKeySets(activeBitacoraEntries);
  const merged = currentMonthRows.filter((row) => shouldKeepRowForCurrentViewWithBitacora(row, referenceDate, activeKeys));
  const currentKeys = new Set(merged.map(makeKey).filter(Boolean));

  for (const row of normalRows) {
    const key = makeKey(row);
    if (!key || currentKeys.has(key) || !shouldKeepRowForCurrentViewWithBitacora(row, referenceDate, activeKeys)) {
      continue;
    }

    merged.push(row);
    currentKeys.add(key);
  }

  return sortRows(filterArchivedMonitorRows(merged));
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
      const beforeVal = previous[field];
      const afterVal = current[field];
      const before = normalizeText(beforeVal);
      const after = normalizeText(afterVal);
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
      COLLATOR.compare(normalizeText(left.ot), normalizeText(right.ot))
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
    paused: false,
    everyMinutes: CONFIG.autoRefreshMinutes,
    lastTrigger: null,
    nextTrigger: null,
    timer: null,
  },
  siniestros: {
    busy: false,
    source: null,
    startedAt: null,
    endedAt: null,
    total: 0,
    completed: 0,
    current: null,
    results: [],
    error: null,
  },
  axa: {
    busy: false,
    configured: false,
    mode: "pending_config",
    message: "Listo para conectar flujo AXA.",
    error: null,
    lastUpdate: readJsonSafe(CONFIG.axaDiffFile, {}).timestamp || null,
    dataVersion: readJsonSafe(CONFIG.axaDiffFile, {}).timestamp || "initial",
    data: readJsonSafe(CONFIG.axaCurrentFile, []),
    diff: readJsonSafe(
      CONFIG.axaDiffFile,
      createEmptyDiff(readJsonSafe(CONFIG.axaCurrentFile, []).length)
    ),
    source: "pending_flow",
  },
  axaSiniestros: {
    busy: false,
    source: null,
    startedAt: null,
    endedAt: null,
    total: 0,
    completed: 0,
    current: null,
    results: [],
    error: null,
    url: CONFIG.axaSiniestrosUrl,
  },
  validationWarnings: [],
  lastRunEndedAt: null,
  lastSuccessfulRunAt: null,
  lastFailedRunAt: null,
};
let activeSiniestrosPage = null;
let activeMonitorPage = null;
let activeAxaSiniestrosPage = null;
let siniestrosBrowserContext = null;
let axaSiniestrosBrowserContext = null;

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
    paused: Boolean(scheduler.paused),
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
  if (req.path === "/health") {
    next();
    return;
  }

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
    return false;
  }

  const headerToken = req.get("x-monitor-token") || "";
  const bodyToken = req.body && typeof req.body.monitorToken === "string" ? req.body.monitorToken : "";
  const queryToken = typeof req.query.monitorToken === "string" ? req.query.monitorToken : "";
  return [headerToken, bodyToken, queryToken].some((token) => token === CONFIG.monitorToken);
}

function requireMonitorToken(req, res, next) {
  if (hasValidMonitorToken(req)) {
    req.user = {
      id: "token-admin",
      username: "monitor-token",
      display_name: "Monitor Token",
      role: "admin",
    };
    next();
    return;
  }

  const user = getRequestUser(req);
  if (user) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    authRequired: true,
    message: "Inicia sesion o envia X-Monitor-Token.",
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user || getRequestUser(req);
    if (!user) {
      res.status(401).json({ ok: false, authRequired: true, message: "Inicia sesion." });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ ok: false, message: "No tienes permisos para esta accion." });
      return;
    }
    next();
  };
}

function requireRemoteControlToken(req, res, next) {
  if (getRequestUser(req)?.role === "admin" || hasValidMonitorToken(req)) {
    requireMonitorToken(req, res, next);
    return;
  }
  res.status(403).json({
    ok: false,
    message: "Solo admin puede controlar el login remoto.",
  });
}

app.use(applySecurityHeaders);
app.use(requireAllowedIp);
app.use("/api/bitacora/import-excel", express.raw({
  type: "application/octet-stream",
  limit: "25mb",
}));
app.use("/api/siniestros/import-excel", express.raw({
  type: "application/octet-stream",
  limit: "25mb",
}));
app.use("/api/axa/siniestros/import-excel", express.raw({
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
  if (!CONFIG.siniestrosUrl.includes("/home/pagina-iframe")) {
    warnings.push("SINIESTROS_URL no parece apuntar a la vista de consulta de siniestros.");
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
  if (!process.env.ADMIN_PASSWORD && !CONFIG.monitorToken) {
    warnings.push("ADMIN_PASSWORD no esta configurado; se creo admin inicial con contrasena 'admin'. Cambiala en .env.");
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

function pageMatchesConfiguredRoute(url, configuredUrl) {
  try {
    const current = new URL(url);
    const configured = new URL(configuredUrl);
    if (current.origin !== configured.origin || current.pathname !== configured.pathname) {
      return false;
    }

    const configuredTipo = configured.searchParams.get("tipo");
    const configuredMenu = configured.searchParams.get("menu");
    const currentTipo = current.searchParams.get("tipo");
    const currentMenu = current.searchParams.get("menu");
    return (!configuredTipo || currentTipo === configuredTipo) && (!configuredMenu || currentMenu === configuredMenu);
  } catch {
    return normalizeText(url).includes(normalizeText(configuredUrl));
  }
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

  return fillLocatorValue(found.locator, value);
}

async function fillLocatorValue(locator, value) {
  const text = String(value ?? "");
  try {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ timeout: 1500 }).catch(() => {});
    await locator.fill("");
    await locator.fill(text);
    await locator.evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    }).catch(() => {});
    return true;
  } catch {
    try {
      await locator.click({ timeout: 1500 }).catch(() => {});
      const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
      await locator.press(selectAll).catch(() => {});
      await locator.press("Backspace").catch(() => {});
      await locator.type(text, { delay: 20 });
      await locator.evaluate((node) => {
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        node.dispatchEvent(new Event("blur", { bubbles: true }));
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}

async function fillLoginFieldByLabel(page, labelPattern, value) {
  const cleanPattern = new RegExp(labelPattern, "i");
  for (const target of getSearchTargets(page)) {
    const inputs = target.locator("input:visible");
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const matches = await input.evaluate((node, patternText) => {
        const pattern = new RegExp(patternText, "i");
        const field = node.closest("mat-form-field, .mat-form-field, .mat-mdc-form-field, .mdc-text-field, div");
        const text = [
          node.getAttribute("aria-label"),
          node.getAttribute("placeholder"),
          node.getAttribute("name"),
          node.getAttribute("id"),
          field?.textContent,
        ].filter(Boolean).join(" ");
        return pattern.test(text);
      }, cleanPattern.source).catch(() => false);

      if (matches && await fillLocatorValue(input, value)) {
        return true;
      }
    }
  }

  return false;
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
  const siniestrosContext = siniestrosBrowserContext;
  const axaSiniestrosContext = axaSiniestrosBrowserContext;
  runtime.browserContext = null;
  siniestrosBrowserContext = null;
  axaSiniestrosBrowserContext = null;
  runtime.page = null;
  activeMonitorPage = null;
  activeSiniestrosPage = null;
  activeAxaSiniestrosPage = null;

  if (context) {
    pushLog("browser", `Cerrando navegador Monitor: ${reason}.`);
    await context.close().catch(() => {});
  }
  if (siniestrosContext) {
    pushLog("browser", `Cerrando navegador Siniestros: ${reason}.`);
    await siniestrosContext.close().catch(() => {});
  }
  if (axaSiniestrosContext) {
    pushLog("browser", `Cerrando navegador Siniestros AXA: ${reason}.`);
    await axaSiniestrosContext.close().catch(() => {});
  }
}

function terminateEdgeProcessesForProfile(profileDir, reason = "perfil bloqueado") {
  if (process.platform !== "win32" || !profileDir) {
    return 0;
  }
  try {
    const script = `
      $profile = [System.IO.Path]::GetFullPath($env:GNP_PROFILE_DIR).TrimEnd('\\')
      $escaped = [Regex]::Escape($profile)
      $processes = Get-CimInstance Win32_Process -Filter "name='msedge.exe'" |
        Where-Object { $_.CommandLine -and ([Regex]::IsMatch($_.CommandLine, '--user-data-dir="?'+$escaped+'"?', 'IgnoreCase') -or $_.CommandLine -like "*$profile*") }
      foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
      }
      ($processes | Measure-Object).Count
    `;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, GNP_PROFILE_DIR: profileDir },
      windowsHide: true,
    });
    const count = Number(String(output || "").trim()) || 0;
    if (count > 0) {
      pushLog("browser", "Se cerraron procesos Edge usando el perfil persistente.", {
        count,
        reason,
        profileDir,
      });
    }
    return count;
  } catch (error) {
    pushLog("browser", "No pude cerrar procesos Edge del perfil persistente.", {
      error: serializeError(error),
      profileDir,
    });
    return 0;
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

function buildBrowserLaunchOptions() {
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
  return launchOptions;
}

async function launchPersistentContextWithProfileRecovery(profileDir, label = "Monitor") {
  terminateEdgeProcessesForProfile(profileDir, `inicio ${label}`);
  try {
    return await chromium.launchPersistentContext(profileDir, buildBrowserLaunchOptions());
  } catch (error) {
    const detail = String(error?.message || "");
    const profileConflict = /Abriendo en la sesi|browser has been closed|Target page, context or browser has been closed/i.test(detail);
    if (!profileConflict) {
      throw error;
    }
    pushLog("browser", `Reintentando apertura de ${label} por perfil bloqueado.`, {
      error: serializeError(error),
      profileDir,
    });
    terminateEdgeProcessesForProfile(profileDir, `reintento ${label}`);
    return await chromium.launchPersistentContext(profileDir, buildBrowserLaunchOptions());
  }
}

async function getContext() {
  if (runtime.browserContext) {
    if (!runtime.page || runtime.page.isClosed()) {
      runtime.page = activeMonitorPage && !activeMonitorPage.isClosed()
        ? activeMonitorPage
        : runtime.browserContext.pages()[0] || (await runtime.browserContext.newPage());
    }
    await preparePageForUse(runtime.page);
    return runtime.browserContext;
  }

  runtime.browserContext = await launchPersistentContextWithProfileRecovery(CONFIG.profileDir, "Monitor");

  runtime.page = runtime.browserContext.pages()[0] || (await runtime.browserContext.newPage());
  activeMonitorPage = runtime.page;
  await preparePageForUse(runtime.page);

  runtime.browserContext.on("page", (page) => {
    void preparePageForUse(page);
  });

  pushLog("browser", "Se abrio el navegador persistente.");
  return runtime.browserContext;
}

async function getSiniestrosContext() {
  if (siniestrosBrowserContext) {
    if (!activeSiniestrosPage || activeSiniestrosPage.isClosed()) {
      activeSiniestrosPage = siniestrosBrowserContext.pages()[0] || (await siniestrosBrowserContext.newPage());
    }
    await preparePageForUse(activeSiniestrosPage);
    return siniestrosBrowserContext;
  }

  siniestrosBrowserContext = await launchPersistentContextWithProfileRecovery(CONFIG.siniestrosProfileDir, "Siniestros");
  activeSiniestrosPage = siniestrosBrowserContext.pages()[0] || (await siniestrosBrowserContext.newPage());
  await preparePageForUse(activeSiniestrosPage);

  siniestrosBrowserContext.on("page", (page) => {
    void preparePageForUse(page);
  });

  pushLog("browser", "Se abrio el navegador persistente para Siniestros.", {
    profileDir: CONFIG.siniestrosProfileDir,
  });
  return siniestrosBrowserContext;
}

async function getAxaSiniestrosContext() {
  if (axaSiniestrosBrowserContext) {
    if (!activeAxaSiniestrosPage || activeAxaSiniestrosPage.isClosed()) {
      activeAxaSiniestrosPage = axaSiniestrosBrowserContext.pages()[0] || (await axaSiniestrosBrowserContext.newPage());
    }
    await preparePageForUse(activeAxaSiniestrosPage);
    return axaSiniestrosBrowserContext;
  }

  axaSiniestrosBrowserContext = await launchPersistentContextWithProfileRecovery(
    CONFIG.axaSiniestrosProfileDir,
    "Siniestros AXA"
  );
  activeAxaSiniestrosPage = axaSiniestrosBrowserContext.pages()[0] || (await axaSiniestrosBrowserContext.newPage());
  await preparePageForUse(activeAxaSiniestrosPage);

  axaSiniestrosBrowserContext.on("page", (page) => {
    activeAxaSiniestrosPage = page;
    void preparePageForUse(page);
  });

  pushLog("browser", "Se abrio el navegador persistente para Siniestros AXA.", {
    profileDir: CONFIG.axaSiniestrosProfileDir,
  });
  return axaSiniestrosBrowserContext;
}

async function getActivePage() {
  await getContext();

  const pages = runtime.browserContext.pages().filter((page) => !page.isClosed());
  const currentPage =
    activeMonitorPage && !activeMonitorPage.isClosed()
      ? activeMonitorPage
      : pages.find((page) => pageMatchesConfiguredRoute(page.url(), CONFIG.consultaUrl)) ||
        pages.find((page) => {
          const url = page.url();
          return /portalintermediarios\.gnp\.com\.mx/i.test(url) && !pageMatchesConfiguredRoute(url, CONFIG.siniestrosUrl);
        }) ||
        (await runtime.browserContext.newPage());

  await preparePageForUse(currentPage);
  activeMonitorPage = currentPage;
  runtime.page = currentPage;
  return runtime.page;
}

async function verifyExistingSession(page, checkUrl = CONFIG.consultaUrl) {
  setState("checking_session", "Revisando si la sesion guardada sigue viva...");
  pushLog("session", "Revisando si la sesion guardada sigue viva...");

  await page.goto(checkUrl, { waitUntil: "domcontentloaded" });
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
    emailFilled = await fillLoginFieldByLabel(page, "correo|email|usuario", CONFIG.email);
  }

  if (!passwordFilled && CONFIG.password) {
    passwordFilled = await fillLoginFieldByLabel(page, "contrase|password", CONFIG.password);
  }

  if (!emailFilled && CONFIG.email) {
    try {
      const textInput = page.locator('input[type="text"]:visible, input[id^="mat-input-"]:visible').first();
      await textInput.fill("");
      await textInput.type(CONFIG.email, { delay: 20 });
      await textInput.evaluate((node) => {
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        node.dispatchEvent(new Event("blur", { bubbles: true }));
      }).catch(() => {});
      emailFilled = true;
    } catch {}
  }

  if (!passwordFilled && CONFIG.password) {
    try {
      const passwordInput = page.locator('input[type="password"]:visible').first();
      await passwordInput.fill("");
      await passwordInput.type(CONFIG.password, { delay: 20 });
      await passwordInput.evaluate((node) => {
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        node.dispatchEvent(new Event("blur", { bubbles: true }));
      }).catch(() => {});
      passwordFilled = true;
    } catch {}
  }

  await page.waitForTimeout(500);

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

function markManualLoginRequired(prepared = {}, reason = "Sesion vencida o requiere login manual.") {
  runtime.manualLogin = {
    required: true,
    reason,
    promptedAt: nowIso(),
    expiresAt: new Date(Date.now() + CONFIG.manualLoginTimeoutMinutes * 60 * 1000).toISOString(),
    emailFilled: Boolean(prepared.emailFilled),
    passwordFilled: Boolean(prepared.passwordFilled),
    detectedCaptcha: Boolean(prepared.captchaDetected),
    instructions: [
      "Abre la vista de login remoto desde esta pantalla.",
      "Termina el login manual y resuelve el reCAPTCHA en esa vista si aparece.",
      "No hace falta tocar el boton si el sistema detecta la sesion solo.",
      "Si no avanza solo, entonces pulsa el boton para continuar.",
    ],
  };

  setState(
    "waiting_manual_login",
    "Login manual requerido. Abre la vista de login remoto para completar la sesion."
  );
  pushLog("manual_login", reason);
}

function waitForManualLogin(prepared, reason) {
  const deferred = createDeferred();

  runtime.manualLoginDeferred = deferred;
  markManualLoginRequired(prepared, reason);

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
      runtime.error = null;
      resetManualLoginState();
      setState("idle", "Sesion manual confirmada. El monitor esta listo para consultar.");

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

async function startAssistedLogin() {
  if (runtime.busy && runtime.mode !== "waiting_manual_login") {
    return {
      ok: false,
      busy: true,
      message: "Hay una consulta en curso. Espera o cancelala antes de iniciar login manual.",
    };
  }

  const page = await getActivePage();
  const prepared = await prepareLoginPage(page);
  runtime.error = null;
  markManualLoginRequired(prepared, "Sesion vencida o requiere login manual.");

  return {
    ok: true,
    requiresManualLogin: true,
    message: CONFIG.headless
      ? "Navegador remoto preparado. Completa el login desde la vista integrada."
      : "Navegador preparado. Completa el login y marca la sesion como lista.",
  };
}

async function ensureLoggedIn(page, checkUrl = CONFIG.consultaUrl) {
  const alive = await verifyExistingSession(page, checkUrl);
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

  activeMonitorPage = page;
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

async function clearConsultaStatusFilter(page) {
  page = await ensureConsultaOperational(page, "antes de limpiar estatus");

  for (const target of getSearchTargets(page)) {
    try {
      const result = await target.evaluate(() => {
        const normalize = (value) => String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const isVisible = (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const candidates = Array.from(document.querySelectorAll("select, md-select, mat-select, input"))
          .filter(isVisible)
          .filter((node) => {
            const text = normalize([
              node.getAttribute("aria-label"),
              node.getAttribute("placeholder"),
              node.getAttribute("name"),
              node.getAttribute("id"),
              node.getAttribute("ng-model"),
              node.closest("md-input-container, mat-form-field, .mat-mdc-form-field, div")?.textContent,
            ].filter(Boolean).join(" "));
            return /\bestatus\b|\bestado\b/.test(text);
          });

        let changed = false;
        for (const node of candidates) {
          if (node instanceof HTMLSelectElement) {
            node.selectedIndex = 0;
            node.dispatchEvent(new Event("change", { bubbles: true }));
            changed = true;
            continue;
          }

          if (node instanceof HTMLInputElement) {
            node.value = "";
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
            changed = true;
            continue;
          }

          try {
            const angularApi = window.angular;
            const ngModel = angularApi?.element(node).controller?.("ngModel");
            if (ngModel) {
              ngModel.$setViewValue?.(null);
              ngModel.$render?.();
              const scope = angularApi.element(node).scope?.() || angularApi.element(node).isolateScope?.();
              scope?.$applyAsync?.();
              changed = true;
            }
          } catch {}
        }

        return { ok: candidates.length > 0, changed, count: candidates.length };
      });

      if (result?.ok) {
        pushLog("query", "Filtro de estatus limpiado para traer todos los estados.", {
          changed: result.changed,
          controls: result.count,
          target: describeTarget(target),
        });
        await page.waitForTimeout(500);
        return true;
      }
    } catch {}
  }

  pushLog("query", "No encontre filtro visible de estatus para limpiar; continuo con la consulta.");
  return false;
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

function extractUrlQueryParams(value) {
  const params = {};
  const collect = (search) => {
    for (const [key, paramValue] of new URLSearchParams(search).entries()) {
      if (!params[key]) {
        params[key] = paramValue;
      }
    }
  };

  try {
    const url = new URL(value);
    collect(url.search);
    const hashQueryIndex = url.hash.indexOf("?");
    if (hashQueryIndex >= 0) {
      collect(url.hash.slice(hashQueryIndex + 1));
    }
  } catch {}

  return params;
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
      const params = extractUrlQueryParams(targetUrl);
      const info = {
        src: url.toString(),
        origin: url.origin,
        pathname: url.pathname,
        ...params,
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
      const entries = extractUrlQueryParams(src);
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
    const params = extractUrlQueryParams(match[1]);
    const info = {
      src: url.toString(),
      origin: url.origin,
      pathname: url.pathname,
      ...params,
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

function normalizeOpenWaChatId(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.includes("@")) return text;
  const digits = text.replace(/\D/g, "");
  return digits ? `${digits}@c.us` : "";
}

function buildOpenWaStatusMessage(change) {
  const statusChange = (change.changes || []).find((item) => item.field === "estatus");
  const current = change.current || {};
  const previous = change.previous || {};
  return [
    "Monitor GNP - cambio de estatus",
    `OT: ${displayValueForMessage(current.ot || change.ot)}`,
    `Antes: ${displayValueForMessage(statusChange?.before || previous.estatus)}`,
    `Ahora: ${displayValueForMessage(statusChange?.after || current.estatus)}`,
    `Contratante: ${displayValueForMessage(current.contratante || previous.contratante)}`,
    `Poliza: ${displayValueForMessage(current.poliza || previous.poliza)}`,
    `Compromiso: ${displayValueForMessage(current.fechaCompromiso || previous.fechaCompromiso)}`,
    `Hora: ${new Date().toLocaleString("es-MX")}`,
  ].join("\n");
}

function displayValueForMessage(value) {
  const text = normalizeText(value);
  return text || "-";
}

async function sendOpenWaText(chatId, text) {
  const url = `${CONFIG.openWaBaseUrl}/sessions/${encodeURIComponent(CONFIG.openWaSessionId)}/messages/send-text`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": CONFIG.openWaApiKey,
    },
    body: JSON.stringify({ chatId, text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenWA HTTP ${response.status}: ${detail.slice(0, 180)}`);
  }
  return response.json().catch(() => ({}));
}

async function notifyOpenWaStatusChanges(diff) {
  if (!CONFIG.openWaEnabled) return;
  if (!CONFIG.openWaBaseUrl || !CONFIG.openWaApiKey || !CONFIG.openWaSessionId || !CONFIG.openWaChatIds.length) {
    pushLog("openwa", "OpenWA habilitado pero incompleto. Revisa OPENWA_BASE_URL, OPENWA_API_KEY, OPENWA_SESSION_ID y OPENWA_CHAT_IDS.", {
      error: true,
    });
    return;
  }

  const statusChanges = (diff.cambiados || [])
    .filter((change) => (change.changes || []).some((item) => item.field === "estatus"))
    .slice(0, CONFIG.openWaMaxChanges);
  if (!statusChanges.length) return;

  const chatIds = CONFIG.openWaChatIds.map(normalizeOpenWaChatId).filter(Boolean);
  if (!chatIds.length) {
    pushLog("openwa", "OPENWA_CHAT_IDS no contiene destinatarios validos.", { error: true });
    return;
  }

  let sent = 0;
  for (const change of statusChanges) {
    const message = buildOpenWaStatusMessage(change);
    for (const chatId of chatIds) {
      try {
        await sendOpenWaText(chatId, message);
        sent += 1;
      } catch (error) {
        pushLog("openwa", "No pude enviar notificacion de WhatsApp.", {
          error: serializeError(error),
          chatId,
          ot: change.ot,
        });
      }
    }
  }

  if (sent) {
    pushLog("openwa", "Notificaciones de WhatsApp enviadas.", {
      cambiosEstatus: statusChanges.length,
      mensajes: sent,
    });
  }
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
  const knownRowsByKey = new Map();
  for (const row of [
    ...readJsonSafe(CONFIG.currentFile, []),
    ...readJsonSafe(CONFIG.previousFile, []),
  ]) {
    const key = makeKey(row);
    if (key && !knownRowsByKey.has(key)) {
      knownRowsByKey.set(key, row);
    }
  }
  const knownOpenRows = filterArchivedMonitorRows([...knownRowsByKey.values()])
    .filter((row) => !isTerminada(row));
  const getOpenFallbackRows = () => normalQueryResult?.rows || knownOpenRows;

  try {
    // Primera consulta inicial: normalmente GNP trae un rango amplio.
    // Se conserva para rescatar OTs no terminadas que queden fuera del mes actual.
    await clearConsultaStatusFilter(page).catch(() => {});
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
          const rows = mergeCurrentMonthWithOpenOlderRows(result.rows, getOpenFallbackRows());
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
              previousOpenFallbackRows: normalQueryResult ? 0 : knownOpenRows.length,
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
        const rows = mergeCurrentMonthWithOpenOlderRows(result.rows, getOpenFallbackRows());
        const extraOpenRows = rows.length - result.rows.length;

        return {
          ...result,
          rows,
          debug: {
            ...result.debug,
            normalQueryRows: normalQueryResult?.rows?.length || 0,
            previousOpenFallbackRows: normalQueryResult ? 0 : knownOpenRows.length,
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
        const rows = mergeCurrentMonthWithOpenOlderRows(resultAfterBuscar.rows, getOpenFallbackRows());
        const extraOpenRows = rows.length - resultAfterBuscar.rows.length;

        return {
          ...resultAfterBuscar,
          rows,
          debug: {
            ...resultAfterBuscar.debug,
            normalQueryRows: normalQueryResult?.rows?.length || 0,
            previousOpenFallbackRows: normalQueryResult ? 0 : knownOpenRows.length,
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
        rows: mergeCurrentMonthWithOpenOlderRows(scrapedRows, getOpenFallbackRows()),
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

async function fillSiniestrosAutocomplete(page, selector, value) {
  const field = await findVisibleLocator(page, [selector], 15000);
  if (!field) {
    throw new Error(`No encontre el campo ${selector} en Expediente Digital.`);
  }

  await field.locator.scrollIntoViewIfNeeded().catch(() => {});
  await field.locator.click({ timeout: 2000 });
  await field.locator.fill("");
  await field.locator.type(value, { delay: 30 });
  await field.locator.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }).catch(() => {});
  await page.waitForTimeout(500);
  await field.locator.press("ArrowDown").catch(() => {});
  await field.locator.press("Enter").catch(() => {});
  await field.locator.evaluate((node) => {
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }).catch(() => {});
  await page.waitForTimeout(500);
}

function saveSiniestrosPdf(folio, buffer) {
  const cleanFolio = normalizeText(folio).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "folio";
  const id = `${Date.now()}-${cleanFolio}.pdf`;
  fs.writeFileSync(path.join(CONFIG.siniestrosPdfDir, id), buffer);
  const files = fs
    .readdirSync(CONFIG.siniestrosPdfDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => {
      const file = path.join(CONFIG.siniestrosPdfDir, name);
      return { name, time: fs.statSync(file).mtimeMs };
    })
    .sort((left, right) => right.time - left.time);
  files.slice(50).forEach((item) => fs.unlinkSync(path.join(CONFIG.siniestrosPdfDir, item.name)));
  return id;
}

function createSiniestrosOutcomeCapture(page, context) {
  let resolvePdf;
  const pdfPromise = new Promise((resolve) => {
    resolvePdf = resolve;
  });
  let settled = false;
  const pagesWithDownloadListener = new Set();

  const resolveOnce = (value) => {
    if (settled) return;
    settled = true;
    resolvePdf(value);
  };

  const onResponse = async (response) => {
    const headers = response.headers();
    const contentType = String(headers["content-type"] || "").toLowerCase();
    const disposition = String(headers["content-disposition"] || "").toLowerCase();
    if (!contentType.includes("application/pdf") && !disposition.includes(".pdf")) {
      return;
    }
    const buffer = await response.body().catch(() => null);
    if (buffer?.length) {
      resolveOnce({ buffer, source: "response" });
    }
  };
  const onDownload = async (download) => {
    const file = await download.path().catch(() => null);
    if (!file) return;
    const buffer = fs.readFileSync(file);
    if (buffer.length) {
      resolveOnce({ buffer, source: "download" });
    }
  };
  const attachDownloadListener = (downloadPage) => {
    if (!downloadPage || pagesWithDownloadListener.has(downloadPage)) return;
    pagesWithDownloadListener.add(downloadPage);
    downloadPage.on("download", onDownload);
  };
  const onNewPage = (newPage) => {
    attachDownloadListener(newPage);
  };

  context.on("response", onResponse);
  context.on("page", onNewPage);
  attachDownloadListener(page);
  return {
    pdfPromise,
    cleanup() {
      context.off("response", onResponse);
      context.off("page", onNewPage);
      for (const downloadPage of pagesWithDownloadListener) {
        downloadPage.off("download", onDownload);
      }
    },
  };
}

async function readSiniestrosPortalError(page) {
  for (const target of getSearchTargets(page)) {
    const bodyText = normalizeText(await target.locator("body").innerText({ timeout: 500 }).catch(() => ""));
    const match = bodyText.match(/ERROR AL CONSULTAR SINIESTRO POR IDTRANSACCION/i);
    if (match) {
      return match[0];
    }
  }
  return "";
}

async function waitForSiniestrosDocumentOutcome(page, capture, folio, timeout = 15000) {
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      assertNotCancelled();
      const pdf = await Promise.race([
        capture.pdfPromise,
        page.waitForTimeout(350).then(() => null),
      ]);
      if (pdf?.buffer?.length) {
        return {
          status: "pdf",
          ok: true,
          pdfId: saveSiniestrosPdf(folio, pdf.buffer),
          message: "PDF disponible.",
        };
      }

      const portalError = await readSiniestrosPortalError(page);
      if (portalError) {
        return {
          status: "portal_error",
          ok: false,
          message: portalError,
        };
      }
    }

    return {
      status: "unknown",
      ok: false,
      message: "El portal no mostro PDF ni un mensaje de error reconocido.",
    };
  } finally {
    capture.cleanup();
  }
}

async function waitForSiniestrosSearchResult(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assertNotCancelled();
    const portalError = await readSiniestrosPortalError(page);
    if (portalError) {
      return { status: "portal_error", ok: false, message: portalError };
    }

    for (const target of getSearchTargets(page)) {
      const table = target.locator(SINIESTROS_SELECTORS.tablaResultados).first();
      if (!(await table.isVisible().catch(() => false))) {
        continue;
      }
      const rows = table.locator("tbody tr:not(.vacioLinea)");
      const rowCount = await rows.count().catch(() => 0);
      if (rowCount > 0) {
        return { status: "result", ok: true, target, row: rows.first() };
      }
      const text = normalizeText(await table.innerText({ timeout: 800 }).catch(() => ""));
      if (text.includes("---")) {
        return { status: "no_results", ok: false, message: "0 Resultado(s) para el folio." };
      }
    }

    if (page.url() === "about:blank") {
      return { status: "blank", ok: false, message: "La vista de Siniestros quedo en blanco despues de buscar." };
    }
    await page.waitForTimeout(350);
  }
  return { status: "unknown", ok: false, message: "El portal no mostro resultados ni un mensaje de error reconocido." };
}

async function gotoSiniestros(page) {
  setState("siniestros", "Abriendo Expediente Digital - Siniestros...");
  await preparePageForUse(page);
  await page.goto(CONFIG.siniestrosUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await dismissBlockingOverlays(page);

  if (!(await appearsLoggedIn(page))) {
    throw new Error("La sesion se perdio al entrar a Siniestros.");
  }

  const field = await findVisibleLocator(page, [SINIESTROS_SELECTORS.ramo], 20000);
  if (!field) {
    throw new Error("No aparecio el campo Ramo en la vista de Siniestros.");
  }

  saveSessionInfo({
    alive: true,
    lastCheckedAt: nowIso(),
    lastUrl: page.url(),
    note: "Dentro de Expediente Digital - Siniestros.",
  });
  return page;
}

async function triggerSiniestrosBuscar(page, folio) {
  for (const target of getSearchTargets(page)) {
    const triggered = await target.evaluate(({ numeroTransaccion }) => {
      const jq = window.jQuery || window.$;
      if (!jq) return false;

      const component = jq("#ecExpedienteDigital").first();
      if (!component.length) return false;

      const event = jq.Event("ecExpedienteDigital_BuscaSiniestro_Buscar");
      event.data_set = { esNumeroTransaccion_txt: numeroTransaccion };
      component.trigger(event);
      return true;
    }, { numeroTransaccion: folio }).catch(() => false);

    if (triggered) {
      pushLog("siniestros", "Busqueda activada por evento del componente Expediente Digital.");
      return true;
    }
  }

  for (const target of getSearchTargets(page)) {
    const exact = target.locator("#esBuscar_btnesBuscar_btn").first();
    if (await exact.count().catch(() => 0)) {
      const clicked = await clickLocator(exact);
      pushLog("siniestros", "Respaldo: intento de clic en Buscar por selector exacto.", {
        selector: "#esBuscar_btnesBuscar_btn",
        clicked,
      });
      return clicked;
    }
  }

  const fallback = await findVisibleLocator(page, SINIESTROS_SELECTORS.buscar, 10000, true);
  if (!fallback) {
    return false;
  }
  const clicked = await clickLocator(fallback.locator);
  pushLog("siniestros", "Respaldo: intento de clic en Buscar por selector alterno.", {
    selector: fallback.selector,
    clicked,
  });
  return clicked;
}

async function clickSiniestrosVerDocumentos(page) {
  const button = await findVisibleLocator(page, SINIESTROS_SELECTORS.verDocumentos, 8000, true);
  if (!button) {
    return false;
  }
  const clicked = await clickLocator(button.locator);
  pushLog("siniestros", "Intento de clic en Ver documentos.", {
    selector: button.selector,
    clicked,
  });
  return clicked;
}

async function searchSiniestroFolio(page, folio) {
  page = await gotoSiniestros(page);
  assertNotCancelled();

  await fillSiniestrosAutocomplete(page, SINIESTROS_SELECTORS.ramo, "GMM");
  await fillSiniestrosAutocomplete(page, SINIESTROS_SELECTORS.criterio, "N\u00famero de transacci\u00f3n");

  const numberField = await findVisibleLocator(page, [SINIESTROS_SELECTORS.numeroTransaccion], 15000);
  if (!numberField) {
    throw new Error("No aparecio el campo Numero de transaccion.");
  }
  await fillLocatorValue(numberField.locator, folio);

  if (!(await triggerSiniestrosBuscar(page, folio))) {
    throw new Error("No pude activar la busqueda de siniestros.");
  }

  const searchResult = await waitForSiniestrosSearchResult(page);
  if (searchResult.status !== "result") {
    return { page, outcome: searchResult };
  }

  await clickLocator(searchResult.row);
  await page.waitForTimeout(500);
  const capture = createSiniestrosOutcomeCapture(page, page.context());
  if (!(await clickSiniestrosVerDocumentos(page))) {
    capture.cleanup();
    return {
      page,
      outcome: {
        status: "document_unavailable",
        ok: false,
        message: "Se encontro el resultado, pero Ver documentos no se habilito.",
      },
    };
  }

  const outcome = await waitForSiniestrosDocumentOutcome(page, capture, folio);
  return { page, outcome };
}

async function gotoAxaSiniestros(page) {
  setState("siniestros", "Abriendo Consulta Express AXA...");
  await preparePageForUse(page);
  await page.goto(CONFIG.axaSiniestrosUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(800);

  const field = await findVisibleLocator(page, AXA_SINIESTROS_SELECTORS.folio, 25000);
  if (!field) {
    throw new Error("No aparecio el campo Numero de Folio en Consulta Express AXA.");
  }

  return page;
}

async function readAxaSiniestrosValidation(page) {
  for (const selector of AXA_SINIESTROS_SELECTORS.mensajeReclamacion) {
    const text = normalizeText(await page.locator(selector).first().innerText({ timeout: 500 }).catch(() => ""));
    if (text) return text;
  }
  return "";
}

async function waitForAxaConsultButton(page, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assertNotCancelled();
    const inputReady = await page.locator(AXA_SINIESTROS_SELECTORS.folio.join(", ")).first().evaluate((node) => {
      const className = String(node.className || "");
      return className.includes("input-success") || className.includes("success");
    }).catch(() => false);
    const blockedVisible = await page.locator(AXA_SINIESTROS_SELECTORS.consultarBloqueado.join(", ")).first()
      .isVisible()
      .catch(() => false);
    for (const selector of AXA_SINIESTROS_SELECTORS.consultar) {
      const locator = page.locator(selector).first();
      if (!(await locator.count().catch(() => 0))) continue;
      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => true);
      const box = await locator.boundingBox().catch(() => null);
      if (visible && enabled && box && (inputReady || !blockedVisible)) {
        return locator;
      }
    }

    const validation = await readAxaSiniestrosValidation(page);
    if (validation) {
      throw new Error(validation);
    }
    await page.waitForTimeout(300);
  }
  throw new Error("AXA no habilito el boton Consultar despues de salir del campo de folio.");
}

async function fillAxaSiniestroFolio(page, folio) {
  const field = await findVisibleLocator(page, AXA_SINIESTROS_SELECTORS.folio, 20000);
  if (!field) {
    throw new Error("No encontre el campo Numero de Folio de AXA.");
  }

  await field.locator.scrollIntoViewIfNeeded().catch(() => {});
  await field.locator.click({ timeout: 2000 });
  await field.locator.fill("");
  await field.locator.type(folio, { delay: 35 });
  await field.locator.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => {});

  // AXA habilita el boton hasta que el input pierde foco.
  await field.locator.press("Tab").catch(async () => {
    await field.locator.evaluate((node) => {
      node.blur();
      node.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    }).catch(() => {});
  });
  await page.waitForTimeout(900);
}

function normalizeExtractedLabel(value) {
  return normalizeLoose(value).replace(/[^a-z0-9]+/g, " ").trim();
}

async function extractAxaSiniestroInfo(page, fallbackFolio = "") {
  return page.evaluate(({ fallbackFolio }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const rawText = String(document.body?.innerText || "");
    const body = clean(rawText);
    const lines = rawText.split(/\n|\r/).map(clean).filter(Boolean);
    const result = {
      siniestro: "",
      fechaSiniestro: "",
      estadoPago: "",
      tipoTramite: "",
      folio: fallbackFolio,
      fechaSolicitud: "",
      compromisoRespuesta: "",
      etapaActual: "",
      etapas: [],
      rawText: body.slice(0, 2000),
    };

    const siniestroMatch = body.match(/Siniestro:\s*([A-Za-z0-9-]+)/i);
    if (siniestroMatch) result.siniestro = siniestroMatch[1];
    const fechaSinMatch = body.match(/Fecha del siniestro:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);
    if (fechaSinMatch) result.fechaSiniestro = fechaSinMatch[1];
    const folioMatch = body.match(/Folio:\s*([A-Za-z0-9-]+)/i);
    if (folioMatch) result.folio = folioMatch[1];

    const statusCandidates = ["PAGADO", "INFORMACION ADICIONAL", "RECHAZADO", "EN PROCESO", "PENDIENTE"];
    result.estadoPago = statusCandidates.find((item) => body.toUpperCase().includes(item)) || "";
    result.tipoTramite = ["REEMBOLSO", "PROGRAMACION", "PAGO DIRECTO"].find((item) => body.toUpperCase().includes(item)) || "";

    const valueAfter = (label) => {
      const index = lines.findIndex((line) => line.toLowerCase().includes(label.toLowerCase()));
      if (index === -1) return "";
      const sameLine = lines[index].replace(new RegExp(label, "i"), "").trim();
      if (sameLine) return sameLine;
      return lines[index + 1] || "";
    };
    result.fechaSolicitud = valueAfter("Fecha de solicitud");
    result.compromisoRespuesta = valueAfter("Compromiso de respuesta");

    const knownStages = ["Registro", "Captura", "Dictamen", "Respuesta"];
    result.etapas = knownStages.filter((stage) => body.includes(stage));
    result.etapaActual = result.etapas[result.etapas.length - 1] || "";
    return result;
  }, { fallbackFolio }).catch(() => ({
    siniestro: "",
    fechaSiniestro: "",
    estadoPago: "",
    tipoTramite: "",
    folio: fallbackFolio,
    fechaSolicitud: "",
    compromisoRespuesta: "",
    etapaActual: "",
    etapas: [],
    rawText: "",
  }));
}

async function screenshotAxaSiniestroResult(page, folio) {
  const cleanFolio = normalizeText(folio).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "axa";
  const file = path.join(CONFIG.screenshotsDir, `${Date.now()}-axa-siniestro-${cleanFolio}.png`);
  await page.screenshot({ path: file, fullPage: true });
  cleanupOldScreenshots();
  return path.basename(file);
}

async function searchAxaSiniestroFolio(page, folio) {
  page = await gotoAxaSiniestros(page);
  assertNotCancelled();

  await fillAxaSiniestroFolio(page, folio);
  const button = await waitForAxaConsultButton(page);
  const beforeUrl = page.url();
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {}),
    clickLocator(button),
  ]);
  await page.waitForTimeout(1200);

  const validation = await readAxaSiniestrosValidation(page);
  const bodyText = normalizeText(await page.locator("body").innerText({ timeout: 2500 }).catch(() => "")).slice(0, 500);
  const currentUrl = page.url();
  const changedUrl = currentUrl !== beforeUrl;
  const hasResult = /consulta de siniestros|siniestro:|fecha del siniestro|compromiso de respuesta/i.test(bodyText);
  const hasConsulted = changedUrl || /consulta|siniestro|folio|reclamaci/i.test(bodyText);
  const details = hasResult ? await extractAxaSiniestroInfo(page, folio) : null;
  const screenshotId = hasResult ? await screenshotAxaSiniestroResult(page, folio).catch(() => "") : "";

  return {
    page,
    outcome: {
      status: validation ? "validation" : hasResult ? "result" : "consulted",
      ok: !validation && (hasResult || hasConsulted),
      message: validation || (hasResult ? "Resultado AXA extraido." : "Consulta AXA ejecutada."),
      url: sanitizeUrlForClient(currentUrl),
      details,
      screenshotId,
    },
  };
}

async function runAxaSiniestros(folios, source = "manual") {
  if (runtime.busy) {
    return false;
  }

  const queue = [...new Set((Array.isArray(folios) ? folios : [])
    .map((folio) => normalizeText(folio))
    .filter(Boolean))].slice(0, 100);
  if (!queue.length) {
    throw new Error("Captura al menos un folio AXA para consultar.");
  }

  runtime.busy = true;
  runtime.error = null;
  runtime.cancelRequested = false;
  runtime.activeRun = { id: Date.now(), trigger: `axa_siniestros_${source}`, startedAt: nowIso() };
  runtime.axaSiniestros = {
    busy: true,
    source,
    startedAt: nowIso(),
    endedAt: null,
    total: queue.length,
    completed: 0,
    current: null,
    results: [],
    error: null,
    url: CONFIG.axaSiniestrosUrl,
  };
  setState("siniestros", "Preparando consulta de Siniestros AXA...");
  pushLog("axa_siniestros", `Inicio de consulta AXA de ${queue.length} folio(s) (${source}).`);

  let preservedPage = null;
  let axaPage = null;
  try {
    const context = await getAxaSiniestrosContext();
    preservedPage = runtime.page && !runtime.page.isClosed() ? runtime.page : null;
    axaPage = activeAxaSiniestrosPage && !activeAxaSiniestrosPage.isClosed()
      ? activeAxaSiniestrosPage
      : await context.newPage();
    activeAxaSiniestrosPage = axaPage;
    runtime.page = axaPage;

    for (const folio of queue) {
      assertNotCancelled();
      runtime.axaSiniestros.current = folio;
      setState("siniestros", `Consultando folio AXA ${folio}...`);
      try {
        const searched = await searchAxaSiniestroFolio(axaPage, folio);
        axaPage = searched.page;
        runtime.axaSiniestros.results.unshift({
          folio,
          ...searched.outcome,
          at: nowIso(),
        });
        pushLog("axa_siniestros", searched.outcome.ok ? "Consulta AXA ejecutada." : "Consulta AXA con validacion.", {
          folio,
          status: searched.outcome.status,
          message: searched.outcome.message,
        });
      } catch (error) {
        const detail = serializeError(error);
        runtime.axaSiniestros.results.unshift({ folio, ok: false, status: "error", message: detail, at: nowIso() });
        pushLog("axa_siniestros", "Fallo la consulta AXA.", { folio, error: detail });
      } finally {
        runtime.axaSiniestros.completed += 1;
      }
    }

    const failed = runtime.axaSiniestros.results.filter((result) => !result.ok).length;
    setState("done", failed ? `Siniestros AXA finalizo con ${failed} error(es).` : "Consulta de Siniestros AXA completada.");
    return true;
  } catch (error) {
    const detail = serializeError(error);
    runtime.axaSiniestros.error = detail;
    runtime.error = detail;
    setState("error", detail);
    pushLog("error", detail);
    return false;
  } finally {
    if (activeMonitorPage && !activeMonitorPage.isClosed()) {
      runtime.page = activeMonitorPage;
    } else if (preservedPage && !preservedPage.isClosed()) {
      runtime.page = preservedPage;
    }
    runtime.axaSiniestros.busy = false;
    runtime.axaSiniestros.current = null;
    runtime.axaSiniestros.endedAt = nowIso();
    runtime.busy = false;
    runtime.cancelRequested = false;
    runtime.activeRun = null;
  }
}

async function runSiniestros(folios, source = "manual") {
  if (runtime.busy) {
    return false;
  }

  const queue = [...new Set((Array.isArray(folios) ? folios : [])
    .map((folio) => normalizeText(folio))
    .filter(Boolean))].slice(0, 500);
  if (!queue.length) {
    throw new Error("Captura al menos un folio para consultar.");
  }

  runtime.busy = true;
  runtime.error = null;
  runtime.cancelRequested = false;
  runtime.activeRun = { id: Date.now(), trigger: `siniestros_${source}`, startedAt: nowIso() };
  runtime.siniestros = {
    busy: true,
    source,
    startedAt: nowIso(),
    endedAt: null,
    total: queue.length,
    completed: 0,
    current: null,
    results: [],
    error: null,
  };
  resetManualLoginState();
  setState("siniestros", "Preparando consulta de Siniestros...");
  pushLog("siniestros", `Inicio de consulta de ${queue.length} folio(s) (${source}).`);

  let preservedPage = null;
  let siniestrosPage = null;
  try {
    const context = await getSiniestrosContext();
    preservedPage = runtime.page && !runtime.page.isClosed() ? runtime.page : null;
    if (activeSiniestrosPage && !activeSiniestrosPage.isClosed()) {
      siniestrosPage = activeSiniestrosPage;
    } else {
      siniestrosPage = await context.newPage();
      activeSiniestrosPage = siniestrosPage;
      await preparePageForUse(siniestrosPage);
    }
    runtime.page = siniestrosPage;
    let page = await ensureLoggedIn(siniestrosPage, CONFIG.siniestrosUrl);

    for (const folio of queue) {
      assertNotCancelled();
      runtime.siniestros.current = folio;
      setState("siniestros", `Consultando folio ${folio}...`);
      try {
        const searched = await searchSiniestroFolio(page, folio);
        page = searched.page;
        const outcome = searched.outcome;
        runtime.siniestros.results.unshift({
          folio,
          ...outcome,
          at: nowIso(),
        });
        pushLog("siniestros", outcome.ok ? "PDF encontrado." : "Respuesta sin PDF.", {
          folio,
          status: outcome.status,
          message: outcome.message,
        });
      } catch (error) {
        const detail = serializeError(error);
        runtime.siniestros.results.unshift({ folio, ok: false, message: detail, at: nowIso() });
        pushLog("siniestros", "Fallo la busqueda de folio.", { folio, error: detail });
        if (/sesi[o\u00f3]n|login|captcha/i.test(detail) || runtime.cancelRequested) {
          throw error;
        }
      } finally {
        runtime.siniestros.completed += 1;
      }
    }

    const failed = runtime.siniestros.results.filter((result) => !result.ok).length;
    setState(
      "done",
      failed
        ? `Siniestros finalizado con ${failed} folio(s) no procesado(s).`
        : "Consulta de Siniestros completada."
    );
    return true;
  } catch (error) {
    const detail = serializeError(error);
    runtime.siniestros.error = detail;
    runtime.error = detail;
    const requiresManualLogin =
      !runtime.cancelRequested &&
      (runtime.manualLogin.required || /sesi[o\u00f3]n|captcha|login/i.test(detail));
    if (requiresManualLogin) {
      markManualLoginRequired(runtime.manualLogin, "Sesion vencida o requiere login manual.");
    } else {
      setState("error", detail);
    }
    pushLog("error", detail);
    return false;
  } finally {
    if (runtime.manualLogin.required && siniestrosPage && !siniestrosPage.isClosed()) {
      runtime.page = siniestrosPage;
    } else if (activeMonitorPage && !activeMonitorPage.isClosed()) {
      runtime.page = activeMonitorPage;
    } else if (preservedPage && !preservedPage.isClosed()) {
      runtime.page = preservedPage;
    } else if (runtime.browserContext) {
      runtime.page = activeMonitorPage && !activeMonitorPage.isClosed()
        ? activeMonitorPage
        : runtime.browserContext.pages().find((page) => !page.isClosed()) || null;
    }
    runtime.siniestros.busy = false;
    runtime.siniestros.current = null;
    runtime.siniestros.endedAt = nowIso();
    runtime.busy = false;
    runtime.cancelRequested = false;
    runtime.activeRun = null;
    if (!runtime.manualLogin.required) {
      resetManualLoginState();
    }
  }
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
    await notifyOpenWaStatusChanges(diff);

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
    createDatabaseBackup();

    return true;
  } catch (error) {
    const detail = serializeError(error);
    const requiresManualLogin =
      !runtime.cancelRequested &&
      (runtime.manualLogin.required || /sesi[oó]n|captcha|login|iniciar sesi[oó]n/i.test(detail));
    runtime.error = requiresManualLogin ? "Sesion vencida o requiere login manual." : detail;
    if (requiresManualLogin) {
      saveSessionInfo({
        alive: false,
        lastCheckedAt: nowIso(),
        lastUrl: runtime.page && !runtime.page.isClosed() ? runtime.page.url() : null,
        note: runtime.error,
      });
      markManualLoginRequired(runtime.manualLogin, runtime.error);
    } else {
      setState("error", runtime.error);
    }
    pushLog("error", detail);
    runtime.lastFailedRunAt = nowIso();

    try {
      if (runtime.page && !runtime.page.isClosed()) {
        await screenshot(runtime.page, "error");
      }
    } catch {}

    return false;
  } finally {
    if (runtime.manualLogin.required) {
      clearManualWatcher();
      runtime.manualLoginDeferred = null;
    } else {
      resetManualLoginState();
    }
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

function saveAxaSnapshot(inputRows, source = "manual") {
  const previousRows = readJsonSafe(CONFIG.axaCurrentFile, readJsonSafe(CONFIG.axaPreviousFile, []));
  const currentRows = normalizeMonitorRows(inputRows, mapAxaItem);
  const diff = compareRows(previousRows, currentRows);
  writeJson(CONFIG.axaPreviousFile, previousRows);
  writeJson(CONFIG.axaCurrentFile, currentRows);
  writeJson(CONFIG.axaDiffFile, diff);
  writeJson(CONFIG.axaRawFile, inputRows);
  writeJson(CONFIG.axaDebugFile, {
    source,
    savedAt: nowIso(),
    count: currentRows.length,
    pendingFlow: true,
  });
  runtime.axa = {
    ...runtime.axa,
    busy: false,
    configured: false,
    mode: "loaded",
    message: "Datos AXA cargados. Flujo automatico pendiente.",
    error: null,
    lastUpdate: diff.timestamp,
    dataVersion: diff.timestamp,
    data: currentRows,
    diff,
    source,
  };
  return { currentRows, diff };
}

function buildAxaStatusPayload(includeData = true) {
  const data = Array.isArray(runtime.axa.data) ? runtime.axa.data : [];
  const diff = runtime.axa.diff || createEmptyDiff(data.length);
  return {
    busy: Boolean(runtime.axa.busy),
    configured: Boolean(runtime.axa.configured),
    mode: runtime.axa.mode || "pending_config",
    message: runtime.axa.message || "Listo para conectar flujo AXA.",
    error: runtime.axa.error || null,
    lastUpdate: runtime.axa.lastUpdate || null,
    dataVersion: runtime.axa.dataVersion || "initial",
    summary: diff.summary || createEmptyDiff(data.length).summary,
    data: includeData ? data : null,
    diff: includeData ? diff : null,
    source: runtime.axa.source || "pending_flow",
  };
}

function buildStatusPayload(includeData, user = null) {
  const visibleData = filterArchivedMonitorRows(runtime.data);
  const visibleDiff = runtime.diff
    ? {
        ...runtime.diff,
        nuevos: filterArchivedMonitorRows(runtime.diff.nuevos),
        cambiados: filterArchivedMonitorRows(runtime.diff.cambiados),
        eliminados: filterArchivedMonitorRows(runtime.diff.eliminados),
        iguales: filterArchivedMonitorRows(runtime.diff.iguales),
      }
    : null;
  if (visibleDiff?.summary) {
    visibleDiff.summary = {
      ...visibleDiff.summary,
      totalActual: visibleData.length,
      nuevos: visibleDiff.nuevos.length,
      cambiados: visibleDiff.cambiados.length,
      eliminados: visibleDiff.eliminados.length,
      iguales: visibleDiff.iguales.length,
    };
  }
  const summary =
    visibleDiff && visibleDiff.summary
      ? visibleDiff.summary
      : createEmptyDiff(visibleData.length).summary;
  const dateRange = getDefaultDateRange();
  const bitacoraItems = readBitacora({ user });
  const bitacora = buildBitacoraComparison(bitacoraItems, visibleData);

  return {
    busy: runtime.busy,
    mode: runtime.mode,
    message: runtime.message,
    error: runtime.error,
    lastUpdate: runtime.lastUpdate,
    dataVersion: runtime.dataVersion,
    summary,
    data: includeData ? visibleData : null,
    diff: includeData ? visibleDiff : null,
    bitacora,
    executionLog: runtime.executionLog,
    sessionInfo: publicSessionInfo(runtime.sessionInfo),
    requiresManualLogin: Boolean(runtime.manualLogin.required),
    manualLogin: runtime.manualLogin,
    activeRun: runtime.activeRun,
    scheduler: publicSchedulerInfo(runtime.scheduler),
    siniestros: runtime.siniestros,
    axa: buildAxaStatusPayload(includeData),
    axaSiniestros: runtime.axaSiniestros,
    auth: {
      postTokenRequired: Boolean(CONFIG.monitorToken),
      user: publicUser(user),
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

function buildBrowserContextPayload(context, page) {
  const pageOpen = Boolean(page && !page.isClosed());
  const pages = context ? context.pages().filter((item) => !item.isClosed()) : [];

  return {
    contextOpen: Boolean(context),
    pageOpen,
    pages: pages.length,
    currentUrl: pageOpen ? sanitizeUrlForClient(page.url()) : null,
  };
}

function buildBrowserPayload() {
  const monitor = buildBrowserContextPayload(runtime.browserContext, activeMonitorPage || runtime.page);
  const siniestros = buildBrowserContextPayload(siniestrosBrowserContext, activeSiniestrosPage);
  return {
    ...monitor,
    monitor,
    siniestros,
    activeContext: runtime.page === activeSiniestrosPage ? "siniestros" : "monitor",
    currentUrl: runtime.page && !runtime.page.isClosed() ? sanitizeUrlForClient(runtime.page.url()) : monitor.currentUrl,
  };
}

function buildHealthPayload() {
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
    requiresManualLogin: Boolean(runtime.manualLogin.required),
    browser: buildBrowserPayload(),
    scheduler: publicSchedulerInfo(runtime.scheduler),
    auth: {
      postTokenRequired: Boolean(CONFIG.monitorToken),
    },
    warnings: runtime.validationWarnings,
  };
}

function readActiveUsers() {
  return initDatabase()
    .prepare(`
      SELECT id, username, display_name, role, active, created_at, updated_at
      FROM users
      WHERE active = 1
        AND role IN ('admin', 'executive')
      ORDER BY role, display_name
    `)
    .all();
}

function canAccessBitacoraEntry(user, entry) {
  if (!user || user.role === "admin") {
    return true;
  }
  const names = new Set([
    normalizeLoose(user.id),
    normalizeLoose(user.username),
    normalizeLoose(user.display_name),
  ].filter(Boolean));
  return names.has(normalizeLoose(entry.assignedUserId)) || names.has(normalizeLoose(entry.responsable));
}

function getEntryDateValue(entry, dateField = "delivery") {
  if (dateField === "created") {
    return parseGnpDate(entry.createdAt || entry.fechaEntradaCorreo);
  }
  if (dateField === "entry") {
    return parseGnpDate(entry.fechaEntradaCorreo || entry.createdAt);
  }
  return parseGnpDate(entry.fechaEntrega || entry.createdAt || entry.fechaEntradaCorreo);
}

function getEntryRisk(entry, updates = 0) {
  if (entry.archivedAt) return "archived";
  if (isClosedStatus(entry.estado)) return "closed";
  const dueDays = dayDiffFromToday(entry.fechaEntrega);
  if (dueDays !== null && dueDays < 0) return "overdue";
  if (updates <= 1) return "no_followup";
  return "open";
}

function parseAdminMetricsFilters(query = {}) {
  const dateFrom = parseGnpDate(query.dateFrom);
  const dateTo = parseGnpDate(query.dateTo);
  const dateToEnd = dateTo ? new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate(), 23, 59, 59, 999) : null;
  return {
    userId: normalizeText(query.userId || ""),
    status: normalizeText(query.status || ""),
    risk: normalizeText(query.risk || ""),
    dateField: ["created", "entry", "delivery"].includes(query.dateField) ? query.dateField : "delivery",
    dateFrom,
    dateTo: dateToEnd,
  };
}

function entryMatchesAdminFilters(entry, filters, updates = 0) {
  if (filters.status && normalizeLoose(entry.estado) !== normalizeLoose(filters.status)) {
    return false;
  }
  if (filters.risk && getEntryRisk(entry, updates) !== filters.risk) {
    return false;
  }
  if (filters.dateFrom || filters.dateTo) {
    const date = getEntryDateValue(entry, filters.dateField);
    if (!date) return false;
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
  }
  return true;
}

function publicAdminCase(entry, row, updates = 0, latestHistory = null) {
  const dueDays = dayDiffFromToday(entry.fechaEntrega);
  const latestAfter = latestHistory?.after || null;
  const lastComment = normalizeText(latestAfter?.comentarios || entry.comentarios || "");
  return {
    id: entry.id,
    executive: row.user?.displayName || "",
    executiveId: row.user?.id || "",
    folio: entry.folio,
    poliza: entry.poliza,
    cliente: entry.cliente,
    tramite: entry.tramite,
    estado: entry.estado,
    responsable: entry.responsable,
    aseguradora: entry.aseguradora,
    fechaEntradaCorreo: entry.fechaEntradaCorreo,
    fechaEntrega: entry.fechaEntrega,
    fechaSalida: entry.fechaSalida,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    archivedAt: entry.archivedAt,
    lastComment,
    lastFollowupAt: latestHistory?.changedAt || entry.updatedAt || entry.createdAt,
    lastFollowupReason: latestHistory?.reason || "",
    lastFollowupAction: latestHistory?.action || "",
    updates,
    dueDays,
    risk: getEntryRisk(entry, updates),
  };
}

function buildExecutiveMetrics(targetUser = null, filters = {}) {
  const database = initDatabase();
  const users = targetUser ? [targetUser] : readActiveUsers();
  const entries = readBitacora({ includeArchived: true });
  const historyCounts = database
    .prepare("SELECT entry_id, COUNT(*) AS total FROM bitacora_history GROUP BY entry_id")
    .all()
    .reduce((map, row) => {
      map.set(row.entry_id, row.total);
      return map;
    }, new Map());
  const latestHistory = database
    .prepare(`
      SELECT *
      FROM bitacora_history
      ORDER BY changed_at DESC, version DESC, id DESC
    `)
    .all()
    .reduce((map, row) => {
      if (!map.has(row.entry_id)) {
        map.set(row.entry_id, {
          id: row.id,
          entryId: row.entry_id,
          version: Number(row.version || 1),
          action: row.action,
          changedAt: row.changed_at,
          changedBy: row.changed_by || "",
          reason: row.reason || "",
          after: row.after_json ? JSON.parse(row.after_json) : null,
        });
      }
      return map;
    }, new Map());

  const buckets = new Map();
  for (const user of users) {
    buckets.set(user.id, {
      user: publicUser(user),
      total: 0,
      active: 0,
      archived: 0,
      completed: 0,
      overdue: 0,
      withoutFollowup: 0,
      updates: 0,
      age0To3: 0,
      age4To7: 0,
      age8Plus: 0,
      avgResolutionDays: 0,
      effectivenessRate: 0,
      cases: [],
    });
  }

  const unassigned = targetUser
    ? null
    : {
        user: { id: "unassigned", username: "sin_asignar", displayName: "Sin asignar", role: "" },
        total: 0,
        active: 0,
        archived: 0,
        completed: 0,
        overdue: 0,
        withoutFollowup: 0,
        updates: 0,
        age0To3: 0,
        age4To7: 0,
        age8Plus: 0,
        avgResolutionDays: 0,
        effectivenessRate: 0,
        cases: [],
      };

  const findBucket = (entry) => {
    if (entry.assignedUserId && buckets.has(entry.assignedUserId)) {
      return buckets.get(entry.assignedUserId);
    }
    for (const user of users) {
      const names = [user.display_name, user.username].map(normalizeLoose);
      if (names.includes(normalizeLoose(entry.responsable))) {
        return buckets.get(user.id);
      }
    }
    return unassigned;
  };

  for (const entry of entries) {
    const bucket = findBucket(entry);
    if (!bucket) continue;
    const updates = historyCounts.get(entry.id) || 0;
    if (filters.userId && bucket.user?.id !== filters.userId) continue;
    if (!entryMatchesAdminFilters(entry, filters, updates)) continue;

    bucket.total += 1;
    if (entry.archivedAt) bucket.archived += 1;
    else bucket.active += 1;
    if (isClosedStatus(entry.estado)) bucket.completed += 1;
    if (!entry.archivedAt && !isClosedStatus(entry.estado) && dayDiffFromToday(entry.fechaEntrega) < 0) bucket.overdue += 1;
    if (updates <= 1) bucket.withoutFollowup += 1;
    bucket.updates += updates;

    if (!entry.archivedAt && !isClosedStatus(entry.estado)) {
      const ageDays = dayDiffFromToday(entry.fechaEntradaCorreo || entry.createdAt);
      const openAge = ageDays === null ? null : Math.max(Math.abs(ageDays), 0);
      if (openAge !== null && openAge <= 3) bucket.age0To3 += 1;
      else if (openAge !== null && openAge <= 7) bucket.age4To7 += 1;
      else bucket.age8Plus += 1;
    }

    bucket.cases.push(publicAdminCase(entry, bucket, updates, latestHistory.get(entry.id)));
  }

  const rows = [...buckets.values()];
  if (unassigned && unassigned.total) {
    rows.push(unassigned);
  }
  return rows.map((row) => {
    const resolvedDurations = row.cases
      .filter((item) => isClosedStatus(item.estado))
      .map((item) => {
        const start = parseGnpDate(item.fechaEntradaCorreo || item.createdAt);
        const end = parseGnpDate(item.fechaSalida || item.updatedAt || item.fechaEntrega);
        if (!start || !end) return null;
        return Math.max(Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000), 0);
      })
      .filter((item) => item !== null);
    const avgResolutionDays = resolvedDurations.length
      ? Math.round((resolvedDurations.reduce((sum, item) => sum + item, 0) / resolvedDurations.length) * 10) / 10
      : 0;
    return {
      ...row,
      avgResolutionDays,
      effectivenessRate: row.total ? Math.round((row.completed / row.total) * 1000) / 10 : 0,
    };
  });
}

app.post("/api/auth/login", (req, res) => {
  const username = normalizeText(req.body?.username);
  const password = String(req.body?.password || "");
  const user = readUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ ok: false, message: "Usuario o contrasena invalida." });
    return;
  }
  const token = createAuthSession(user);
  req.user = user;
  res.cookie("gnp_session", token, sessionCookieOptions());
  writeAuditLog(req, "login", "auth", user.id);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/auth/logout", requireMonitorToken, (req, res) => {
  const cookies = parseCookies(req.get("cookie"));
  const token = cookies.gnp_session || "";
  if (token) {
    initDatabase().prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashSessionToken(token));
  }
  writeAuditLog(req, "logout", "auth", getRequestUser(req)?.id || "");
  res.clearCookie("gnp_session", sessionCookieOptions());
  res.json({ ok: true });
});

app.get("/api/auth/me", requireMonitorToken, (req, res) => {
  res.json({ ok: true, user: publicUser(getRequestUser(req)) });
});

app.get("/api/users", requireMonitorToken, requireRole("admin"), (_req, res) => {
  res.json({ ok: true, users: readAdminUsers().map(publicUser) });
});

app.post("/api/users", requireMonitorToken, requireRole("admin"), (req, res) => {
  const username = normalizeText(req.body?.username);
  const displayName = normalizeText(req.body?.displayName || req.body?.display_name || username);
  const password = String(req.body?.password || "");
  const requestedRole = String(req.body?.role || "");
  const role = isAllowedUserRole(requestedRole) ? requestedRole : "executive";
  if (!username || password.length < 6) {
    res.status(400).json({ ok: false, message: "Captura usuario y contrasena de al menos 6 caracteres." });
    return;
  }
  const now = nowIso();
  const user = {
    id: makeUserId(),
    username,
    displayName,
    role,
  };
  try {
    initDatabase()
      .prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(user.id, username, displayName, hashPassword(password), role, now, now);
    writeAuditLog(req, "create_user", "users", user.id, { username, role });
    res.status(201).json({ ok: true, user });
  } catch (error) {
    res.status(409).json({ ok: false, message: "Ese usuario ya existe." });
  }
});

app.put("/api/users/:id", requireMonitorToken, requireRole("admin"), (req, res) => {
  const userId = normalizeText(req.params.id);
  const currentUser = getRequestUser(req);
  const existing = readAnyUserById(userId);
  if (!existing) {
    res.status(404).json({ ok: false, message: "Usuario no encontrado." });
    return;
  }

  const displayName = normalizeText(req.body?.displayName || req.body?.display_name || existing.display_name);
  const requestedRole = String(req.body?.role || existing.role);
  const role = isAllowedUserRole(requestedRole) ? requestedRole : existing.role;
  const password = String(req.body?.password || "");
  const active = req.body?.active === undefined ? Boolean(existing.active) : Boolean(req.body.active);

  if (currentUser?.id === userId && (role !== "admin" || !active)) {
    res.status(400).json({ ok: false, message: "No puedes quitarte permisos de admin o desactivarte a ti mismo." });
    return;
  }
  if ((existing.role === "admin" && role !== "admin") || (existing.role === "admin" && !active)) {
    if (countActiveAdmins(userId) <= 0) {
      res.status(400).json({ ok: false, message: "Debe quedar al menos un admin activo." });
      return;
    }
  }
  if (!displayName) {
    res.status(400).json({ ok: false, message: "Captura nombre del usuario." });
    return;
  }
  if (password && password.length < 6) {
    res.status(400).json({ ok: false, message: "La contrasena debe tener al menos 6 caracteres." });
    return;
  }

  const now = nowIso();
  const database = initDatabase();
  if (password) {
    database
      .prepare(`
        UPDATE users
        SET display_name = ?,
            password_hash = ?,
            role = ?,
            active = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(displayName, hashPassword(password), role, active ? 1 : 0, now, userId);
  } else {
    database
      .prepare(`
        UPDATE users
        SET display_name = ?,
            role = ?,
            active = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(displayName, role, active ? 1 : 0, now, userId);
  }
  if (!active || role !== existing.role || password) {
    clearUserSessions(userId);
  }
  writeAuditLog(req, "update_user", "users", userId, { displayName, role, active });
  res.json({ ok: true, user: publicUser(readAnyUserById(userId)), users: readAdminUsers().map(publicUser) });
});

app.post("/api/users/:id/deactivate", requireMonitorToken, requireRole("admin"), (req, res) => {
  const userId = normalizeText(req.params.id);
  const currentUser = getRequestUser(req);
  const existing = readAnyUserById(userId);
  if (!existing) {
    res.status(404).json({ ok: false, message: "Usuario no encontrado." });
    return;
  }
  if (currentUser?.id === userId) {
    res.status(400).json({ ok: false, message: "No puedes desactivarte a ti mismo." });
    return;
  }
  if (existing.role === "admin" && countActiveAdmins(userId) <= 0) {
    res.status(400).json({ ok: false, message: "Debe quedar al menos un admin activo." });
    return;
  }
  initDatabase().prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").run(nowIso(), userId);
  clearUserSessions(userId);
  writeAuditLog(req, "deactivate_user", "users", userId);
  res.json({ ok: true, users: readAdminUsers().map(publicUser) });
});

app.post("/api/users/:id/reactivate", requireMonitorToken, requireRole("admin"), (req, res) => {
  const userId = normalizeText(req.params.id);
  const existing = readAnyUserById(userId);
  if (!existing) {
    res.status(404).json({ ok: false, message: "Usuario no encontrado." });
    return;
  }
  initDatabase().prepare("UPDATE users SET active = 1, updated_at = ? WHERE id = ?").run(nowIso(), userId);
  writeAuditLog(req, "reactivate_user", "users", userId);
  res.json({ ok: true, users: readAdminUsers().map(publicUser) });
});

app.get("/api/admin/metrics", requireMonitorToken, requireRole("admin"), (req, res) => {
  const filters = parseAdminMetricsFilters(req.query || {});
  const metrics = buildExecutiveMetrics(null, filters);
  const cases = metrics
    .flatMap((row) => row.cases || [])
    .sort((left, right) => {
      const leftRisk = left.risk === "overdue" ? 0 : left.risk === "no_followup" ? 1 : 2;
      const rightRisk = right.risk === "overdue" ? 0 : right.risk === "no_followup" ? 1 : 2;
      if (leftRisk !== rightRisk) return leftRisk - rightRisk;
      return parseDateForSort(left.fechaEntrega) - parseDateForSort(right.fechaEntrega);
    });
  res.json({
    ok: true,
    metrics,
    cases,
    users: readAdminUsers().map(publicUser),
    filters,
    statusOptions: ["PENDIENTE", "EN PROCESO", "TERMINADA", "RECHAZADA", "CANCELADA"],
    riskOptions: ["overdue", "no_followup", "open", "closed", "archived"],
  });
});

app.get("/api/my/metrics", requireMonitorToken, (req, res) => {
  const user = getRequestUser(req);
  res.json({ ok: true, metrics: buildExecutiveMetrics(user)[0] || null });
});

app.get("/api/status", requireMonitorToken, (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : "";
  const forceFull = req.query.full === "1" || req.query.full === "true";
  const includeData = forceFull || !since || since !== runtime.dataVersion;
  res.json(buildStatusPayload(includeData, getRequestUser(req)));
});

app.get("/api/axa/status", requireMonitorToken, (_req, res) => {
  res.json({ ok: true, axa: buildAxaStatusPayload(true) });
});

app.post("/api/axa/data", requireMonitorToken, requireRole("admin"), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : extractItems(req.body || {});
  const result = saveAxaSnapshot(rows, normalizeText(req.body?.source || "manual"));
  writeAuditLog(req, "load_axa_data", "axa", "", { count: result.currentRows.length });
  res.json({
    ok: true,
    axa: buildAxaStatusPayload(true),
  });
});

app.post("/api/axa/run-now", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  runtime.axa = {
    ...runtime.axa,
    mode: "pending_config",
    message: "Pendiente de configurar el flujo AXA.",
    error: "Pasa el flujo AXA y el origen de datos para habilitar esta accion.",
  };
  res.status(501).json({
    ok: false,
    message: "AXA aun no tiene flujo configurado. Pasa el panel/origen de datos para conectarlo.",
    axa: buildAxaStatusPayload(true),
  });
});

app.get("/api/axa/siniestros/config", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  res.json({
    ok: true,
    url: CONFIG.axaSiniestrosUrl,
    displayUrl: sanitizeUrlForClient(CONFIG.axaSiniestrosUrl),
    configured: Boolean(CONFIG.axaSiniestrosUrl),
  });
});

app.get("/api/axa/siniestros/status", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  res.json({ ok: true, axaSiniestros: runtime.axaSiniestros });
});

app.post("/api/axa/siniestros/search", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const folios = Array.isArray(req.body?.folios) ? req.body.folios : [req.body?.folio];
  const queue = [...new Set(folios.map((folio) => normalizeText(folio)).filter(Boolean))].slice(0, 100);
  if (!queue.length) {
    res.status(400).json({ ok: false, message: "Captura un folio AXA para consultar." });
    return;
  }
  if (runtime.busy) {
    res.status(409).json({ ok: false, busy: true, message: "Ya hay una ejecucion en curso." });
    return;
  }

  void runAxaSiniestros(queue, "manual");
  res.json({ ok: true, accepted: queue.length, axaSiniestros: runtime.axaSiniestros });
});

app.post("/api/axa/siniestros/import-excel", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ ok: false, message: "Archivo Excel vacio o no recibido." });
    return;
  }
  if (runtime.busy) {
    res.status(409).json({ ok: false, busy: true, message: "Ya hay una ejecucion en curso." });
    return;
  }

  const folios = parseSiniestrosExcel(req.body);
  if (!folios.length) {
    res.status(400).json({
      ok: false,
      message: "No encontre folios. Usa una columna llamada Folio o coloca los folios en la primera columna.",
    });
    return;
  }

  const queue = folios.slice(0, 100);
  void runAxaSiniestros(queue, "excel");
  res.json({ ok: true, accepted: queue.length, axaSiniestros: runtime.axaSiniestros });
});

app.get("/api/health", (_req, res) => {
  const payload = buildHealthPayload();
  res.status(payload.ok ? 200 : 503).json(payload);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "up",
    serverTime: nowIso(),
    mode: runtime.mode,
  });
});

app.get("/api/session/status", requireMonitorToken, (_req, res) => {
  res.json({
    ok: true,
    sessionActive: Boolean(runtime.sessionInfo.alive),
    requiresManualLogin: Boolean(runtime.manualLogin.required),
    lastExecution: runtime.lastRunEndedAt,
    lastSuccessfulRun: runtime.lastSuccessfulRunAt,
    lastError: runtime.error,
    browser: buildBrowserPayload(),
    scheduler: publicSchedulerInfo(runtime.scheduler),
  });
});

async function getRemoteLoginPage() {
  if (!runtime.page || runtime.page.isClosed()) {
    throw new Error("No hay una pagina de login abierta. Pulsa Iniciar login primero.");
  }

  await preparePageForUse(runtime.page);
  return runtime.page;
}

app.get("/api/session/remote-view", requireRemoteControlToken, async (_req, res) => {
  try {
    const page = await getRemoteLoginPage();
    const image = await page.screenshot({
      type: "jpeg",
      quality: 70,
      animations: "disabled",
      timeout: 10000,
    });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.send(image);
  } catch (error) {
    res.status(409).json({ ok: false, message: serializeError(error) });
  }
});

app.post("/api/session/remote-action", requireRemoteControlToken, async (req, res) => {
  try {
    const page = await getRemoteLoginPage();
    const action = String(req.body?.action || "");

    if (action === "click") {
      const xRatio = Number(req.body?.xRatio);
      const yRatio = Number(req.body?.yRatio);
      if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
        res.status(400).json({ ok: false, message: "Coordenadas de clic invalidas." });
        return;
      }
      const viewport = page.viewportSize() || { width: 1600, height: 900 };
      await page.mouse.click(viewport.width * xRatio, viewport.height * yRatio);
    } else if (action === "type") {
      const text = String(req.body?.text || "");
      if (!text || text.length > 500) {
        res.status(400).json({ ok: false, message: "El texto debe contener entre 1 y 500 caracteres." });
        return;
      }
      await page.keyboard.type(text, { delay: 20 });
    } else if (action === "key") {
      const key = String(req.body?.key || "");
      const allowedKeys = new Set(["Tab", "Enter", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
      if (!allowedKeys.has(key)) {
        res.status(400).json({ ok: false, message: "Tecla remota no permitida." });
        return;
      }
      await page.keyboard.press(key);
    } else if (action === "scroll") {
      const deltaY = Number(req.body?.deltaY);
      if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 2000) {
        res.status(400).json({ ok: false, message: "Desplazamiento remoto invalido." });
        return;
      }
      await page.mouse.wheel(0, deltaY);
    } else {
      res.status(400).json({ ok: false, message: "Accion remota no reconocida." });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(409).json({ ok: false, message: serializeError(error) });
  }
});

app.get("/api/bitacora", requireMonitorToken, (_req, res) => {
  const user = getRequestUser(_req);
  res.json({
    ...buildBitacoraComparison(readBitacoraForRequest(_req), filterArchivedMonitorRows(runtime.data)),
    db: countBitacoraRecordsForUser(user),
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
  const entry = dbRowToBitacora(current);
  if (!canAccessBitacoraEntry(getRequestUser(_req), entry)) {
    res.status(403).json({ ok: false, message: "No tienes acceso a esta bitacora." });
    return;
  }

  res.json({
    ok: true,
    current: entry,
    history: readBitacoraHistory(_req.params.id),
  });
});

app.get("/api/bitacora/excel", requireMonitorToken, (_req, res) => {
  const file = writeBitacoraExcel(buildBitacoraComparison(readBitacoraForRequest(_req), filterArchivedMonitorRows(runtime.data)));
  res.download(file, "bitacora-seguimiento.xls");
});

app.post("/api/bitacora/import-excel", requireMonitorToken, requireRole("admin"), (req, res) => {
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
  const comparison = buildBitacoraComparison(readBitacoraForRequest(req), filterArchivedMonitorRows(runtime.data));
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  writeAuditLog(req, "import_excel", "bitacora", "", stats);
  pushLog("bitacora", "Bitacora importada desde Excel.", stats);
  res.json({ ...comparison, import: stats });
});

app.get("/api/siniestros/pdf/:id", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const id = path.basename(String(req.params.id || ""));
  const file = path.join(CONFIG.siniestrosPdfDir, id);
  if (!id.toLowerCase().endsWith(".pdf") || !fs.existsSync(file)) {
    res.status(404).json({ ok: false, message: "PDF de siniestro no encontrado." });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${id}"`);
  res.sendFile(file);
});

app.get("/api/axa/siniestros/screenshot/:id", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const id = path.basename(String(req.params.id || ""));
  const file = path.join(CONFIG.screenshotsDir, id);
  if (!id.toLowerCase().endsWith(".png") || !id.includes("axa-siniestro") || !fs.existsSync(file)) {
    res.status(404).json({ ok: false, message: "Captura de Siniestros AXA no encontrada." });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.sendFile(file);
});

app.post("/api/siniestros/search", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const folios = Array.isArray(req.body?.folios) ? req.body.folios : [req.body?.folio];
  const ramo = normalizeText(req.body?.ramo || "GMM");
  const otInterna = normalizeText(req.body?.otInterna || "");
  
  const queue = [...new Set(folios.map((folio) => normalizeText(folio)).filter(Boolean))].slice(0, 500);
  if (!queue.length) {
    res.status(400).json({ ok: false, message: "Captura un folio para consultar." });
    return;
  }
  if (runtime.busy) {
    res.status(409).json({ ok: false, busy: true, message: "Ya hay una ejecucion en curso." });
    return;
  }

  void runSiniestros(queue, "manual", { ramo, otInterna });
  res.json({ ok: true, accepted: queue.length });
});

app.post("/api/siniestros/import-excel", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ ok: false, message: "Archivo Excel vacio o no recibido." });
    return;
  }
  if (runtime.busy) {
    res.status(409).json({ ok: false, busy: true, message: "Ya hay una ejecucion en curso." });
    return;
  }

  const folios = parseSiniestrosExcel(req.body);
  if (!folios.length) {
    res.status(400).json({
      ok: false,
      message: "No encontre folios. Usa una columna llamada Folio o coloca los folios en la primera columna.",
    });
    return;
  }

  const queue = folios.slice(0, 500);
  void runSiniestros(queue, "excel");
  res.json({ ok: true, accepted: queue.length });
});

app.post("/api/bitacora", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const user = getRequestUser(req);
  const entry = sanitizeBitacoraEntry(req.body || {});
  applyLoggedUserCapture(entry, user);
  if (user?.role !== "admin") {
    entry.assignedUserId = user.id;
    if (!entry.responsable) {
      entry.responsable = user.display_name || user.username;
    }
  }
  const audit = buildAuditMetaFromRequest(req, "Captura inicial");
  if (!entry.folio && !entry.poliza) {
    res.status(400).json({
      ok: false,
      message: "Captura folio/OT o poliza para guardar la bitacora.",
    });
    return;
  }
  if (!entry.ramo) {
    res.status(400).json({
      ok: false,
      message: "Selecciona el ramo correcto para guardar la bitacora.",
    });
    return;
  }

  const beforeCounts = countBitacoraRecordsForUser(user);
  const existing = findExistingBitacoraEntry(entry);
  let savedEntry = entry;
  let action = "created";

  if (existing) {
    savedEntry = withMonitorSnapshot(sanitizeBitacoraEntry(entry, existing));
    const followupReason = audit.reason && audit.reason !== "Captura inicial"
      ? audit.reason
      : "Nueva pauta agregada al historial";
    appendBitacoraFollowup(existing, savedEntry, {
      ...audit,
      reason: followupReason,
    });
    action = "followup_existing";
  } else {
    insertBitacoraEntry(entry, "create", audit);
  }

  const afterCounts = countBitacoraRecordsForUser(user);
  const items = readBitacoraForRequest(req);
  const comparison = buildBitacoraComparison(items, filterArchivedMonitorRows(runtime.data));
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  writeAuditLog(req, action, "bitacora", existing?.id || entry.id, {
    folio: savedEntry.folio,
    poliza: savedEntry.poliza,
    ramo: savedEntry.ramo,
    otInterna: savedEntry.otInterna,
    capturadoPor: savedEntry.createdByName,
  });
  pushLog("bitacora", action === "created" ? "Registro agregado a bitacora." : "Seguimiento agregado al historial de bitacora.", {
    id: existing?.id || entry.id,
    action,
    folio: savedEntry.folio,
    poliza: savedEntry.poliza,
    ramo: savedEntry.ramo,
    otInterna: savedEntry.otInterna,
    capturadoPor: savedEntry.createdByName,
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
      ramo: savedEntry.ramo,
      otInterna: savedEntry.otInterna,
      capturadoPor: savedEntry.createdByName,
      before: beforeCounts,
      after: afterCounts,
    },
  });
});

app.put("/api/bitacora/:id", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
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
  if (!canAccessBitacoraEntry(getRequestUser(req), previous)) {
    res.status(403).json({ ok: false, message: "No tienes acceso a esta bitacora." });
    return;
  }
  const entry = sanitizeBitacoraEntry(req.body || {}, previous);
  if (!entry.ramo) {
    res.status(400).json({
      ok: false,
      message: "Selecciona el ramo correcto para guardar la bitacora.",
    });
    return;
  }
  if (getRequestUser(req)?.role !== "admin") {
    entry.assignedUserId = previous.assignedUserId || getRequestUser(req).id;
  }
  updateBitacoraEntry(entry, previous, "update", audit);
  const items = readBitacoraForRequest(req);
  const comparison = buildBitacoraComparison(items, filterArchivedMonitorRows(runtime.data));
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  writeAuditLog(req, "update", "bitacora", entry.id, {
    folio: entry.folio,
    poliza: entry.poliza,
    ramo: entry.ramo,
    otInterna: entry.otInterna,
  });
  pushLog("bitacora", "Registro actualizado en bitacora.", {
    id: entry.id,
    folio: entry.folio,
    ramo: entry.ramo,
    otInterna: entry.otInterna,
  });
  res.json(comparison);
});

app.delete("/api/bitacora/:id", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const audit = requireAuditReason(req, res);
  if (!audit) return;

  const current = initDatabase().prepare("SELECT * FROM bitacora WHERE id = ?").get(req.params.id);
  if (!current || !canAccessBitacoraEntry(getRequestUser(req), dbRowToBitacora(current))) {
    res.status(403).json({ ok: false, message: "No tienes acceso a esta bitacora." });
    return;
  }
  const result = archiveBitacoraEntry(req.params.id, audit);
  if (!result.changes) {
    res.status(404).json({ ok: false, message: "Registro de bitacora no encontrado." });
    return;
  }

  const comparison = buildBitacoraComparison(readBitacoraForRequest(req), filterArchivedMonitorRows(runtime.data));
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  writeAuditLog(req, "archive", "bitacora", req.params.id);
  pushLog("bitacora", "Registro archivado en bitacora.", { id: req.params.id });
  res.json(comparison);
});

app.post("/api/bitacora/:id/restore", requireMonitorToken, requireRole("admin", "executive"), (req, res) => {
  const audit = requireAuditReason(req, res);
  if (!audit) return;

  const current = initDatabase().prepare("SELECT * FROM bitacora WHERE id = ?").get(req.params.id);
  if (!current || !canAccessBitacoraEntry(getRequestUser(req), dbRowToBitacora(current))) {
    res.status(403).json({ ok: false, message: "No tienes acceso a esta bitacora." });
    return;
  }
  const result = restoreBitacoraEntry(req.params.id, audit);
  if (!result.changes) {
    res.status(404).json({ ok: false, message: "Registro archivado no encontrado." });
    return;
  }

  const comparison = buildBitacoraComparison(readBitacoraForRequest(req), filterArchivedMonitorRows(runtime.data));
  saveComparisonHistory(comparison);
  writeBitacoraExcel(comparison);
  writeAuditLog(req, "restore", "bitacora", req.params.id);
  pushLog("bitacora", "Registro restaurado en bitacora.", { id: req.params.id });
  res.json(comparison);
});

app.post("/api/run", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  if (runtime.busy) {
    res.json({ ok: false, busy: true, error: "Ya hay una ejecucion en curso." });
    return;
  }

  void runMonitor("manual");
  res.json({ ok: true });
});

app.post("/api/monitor/run-now", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  if (runtime.busy) {
    res.status(409).json({ ok: false, busy: true, message: "Ya hay una ejecucion en curso." });
    return;
  }

  void runMonitor("manual");
  res.json({ ok: true });
});

app.post("/api/session/start-login", requireMonitorToken, requireRole("admin", "executive"), async (_req, res) => {
  const result = await startAssistedLogin().catch((error) => ({
    ok: false,
    message: serializeError(error),
  }));
  res.status(result.busy ? 409 : 200).json(result);
});

app.post("/api/continue-manual-login", requireMonitorToken, requireRole("admin", "executive"), async (_req, res) => {
  const result = await continueAfterManualLogin().catch((error) => ({
    ok: false,
    message: serializeError(error),
  }));
  res.json(result);
});

app.post("/api/session/mark-ready", requireMonitorToken, requireRole("admin", "executive"), async (_req, res) => {
  const result = await continueAfterManualLogin().catch((error) => ({
    ok: false,
    message: serializeError(error),
  }));
  res.json(result);
});

app.post("/api/cancel", requireMonitorToken, requireRole("admin", "executive"), async (_req, res) => {
  const result = await cancelRun().catch((error) => ({
    ok: false,
    message: serializeError(error),
  }));
  res.json(result);
});

app.post("/api/restart-browser", requireMonitorToken, requireRole("admin", "executive"), async (_req, res) => {
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

app.post("/api/monitor/pause", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  runtime.scheduler.paused = true;
  if (runtime.scheduler.timer) {
    clearTimeout(runtime.scheduler.timer);
    runtime.scheduler.timer = null;
  }
  runtime.scheduler.nextTrigger = null;
  pushLog("scheduler", "Monitor automatico pausado.");
  res.json({ ok: true, scheduler: publicSchedulerInfo(runtime.scheduler) });
});

app.post("/api/monitor/resume", requireMonitorToken, requireRole("admin", "executive"), (_req, res) => {
  runtime.scheduler.paused = false;
  scheduleNextAutoRefresh();
  pushLog("scheduler", "Monitor automatico reactivado.");
  res.json({ ok: true, scheduler: publicSchedulerInfo(runtime.scheduler) });
});

function scheduleNextAutoRefresh(delayMs = CONFIG.autoRefreshMinutes * 60 * 1000) {
  if (!runtime.scheduler.enabled || runtime.scheduler.paused || CONFIG.autoRefreshMinutes <= 0) {
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
  writeBitacoraExcel(buildBitacoraComparison(readBitacora(), filterArchivedMonitorRows(runtime.data)));
  scheduleNextAutoRefresh();

  pushLog("system", "Monitor listo.");

  const server = app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`Monitor disponible en http://${CONFIG.host}:${CONFIG.port}`);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `No se pudo iniciar: el puerto ${CONFIG.port} ya esta ocupado. ` +
          `Deten la instancia anterior o cambia PORT en .env.`
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  });
  return server;
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
  hashPassword,
  isAllowedUserRole,
  isLocalHost,
  isTerminada,
  mapItem,
  mergeCurrentMonthWithOpenOlderRows,
  normalizeText,
  parseSiniestrosExcel,
  parseDateForSort,
  publicSessionInfo,
  requireMonitorToken,
  sanitizeBitacoraEntry,
  sanitizeUrlForClient,
  sortRows,
  startServer,
  validateExcelBuffer,
  verifyPassword,
  writeJson,
};
