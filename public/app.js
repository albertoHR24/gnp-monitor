const modeLabels = {
  idle: "Listo",
  booting: "Preparando",
  checking_session: "Revisando sesion",
  auto_login: "Login automatico",
  waiting_manual_login: "Login manual",
  querying: "Consultando",
  siniestros: "Siniestros ED",
  done: "Completado",
  error: "Error",
};

const loadingMessages = {
  booting: "Iniciando navegador...",
  checking_session: "Verificando sesion activa...",
  auto_login: "Intentando login automatico...",
  querying: "Consultando ordenes de trabajo...",
  siniestros: "Consultando Expediente Digital...",
};

const statusPriority = {
  "en proceso": 1,
  activada: 2,
  "en registro": 3,
  rechazada: 4,
  cancelada: 5,
  terminada: 6,
};

// State
let currentPage = 1;
let rowsPerPage = 18;
let filteredData = [];
let allData = [];
let bitacoraData = { items: [], alerts: [], sinBitacora: [], summary: {} };
let siniestrosData = { total: 0, completed: 0, results: [], busy: false };
let axaSiniestrosData = { total: 0, completed: 0, results: [], busy: false };
let axaState = { data: [], diff: null, summary: {}, busy: false, configured: false };
let axaRows = [];
let axaFilteredRows = [];
let axaCurrentPage = 1;
const axaRowsPerPage = 10;
let axaQuickFilter = "all";
let diffData = null;
let expandedBitacoraId = null;
let expandedBitacoraDetailId = null;
const bitacoraHistoryCache = new Map();
const selectedBitacoraHistory = new Map();
let panelVisible = true;
let statusVersion = null;
let hiddenTerminatedCount = 0;
let lastStatusData = null;
let activeUiMode = localStorage.getItem("gnpUiMode") || "operator";
let activeMainView = localStorage.getItem("gnpMainView") || "monitor";
let activeCarrier = localStorage.getItem("gnpCarrier") || (activeMainView === "axa" || activeMainView === "axa-siniestros" ? "axa" : "gnp");
let bitacoraMaximized = false;
let quickFilter = localStorage.getItem("gnpQuickFilter") || "all";
let selectedOt = null;
let carouselTimer = null;
let statusPollTimer = null;
let autoScrollTimer = null;
let lastAlertSignature = "";
let currentUser = null;
let adminMetricsState = { metrics: [], cases: [], users: [] };
let selectedAdminUserId = "";
let activeAdminTab = "users";
let remoteLoginTimer = null;
let remoteImageUrl = null;
let remoteViewBusy = false;
let tvConfig = {
  rowsPerPage: 18,
  pageSeconds: 25,
  hideTerminadas: true,
  staleMinutes: 20,
  soundEnabled: false,
  statusPollSeconds: 10,
  autoScroll: true,
  scrollPixels: 1,
  scrollIntervalMs: 90,
};
let tvOverrides = loadTvOverrides();

function loadTvOverrides() {
  try {
    return JSON.parse(localStorage.getItem("gnpTvOverrides") || "{}");
  } catch {
    return {};
  }
}

function saveTvOverrides() {
  localStorage.setItem("gnpTvOverrides", JSON.stringify(tvOverrides));
}

function applyTvConfig(nextConfig = {}) {
  const previousStatusPollSeconds = tvConfig.statusPollSeconds;
  const previousRowsPerPage = tvConfig.rowsPerPage;
  const previousPageSeconds = tvConfig.pageSeconds;
  const previousAutoScroll = tvConfig.autoScroll;
  const previousScrollPixels = tvConfig.scrollPixels;
  const previousScrollIntervalMs = tvConfig.scrollIntervalMs;
  tvConfig = {
    ...tvConfig,
    ...nextConfig,
    ...tvOverrides,
  };
  rowsPerPage = Number(tvConfig.rowsPerPage) || rowsPerPage;
  if (previousRowsPerPage !== tvConfig.rowsPerPage || previousPageSeconds !== tvConfig.pageSeconds) {
    currentPage = Math.min(currentPage, getTotalPages());
    startCarousel();
  }
  if (!statusPollTimer || previousStatusPollSeconds !== tvConfig.statusPollSeconds) {
    startStatusPolling();
  }
  if (
    !autoScrollTimer ||
    previousAutoScroll !== tvConfig.autoScroll ||
    previousScrollPixels !== tvConfig.scrollPixels ||
    previousScrollIntervalMs !== tvConfig.scrollIntervalMs
  ) {
    startAutoScroll();
  }
  updateTvControls();
}

function getTotalPages() {
  return Math.max(Math.ceil(filteredData.length / rowsPerPage), 1);
}

function isTerminada(row) {
  return normalizeStatus(row.estatus) === "terminada";
}

function isOpenRow(row) {
  return !isTerminada(row);
}

function shouldShowRow(row) {
  if (!tvConfig.hideTerminadas) return true;
  return !isTerminada(row) || isStatusChangedOt(row.ot);
}

function parseGnpDateOnly(value) {
  const text = displayValue(value);
  if (text === "-") return null;

  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return null;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getDueInfo(row) {
  const date = parseGnpDateOnly(row.fechaCompromiso);
  if (!date || Number.isNaN(date.getTime())) {
    return { key: "none", label: "Sin fecha", rank: 4, days: null };
  }

  if (isTerminada(row)) {
    return { key: "closed", label: "Cerrada", rank: 5, days: null };
  }

  const diffDays = Math.round((date.getTime() - startOfToday().getTime()) / 86400000);
  if (diffDays < 0) return { key: "due", label: `${Math.abs(diffDays)} d vencida`, rank: 0, days: diffDays };
  if (diffDays === 0) return { key: "today", label: "Hoy", rank: 1, days: diffDays };
  if (diffDays === 1) return { key: "tomorrow", label: "Manana", rank: 2, days: diffDays };
  return { key: "future", label: `${diffDays} dias`, rank: 3, days: diffDays };
}

function matchesQuickFilter(row) {
  if (activeUiMode === "tv") return true;
  if (quickFilter === "new") return isNewOt(row.ot);
  if (quickFilter === "changed") return isChangedOt(row.ot);
  if (quickFilter === "open") return isOpenRow(row);
  if (quickFilter === "due") return getDueInfo(row).key === "due";
  if (quickFilter === "today") return getDueInfo(row).key === "today";
  return true;
}

function updateTvControls() {
  const terminatedBtn = document.getElementById("toggleTerminatedBtn");
  const scrollBtn = document.getElementById("toggleAutoScrollBtn");
  const soundBtn = document.getElementById("toggleSoundBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  if (terminatedBtn) {
    const value = terminatedBtn.querySelector("strong");
    if (value) value.textContent = tvConfig.hideTerminadas ? "Prioritarios" : "Todos";
    terminatedBtn.classList.toggle("active", !tvConfig.hideTerminadas);
  }
  if (scrollBtn) {
    const value = scrollBtn.querySelector("strong");
    if (value) value.textContent = tvConfig.autoScroll ? "Auto" : "Manual";
    scrollBtn.classList.toggle("active", tvConfig.autoScroll);
  }
  if (soundBtn) {
    const value = soundBtn.querySelector("strong");
    if (value) value.textContent = tvConfig.soundEnabled ? "On" : "Off";
    soundBtn.classList.toggle("active", tvConfig.soundEnabled);
  }
  if (fullscreenBtn) {
    const value = fullscreenBtn.querySelector("strong");
    if (value) value.textContent = document.fullscreenElement ? "Salir" : "Completa";
    fullscreenBtn.classList.toggle("active", Boolean(document.fullscreenElement));
  }
}

function setTvOverride(key, value) {
  tvOverrides[key] = value;
  saveTvOverrides();
  applyTvConfig({});
  applyFilters();
}

function setUiMode(mode) {
  activeUiMode = mode === "tv" ? "tv" : "operator";
  if (activeUiMode === "tv") {
    activeCarrier = "gnp";
    localStorage.setItem("gnpCarrier", activeCarrier);
    activeMainView = "monitor";
    localStorage.setItem("gnpMainView", activeMainView);
    setQuickFilter("all");
  }
  localStorage.setItem("gnpUiMode", activeUiMode);
  document.body.classList.toggle("tv-mode", activeUiMode === "tv");
  document.body.classList.toggle("operator-mode", activeUiMode !== "tv");
  document.getElementById("operatorModeBtn").classList.toggle("active", activeUiMode !== "tv");
  document.getElementById("tvModeBtn").classList.toggle("active", activeUiMode === "tv");
  setMainView(activeMainView);
  currentPage = 1;
  renderTablePage();
  updatePagination();
  startCarousel();
  resetTableScroll(document.getElementById("tableWrap"));
}

function carrierView(module) {
  const selectedModule = module === "siniestros" ? "siniestros" : "monitor";
  if (selectedModule === "siniestros") {
    return activeCarrier === "axa" ? "axa-siniestros" : "siniestros";
  }
  return activeCarrier === "axa" ? "axa" : "monitor";
}

function clearAutofilledSearchInputsForUser() {
  const userTokens = [
    currentUser?.username,
    currentUser?.displayName,
  ]
    .map((value) => normalizeText(value).trim())
    .filter(Boolean);
  if (!userTokens.length) return;

  ["searchInput", "bitSearch", "axaSearchInput"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.autofillChecked === "1" || input.dataset.userEdited === "1") return;
    const value = normalizeText(input.value).trim();
    if (!value || document.activeElement === input) return;
    input.dataset.autofillChecked = "1";
    const looksLikeUserAutofill = userTokens.some((token) =>
      token === value || token.startsWith(value) || value.startsWith(token)
    );
    if (looksLikeUserAutofill) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function setCarrier(carrier) {
  activeCarrier = carrier === "axa" ? "axa" : "gnp";
  localStorage.setItem("gnpCarrier", activeCarrier);
  if (["monitor", "axa"].includes(activeMainView)) {
    setMainView(carrierView("monitor"));
    return;
  }
  if (["siniestros", "axa-siniestros"].includes(activeMainView)) {
    setMainView(carrierView("siniestros"));
    return;
  }
  setMainView(activeMainView);
}

function setMainView(view) {
  const requested = ["axa", "bitacora", "siniestros", "axa-siniestros", "admin"].includes(view) ? view : "monitor";
  activeMainView = activeUiMode !== "tv" ? requested : "monitor";
  if (activeMainView === "admin" && currentUser?.role !== "admin") {
    activeMainView = "monitor";
  }
  if (activeMainView === "axa" || activeMainView === "axa-siniestros") {
    activeCarrier = "axa";
  } else if (activeMainView === "monitor" || activeMainView === "siniestros") {
    activeCarrier = "gnp";
  }
  localStorage.setItem("gnpCarrier", activeCarrier);
  localStorage.setItem("gnpMainView", activeMainView);
  document.body.classList.toggle("carrier-axa", activeCarrier === "axa");
  document.body.classList.toggle("carrier-gnp", activeCarrier !== "axa");
  document.body.classList.toggle("axa-view", activeMainView === "axa");
  document.body.classList.toggle("axa-siniestros-view", activeMainView === "axa-siniestros");
  document.body.classList.toggle("bitacora-view", activeMainView === "bitacora");
  document.body.classList.toggle("siniestros-view", activeMainView === "siniestros");
  document.body.classList.toggle("admin-view", activeMainView === "admin");
  document.body.classList.toggle("monitor-view", activeMainView === "monitor");
  document.getElementById("gnpCarrierBtn")?.classList.toggle("active", activeCarrier !== "axa");
  document.getElementById("axaCarrierBtn")?.classList.toggle("active", activeCarrier === "axa");
  document.getElementById("monitorViewBtn").classList.toggle("active", activeMainView === "monitor" || activeMainView === "axa");
  document.getElementById("bitacoraViewBtn").classList.toggle("active", activeMainView === "bitacora");
  document.getElementById("siniestrosViewBtn").classList.toggle("active", activeMainView === "siniestros" || activeMainView === "axa-siniestros");
  document.getElementById("adminViewBtn").classList.toggle("active", activeMainView === "admin");
  if (activeMainView === "bitacora") {
    renderBitacora();
  }
  if (activeMainView === "siniestros") {
    renderSiniestros();
  }
  if (activeMainView === "axa") {
    renderAxa();
  }
  if (activeMainView === "axa-siniestros") {
    renderAxaSiniestros();
  }
  if (activeMainView === "admin") {
    void refreshAdminMetrics();
  }
}

function setQuickFilter(filter) {
  quickFilter = filter || "all";
  localStorage.setItem("gnpQuickFilter", quickFilter);
  document.querySelectorAll(".quick-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === quickFilter);
  });
  applyFilters();
}

function formatClock(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseDateInputValue(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesSince(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

function clearElement(element) {
  element.textContent = "";
}

function appendCell(row, value, options = {}) {
  const cell = document.createElement("td");
  const text = displayValue(value);
  if (options.className) {
    cell.className = options.className;
  }

  if (options.strong) {
    const strong = document.createElement("strong");
    strong.textContent = text;
    cell.appendChild(strong);
  } else if (options.badgeClass !== undefined) {
    const badge = document.createElement("span");
    badge.className = `badge ${options.badgeClass}`.trim();
    badge.textContent = text;
    cell.appendChild(badge);
  } else {
    cell.textContent = text;
  }

  row.appendChild(cell);
  return cell;
}

function appendPriorityCell(row, sourceRow) {
  const due = getDueInfo(sourceRow);
  const cell = document.createElement("td");
  cell.className = "col-field-prioridad";
  const badge = document.createElement("span");
  badge.className = `priority-badge priority-${due.key}`;
  badge.textContent = due.label;
  cell.appendChild(badge);
  row.appendChild(cell);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function displayValue(value) {
  if (value === undefined || value === null || value === "" || value === "-" || value === "None") return "-";
  return String(value)
    .replace(/DAÂ´s/g, "DA´s")
    .replace(/MÃ©dicos/g, "Médicos")
    .replace(/LÃ­nea/g, "Línea")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ");
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/_/g, " ");
}

function statusRank(value) {
  const status = normalizeStatus(value);
  return statusPriority[status] || 99;
}

function titleCase(value) {
  const text = displayValue(value).replace(/_/g, " ").toLowerCase();
  if (text === "-") return text;
  const accentMap = {
    renovacion: "renovación",
  };
  return text
    .split(" ")
    .map((word) => {
      const fixed = accentMap[word] || word;
      return fixed.charAt(0).toUpperCase() + fixed.slice(1);
    })
    .join(" ");
}

function formatRole(value) {
  const text = normalizeStatus(value);
  const roles = {
    admin: "Admin",
    executive: "Ejecutivo",
    "coordinacion da": "Coordinador Agencia GMM",
    coordinacion_da: "Coordinador Agencia GMM",
    "agente certificado": "Coordinador Agente Certificado GMM",
    agente_certificado: "Coordinador Agente Certificado GMM",
    "coordinador agencia gmm": "Coordinador Agencia GMM",
    "coordinador agente certificado gmm": "Coordinador Agente Certificado GMM",
  };
  if (!text) return "-";
  return roles[text] || titleCase(value);
}

function formatGnpDate(value) {
  const text = displayValue(value);
  if (text === "-") return text;

  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:hrs\.)?)?$/i);
  if (ddmmyyyy) {
    const [, day, month, year, time] = ddmmyyyy;
    const datePart = `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
    return time ? `${datePart} ${time.slice(0, 5)} hrs.` : datePart;
  }

  const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?/);
  if (yyyymmdd) {
    const [, year, month, day, time] = yyyymmdd;
    const datePart = `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
    return time ? `${datePart} ${time} hrs.` : datePart;
  }

  return text;
}

function estatusBadgeClass(value) {
  const text = normalizeText(value);
  if (text.includes("activada")) return "estatus-activada";
  if (text.includes("cancelada")) return "estatus-cancelada";
  if (text.includes("en proceso")) return "estatus-en-proceso";
  if (text.includes("en registro")) return "estatus-en-registro";
  if (text.includes("rechazada")) return "estatus-rechazada";
  if (text.includes("reprocesada")) return "estatus-reprocesada";
  if (text.includes("terminada")) return "estatus-terminada";
  return "";
}

function isNewOt(ot) {
  if (!diffData || !diffData.nuevos) return false;
  return diffData.nuevos.some(row => row.ot === ot);
}

function isChangedOt(ot) {
  if (!diffData || !diffData.cambiados) return false;
  return diffData.cambiados.some(row => row.ot === ot);
}

function isStatusChangedOt(ot) {
  if (!diffData || !diffData.cambiados) return false;
  return diffData.cambiados.some((row) =>
    row.ot === ot && row.changes && row.changes.some((change) => change.field === "estatus")
  );
}

function getStatusChange(ot) {
  if (!diffData || !diffData.cambiados) return null;
  return diffData.cambiados.find((row) =>
    row.ot === ot && row.changes && row.changes.some((change) => change.field === "estatus")
  ) || null;
}

function sortForTv(rows) {
  return [...rows].sort((left, right) => {
    const leftChanged = isStatusChangedOt(left.ot) ? 0 : 1;
    const rightChanged = isStatusChangedOt(right.ot) ? 0 : 1;
    if (leftChanged !== rightChanged) return leftChanged - rightChanged;

    const dueRank = getDueInfo(left).rank - getDueInfo(right).rank;
    if (dueRank !== 0) return dueRank;

    const rank = statusRank(left.estatus) - statusRank(right.estatus);
    if (rank !== 0) return rank;

    return 0;
  });
}

function getOperationalSummary(rows) {
  const openRows = rows.filter(isOpenRow);
  const dueRows = openRows.filter((row) => getDueInfo(row).key === "due");
  const todayRows = openRows.filter((row) => getDueInfo(row).key === "today");
  const changedRows = rows.filter((row) => isChangedOt(row.ot));
  const newRows = rows.filter((row) => isNewOt(row.ot));

  return {
    all: rows.length,
    open: openRows.length,
    due: dueRows.length,
    today: todayRows.length,
    changed: changedRows.length,
    new: newRows.length,
  };
}

function renderOperationalSummary() {
  const summary = getOperationalSummary(allData);
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  };

  setText("quickAllCount", summary.all);
  setText("quickDueCount", summary.due);
  setText("quickTodayCount", summary.today);
  setText("quickOpenCount", summary.open);
  setText("quickChangedCount", summary.changed);
  setText("quickNewCount", summary.new);
  setText("sumVencidas", summary.due);
  setText("sumHoy", summary.today);
}

function diffHasRow(diff, bucket, ot) {
  if (!diff || !Array.isArray(diff[bucket])) return false;
  if (bucket === "cambiados") {
    return diff[bucket].some((item) => item.ot === ot || item.current?.ot === ot);
  }
  return diff[bucket].some((item) => item.ot === ot);
}

function getRowsSummary(rows, diff = null) {
  const openRows = rows.filter(isOpenRow);
  return {
    all: rows.length,
    open: openRows.length,
    due: openRows.filter((row) => getDueInfo(row).key === "due").length,
    today: openRows.filter((row) => getDueInfo(row).key === "today").length,
    changed: rows.filter((row) => diffHasRow(diff, "cambiados", row.ot)).length,
    new: rows.filter((row) => diffHasRow(diff, "nuevos", row.ot)).length,
  };
}

function matchesAxaQuickFilter(row) {
  if (axaQuickFilter === "new") return diffHasRow(axaState.diff, "nuevos", row.ot);
  if (axaQuickFilter === "changed") return diffHasRow(axaState.diff, "cambiados", row.ot);
  if (axaQuickFilter === "open") return isOpenRow(row);
  if (axaQuickFilter === "due") return getDueInfo(row).key === "due";
  if (axaQuickFilter === "today") return getDueInfo(row).key === "today";
  return true;
}

function renderAxa(data = axaState) {
  axaState = {
    ...axaState,
    ...data,
    data: Array.isArray(data.data) ? data.data : axaState.data || [],
    diff: data.diff || axaState.diff,
    summary: data.summary || axaState.summary || {},
  };
  axaRows = axaState.data || [];
  const summary = axaState.summary || {};
  const operational = getRowsSummary(axaRows, axaState.diff);
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  };

  setText("axaClock", formatClock(new Date().toISOString()));
  setText("axaLastUpdate", fmtDate(axaState.lastUpdate));
  setText("axaNextUpdate", axaState.configured ? "Manual" : "Desactivada");
  updateAxaRefreshCountdown();
  setText("axaSessionStatus", axaState.configured ? "Configurada" : "No configurada");
  setText("axaRecordCount", axaRows.length);
  setText("axaTotal", summary.totalActual ?? axaRows.length);
  setText("axaNewCount", summary.nuevos ?? 0);
  setText("axaChangedCount", summary.cambiados ?? 0);
  setText("axaDeletedCount", summary.eliminados ?? 0);
  setText("axaDueCount", operational.due);
  setText("axaTodayCount", operational.today);
  setText("axaStateMessage", axaState.message || "Portal AXA listo para consultar.");
  setText("axaStateSecondary", axaState.error || (axaState.configured ? "Usa Actualizar AXA para leer el historial." : "Configura AXA_URL."));
  setText("axaQuickAllCount", operational.all);
  setText("axaQuickDueCount", operational.due);
  setText("axaQuickTodayCount", operational.today);
  setText("axaQuickOpenCount", operational.open);
  setText("axaQuickChangedCount", operational.changed);
  setText("axaQuickNewCount", operational.new);

  const statusSelect = document.getElementById("axaStatusFilter");
  if (statusSelect) {
    const current = statusSelect.value;
    const statuses = [...new Set(axaRows.map((row) => displayValue(row.estatus)).filter((value) => value !== "-"))].sort();
    statusSelect.innerHTML = '<option value="">Todos los estados AXA</option>';
    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusSelect.appendChild(option);
    });
    statusSelect.value = [...statusSelect.options].some((option) => option.value === current) ? current : "";
  }

  applyAxaFilters();
}

function formatRefreshCountdown(nextTrigger) {
  const next = nextTrigger ? new Date(nextTrigger) : null;
  if (!next || Number.isNaN(next.getTime())) return "";
  const remaining = Math.max(0, Math.ceil((next.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateAxaRefreshCountdown() {
  const axaClock = document.getElementById("axaClock");
  if (axaClock) axaClock.textContent = formatClock();

  const countdown = document.getElementById("axaRefreshCountdown");
  if (!countdown) return;
  const scheduler = lastStatusData?.scheduler;
  if (!scheduler?.enabled || scheduler.paused || !scheduler.nextTrigger) {
    countdown.textContent = "Refresco automatico desactivado";
    return;
  }
  const remaining = formatRefreshCountdown(scheduler.nextTrigger);
  countdown.textContent = remaining ? `Refresca en ${remaining}` : "Refresco automatico desactivado";
}

function applyAxaFilters() {
  const search = normalizeText(document.getElementById("axaSearchInput")?.value || "").trim();
  const status = normalizeText(document.getElementById("axaStatusFilter")?.value || "");
  axaCurrentPage = 1;
  axaFilteredRows = sortForTv(axaRows.filter((row) => {
    if (!matchesAxaQuickFilter(row)) return false;
    if (status && !normalizeText(row.estatus).includes(status)) return false;
    if (search) {
      const searchable = [row.ot, row.poliza, row.contratante, row.tipoSolicitud, row.producto, row.numeroSolicitudes].join(" ");
      if (!normalizeText(searchable).includes(search)) return false;
    }
    return true;
  }));
  renderAxaTable();
}

function renderAxaTable() {
  const list = document.getElementById("axaTbody");
  const panel = document.querySelector(".axa-table-panel");
  const empty = document.getElementById("axaEmptyState");
  if (!list) return;
  clearElement(list);
  setTextContent("axaTableCount", axaFilteredRows.length ? `${axaFilteredRows.length} registros` : `${axaRows.length} registros`);
  panel?.classList.toggle("has-data", axaFilteredRows.length > 0);
  if (empty) empty.style.display = axaFilteredRows.length ? "none" : "flex";

  const totalPages = Math.max(1, Math.ceil(axaFilteredRows.length / axaRowsPerPage));
  axaCurrentPage = Math.min(Math.max(axaCurrentPage, 1), totalPages);
  const start = (axaCurrentPage - 1) * axaRowsPerPage;
  const end = Math.min(start + axaRowsPerPage, axaFilteredRows.length);
  const pageRows = axaFilteredRows.slice(start, end);

  pageRows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "axa-request-item";
    if (diffHasRow(axaState.diff, "nuevos", row.ot)) item.classList.add("row-new");
    if (diffHasRow(axaState.diff, "cambiados", row.ot)) item.classList.add("row-changed");

    const ramo = document.createElement("div");
    ramo.className = "axa-request-branch";
    const icon = document.createElement("div");
    icon.className = "axa-request-icon";
    icon.textContent = "AXA";
    const label = document.createElement("span");
    label.textContent = displayValue(row.producto || "SALUD");
    ramo.append(icon, label);

    const fields = document.createElement("div");
    fields.className = "axa-request-fields";
    [
      ["Nombre del contratante", row.contratante],
      ["Poliza", row.poliza],
      ["Tramite", row.tipoSolicitud],
      ["Fecha Solicitud", row.fechaRegistro],
      ["Estatus", row.estatus],
      ["Folio", row.ot],
      ["Numero de Solicitudes", row.numeroSolicitudes],
    ].forEach(([labelText, value]) => {
      const line = document.createElement("div");
      line.className = "axa-request-line";
      const strong = document.createElement("strong");
      strong.textContent = `${labelText}: `;
      const span = document.createElement("span");
      span.textContent = displayValue(value);
      line.append(strong, span);
      fields.appendChild(line);
    });

    const actions = document.createElement("div");
    actions.className = "axa-request-actions";
    const bitacoraButton = document.createElement("button");
    bitacoraButton.className = "axa-bitacora-btn";
    bitacoraButton.type = "button";
    bitacoraButton.textContent = "Registrar en bitacora";
    bitacoraButton.disabled = !row.ot && !row.poliza;
    bitacoraButton.title = "Precargar esta solicitud AXA en bitacora";
    bitacoraButton.addEventListener("click", () => sendAxaRowToBitacora(row));
    const button = document.createElement("button");
    button.className = "axa-download-btn";
    button.type = "button";
    button.textContent = "Descargar solicitud";
    button.disabled = !row.ot;
    button.title = row.ot ? "Descargar solicitud AXA" : "Folio AXA no disponible";
    if (row.ot) {
      button.addEventListener("click", () => downloadAxaSolicitud(row.ot, button));
    }
    actions.append(bitacoraButton, button);

    item.append(ramo, fields, actions);
    list.appendChild(item);
  });
  updateAxaPagination();
}

function updateAxaPagination() {
  const pagination = document.getElementById("axaPagination");
  const info = document.getElementById("axaPaginationInfo");
  const indicator = document.getElementById("axaPageIndicator");
  const previous = document.getElementById("axaPrevPage");
  const next = document.getElementById("axaNextPage");
  if (!pagination || !info || !indicator || !previous || !next) return;

  const totalPages = Math.max(1, Math.ceil(axaFilteredRows.length / axaRowsPerPage));
  const start = axaFilteredRows.length ? (axaCurrentPage - 1) * axaRowsPerPage + 1 : 0;
  const end = Math.min(axaCurrentPage * axaRowsPerPage, axaFilteredRows.length);
  pagination.classList.toggle("hidden", totalPages <= 1);
  info.textContent = axaFilteredRows.length
    ? `Mostrando ${start}-${end} de ${axaFilteredRows.length} registros`
    : "Mostrando 0 registros";
  indicator.textContent = `${axaCurrentPage} / ${totalPages}`;
  previous.disabled = axaCurrentPage <= 1;
  next.disabled = axaCurrentPage >= totalPages;
}

function normalizeAxaStatusForBitacora(value) {
  const status = normalizeText(value);
  if (status.includes("termin")) return "TERMINADA";
  if (status.includes("rechaz") || status.includes("division")) return "RECHAZADA";
  if (status.includes("cancel")) return "CANCELADA";
  if (status.includes("activ")) return "ACTIVADA";
  if (status.includes("proceso")) return "EN PROCESO";
  return "PENDIENTE";
}

function axaRowToBitacoraEntry(row) {
  return {
    id: "",
    folio: row.ot || "",
    poliza: row.poliza || "",
    cliente: row.contratante || "",
    tramite: displayValue(row.tipoSolicitud) === "-" ? "" : titleCase(row.tipoSolicitud),
    estado: normalizeAxaStatusForBitacora(row.estatus),
    responsable: currentUser?.displayName || "",
    fechaEntrega: normalizeDateForInput(row.fechaRegistro),
    descripcion: ["AXA", row.producto, row.numeroSolicitudes ? `${row.numeroSolicitudes} solicitud(es)` : ""].filter(Boolean).join(" - "),
    comentarios: row.comentarios || "",
    aseguradora: "AXA",
    otInterna: generateOTInterna(),
    ramo: resolveRamoInputValue(row.producto || "SALUD"),
  };
}

function sendAxaRowToBitacora(row) {
  if (!row) return;
  fillBitacoraForm(axaRowToBitacoraEntry(row));
  setMainView("bitacora");
  showBitacoraNotice("Solicitud AXA precargada. Revisa los datos y guarda la bitacora.");
  document.getElementById("bitComentarios")?.focus();
}

async function downloadAxaSolicitud(folio, button) {
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Descargando...";
    }
    const blob = await apiBlob(`/api/axa/solicitud/${encodeURIComponent(folio)}`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `solicitud-axa-${folio}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    renderAxa({
      ...axaState,
      error: error.message || "No se pudo descargar la solicitud AXA.",
    });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Descargar solicitud";
    }
  }
}

function setTextContent(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function applyFilters() {
  const isTvMode = activeUiMode === "tv";
  const searchTerm = isTvMode ? "" : normalizeText(document.getElementById("searchInput").value).trim();
  const statusFilter = isTvMode ? "" : normalizeText(document.getElementById("statusFilter").value);
  renderOperationalSummary();
  hiddenTerminatedCount = tvConfig.hideTerminadas
    ? allData.filter((row) => isTerminada(row) && !isStatusChangedOt(row.ot)).length
    : 0;
  
  filteredData = sortForTv(allData.filter(row => {
    if (!shouldShowRow(row)) return false;
    if (!matchesQuickFilter(row)) return false;

    if (statusFilter) {
      const status = normalizeText(row.estatus);
      if (!status.includes(statusFilter)) return false;
    }
    
    if (searchTerm) {
      const searchable = [
        row.ot,
        row.poliza,
        row.contratante,
        row.agente,
        row.tipoSolicitud,
        row.producto
      ].join(" ");
      
      if (!normalizeText(searchable).includes(searchTerm)) return false;
    }
    
    return true;
  }));
  
  currentPage = 1;
  renderTablePage();
  const tableWrap = document.getElementById("tableWrap");
  if (tableWrap) tableWrap.scrollTop = 0;
  updatePagination();
  renderTvAlerts(diffData);
  renderSelectedDetail();
}

function renderTablePage() {
  const tbody = document.getElementById("tbody");
  const tableWrap = document.getElementById("tableWrap");
  const emptyState = document.getElementById("emptyState");
  const loadingState = document.getElementById("loadingState");
  const emptyTitle = emptyState?.querySelector("h3");
  const emptyDescription = emptyState?.querySelector("p");
  
  clearElement(tbody);
  
  if (loadingState && !loadingState.classList.contains("hidden")) {
    return;
  }
  
  if (!filteredData || !filteredData.length) {
    tableWrap.classList.add("hidden");
    emptyState.style.display = "flex";
    document.getElementById("tableCount").textContent = allData.length
      ? `0 visibles de ${allData.length}`
      : "0 registros";
    if (emptyTitle && emptyDescription) {
      if (allData.length) {
        emptyTitle.textContent = "Sin registros visibles";
        emptyDescription.textContent = activeUiMode === "tv"
          ? "El modo TV esta ocultando registros terminados o sin prioridad."
          : "Ajusta los filtros para ver los registros cargados.";
      } else {
        emptyTitle.textContent = "Sin registros cargados";
        emptyDescription.textContent = 'Haz clic en "Actualizar" para consultar las ordenes de trabajo';
      }
    }
    return;
  }
  
  tableWrap.classList.remove("hidden");
  emptyState.style.display = "none";
  
  const isTvMode = activeUiMode === "tv";
  currentPage = Math.min(Math.max(currentPage, 1), getTotalPages());
  const start = (currentPage - 1) * rowsPerPage;
  const end = Math.min(start + rowsPerPage, filteredData.length);
  const pageData = isTvMode ? filteredData : filteredData.slice(start, end);
  
  document.getElementById("tableCount").textContent = `${filteredData.length} registros`;
  
  pageData.forEach((row) => {
    const tr = document.createElement("tr");
    const badgeClass = estatusBadgeClass(row.estatus);
    const due = getDueInfo(row);
    tr.dataset.ot = row.ot || "";
    tr.classList.toggle("selected", selectedOt && row.ot === selectedOt);
    tr.classList.add(`row-priority-${due.key}`);
    
    if (isNewOt(row.ot)) {
      tr.classList.add("row-new");
    } else if (isChangedOt(row.ot)) {
      tr.classList.add("row-changed");
    }
    if (isStatusChangedOt(row.ot)) {
      tr.classList.add("row-status-changed");
    }
    
    appendCell(tr, row.ot, { strong: true, className: "col-field-ot" });
    appendCell(tr, row.usuarioCreador, { className: "col-field-usuario" });
    appendCell(tr, row.estatus, { badgeClass, className: "col-field-estatus" });
    appendPriorityCell(tr, row);
    appendCell(tr, formatGnpDate(row.fechaCompromiso), { className: "col-field-compromiso" });
    appendCell(tr, row.poliza, { className: "col-field-poliza" });
    appendCell(tr, row.agente, { className: "col-field-agente" });
    appendCell(tr, row.contratante, { className: "col-field-contratante" });
    appendCell(tr, titleCase(row.tipoSolicitud), { className: "col-field-tipo" });
    appendCell(tr, row.producto, { className: "col-field-producto" });
    appendCell(tr, row.guia, { className: "col-field-guia" });
    appendCell(tr, formatGnpDate(row.fechaRegistro), { className: "col-field-registro" });
    appendCell(tr, formatGnpDate(row.primerIngreso), { className: "col-field-primer-ingreso" });
    appendCell(tr, formatGnpDate(row.ultimoIngreso), { className: "col-field-ultimo-ingreso" });
    appendCell(tr, row.medioApertura, { className: "col-field-medio" });
    appendCell(tr, formatRole(row.rol), { className: "col-field-rol" });
    tr.addEventListener("click", () => selectRow(row.ot));
    tr.addEventListener("dblclick", () => sendMonitorRowToBitacora(row));
    tbody.appendChild(tr);
  });
}

function updatePagination() {
  const totalPages = getTotalPages();
  const pagination = document.getElementById("pagination");
  const pageIndicator = document.getElementById("pageIndicator");
  const paginationInfo = document.getElementById("paginationInfo");
  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  const visibleRowsChip = document.getElementById("visibleRowsChip");
  const hiddenChip = document.getElementById("hiddenTerminatedChip");
  
  const isTvMode = activeUiMode === "tv";
  pagination.classList.toggle("hidden", isTvMode || totalPages <= 1);
  
  const start = (currentPage - 1) * rowsPerPage + 1;
  const end = Math.min(currentPage * rowsPerPage, filteredData.length);
  
  paginationInfo.textContent = filteredData.length
    ? isTvMode
      ? `Mostrando ${filteredData.length} registros`
      : `Mostrando ${start}-${end} de ${filteredData.length} registros`
    : "Mostrando 0 registros";
  pageIndicator.textContent = `${currentPage} / ${totalPages}`;
  if (visibleRowsChip) visibleRowsChip.textContent = String(filteredData.length);
  if (hiddenChip) hiddenChip.textContent = String(hiddenTerminatedCount);
  updateHiddenRowsButton();
  
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function updateHiddenRowsButton() {
  const button = document.getElementById("toggleHiddenRowsBtn");
  if (!button) return;

  const terminadas = allData.filter((row) => isTerminada(row) && !isStatusChangedOt(row.ot)).length;
  button.disabled = terminadas === 0;
  button.textContent = tvConfig.hideTerminadas
    ? `Mostrar ocultos (${terminadas})`
    : "Ocultar terminadas";
  button.classList.toggle("active", !tvConfig.hideTerminadas);
}

function startCarousel() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }

  if (activeUiMode === "tv") {
    startAutoScroll();
    return;
  }

  const seconds = Number(tvConfig.pageSeconds) || 0;
  if (seconds >= 5) {
    carouselTimer = setInterval(() => {
      const totalPages = getTotalPages();
      if (totalPages <= 1) return;

      currentPage = currentPage >= totalPages ? 1 : currentPage + 1;
      renderTablePage();
      updatePagination();
      resetTableScroll(document.getElementById("tableWrap"));
    }, seconds * 1000);
  }

  startAutoScroll();
}

function resetTableScroll(tableWrap) {
  if (!tableWrap) return;

  const reset = () => {
    tableWrap.scrollTop = 0;
    tableWrap.scrollLeft = 0;
  };

  reset();
  requestAnimationFrame(reset);
  setTimeout(reset, 60);
  setTimeout(reset, 180);
}

function startAutoScroll() {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }

  if (!tvConfig.autoScroll) {
    return;
  }

  autoScrollTimer = setInterval(() => {
    const tableWrap = document.getElementById("tableWrap");
    if (!tableWrap || tableWrap.classList.contains("hidden")) return;

    const maxScroll = tableWrap.scrollHeight - tableWrap.clientHeight;
    if (maxScroll <= 2) return;

    if (tableWrap.scrollTop >= maxScroll - 8) {
      resetTableScroll(tableWrap);
      return;
    }

    tableWrap.scrollTop += Number(tvConfig.scrollPixels) || 1;
  }, Number(tvConfig.scrollIntervalMs) || 90);
}

function startStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
  }
  statusPollTimer = setInterval(fetchStatus, tvConfig.statusPollSeconds * 1000);
}

function renderLogs(logs) {
  const list = document.getElementById("logList");
  clearElement(list);

  if (!logs || !logs.length) {
    const item = document.createElement("li");
    item.className = "log-item";
    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = "Sin movimientos recientes.";
    item.appendChild(muted);
    list.appendChild(item);
    return;
  }

  logs.slice(0, 8).forEach((entry) => {
    const item = document.createElement("li");
    item.className = "log-item";
    const message = document.createElement("strong");
    message.textContent = entry.message || "-";
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `${entry.step || "paso"} - ${fmtDate(entry.at)}`;
    item.append(message, meta);
    list.appendChild(item);
  });
}

function renderChanges(diff) {
  const box = document.getElementById("changesBox");
  const summary = diff && diff.summary ? diff.summary : null;

  if (!summary) {
    clearElement(box);
    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = "Sin cambios detectados";
    box.appendChild(muted);
    return;
  }

  const totalChanges = (summary.nuevos || 0) + (summary.cambiados || 0) + (summary.eliminados || 0);
  const hasWarnings = Boolean(diff.warnings && diff.warnings.length);
  if (!totalChanges && !hasWarnings) {
    clearElement(box);
    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = "Sin altas, cambios ni bajas";
    box.appendChild(muted);
    return;
  }

  const list = document.createElement("ul");
  list.className = "change-list";

  if (diff.warnings && diff.warnings.length) {
    diff.warnings.slice(0, 2).forEach((warning) => {
      const item = document.createElement("li");
      item.className = "change-item";
      item.style.borderLeftColor = "#f59e0b";
      const titleEl = document.createElement("strong");
      titleEl.textContent = "Advertencia";
      const detail = document.createElement("span");
      detail.className = "muted";
      detail.textContent = warning.message || "Hay datos que requieren revision";
      item.append(titleEl, detail);
      list.appendChild(item);
    });
  }

  const addItem = (title, items, color) => {
    if (!items || !items.length) return;
    const item = document.createElement("li");
    item.className = "change-item";
    item.style.borderLeftColor = color;
    const ots = items.slice(0, 3).map(r => r.ot).join(", ");
    const more = items.length > 3 ? ` (+${items.length - 3} mas)` : "";
    const titleEl = document.createElement("strong");
    titleEl.textContent = title;
    const detail = document.createElement("span");
    detail.className = "muted";
    detail.textContent = `${ots}${more}`;
    item.append(titleEl, detail);
    list.appendChild(item);
  };

  addItem(`${summary.nuevos} Nuevos`, diff.nuevos, "#22c55e");
  addItem(`${summary.cambiados} Cambiados`, diff.cambiados, "#6366f1");
  addItem(`${summary.eliminados} Eliminados`, diff.eliminados, "#ef4444");

  clearElement(box);
  box.appendChild(list);
}

function getBitacoraPayload() {
  const otInterna = document.getElementById("bitOTInterna").value || generateOTInterna();
  const ramo = resolveRamoInputValue(document.getElementById("bitRamo").value);
  return {
    id: document.getElementById("bitId").value,
    folio: document.getElementById("bitFolio").value,
    poliza: document.getElementById("bitPoliza").value,
    cliente: document.getElementById("bitCliente").value,
    tramite: document.getElementById("bitTramite").value,
    estado: document.getElementById("bitEstado").value,
    responsable: document.getElementById("bitResponsable").value,
    otInterna,
    ot_interna: otInterna,
    fechaEntrega: document.getElementById("bitEntrega").value,
    ramo,
    descripcion: document.getElementById("bitDescripcion").value,
    comentarios: document.getElementById("bitComentarios").value,
    aseguradora: document.getElementById("bitAseguradora").value,
  };
}

function getOperatorName() {
  return currentUser?.displayName || currentUser?.username || "Operador local";
}

function generateOTInterna() {
  // Genera OT interna rastreable: OT-YYMMDD-XXXXX
  // Ejemplo: OT-260603-00001
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const timestamp = now.getTime();
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
  return `OT-${year}${month}${day}-${random}`;
}

function inferRamoFromMonitorRow(row = {}) {
  const source = normalizeText([
    row.ramo,
    row.rol,
    row.producto,
    row.tipoSolicitud,
    row.workflow,
  ].filter(Boolean).join(" "));
  if (source.includes("gmm") || source.includes("gastos medicos")) return findRamoOptionValue("gmm");
  if (source.includes("vida")) return findRamoOptionValue("vida");
  if (source.includes("auto")) return findRamoOptionValue("auto");
  if (source.includes("dano") || source.includes("da?o")) return findRamoOptionValue("dan");
  return "";
}

function findRamoOptionValue(key) {
  const select = document.getElementById("bitRamo");
  const normalizedKey = normalizeText(key);
  const options = Array.from(select?.options || []);
  const option = options.find((item) => {
    const value = normalizeText(`${item.value} ${item.textContent}`);
    return item.value && value.includes(normalizedKey);
  });
  return option?.value || "";
}

function resolveRamoInputValue(value) {
  const normalized = normalizeText(fixMojibakeText(value));
  if (!normalized) return "";
  if (normalized.includes("gmm") || normalized.includes("gastos medicos") || normalized.includes("salud")) return findRamoOptionValue("gmm");
  if (normalized.includes("vida")) return findRamoOptionValue("vida");
  if (normalized.includes("auto")) return findRamoOptionValue("auto");
  if (normalized.includes("dan") || normalized.includes("dano") || normalized.includes("da?o")) return findRamoOptionValue("dan");
  return value;
}

function fixMojibakeText(value) {
  return String(value || "")
    .replace(/ÃƒÂ±|Ã±/g, "ñ")
    .replace(/ÃƒÂ©|Ã©/g, "é")
    .replace(/ÃƒÂ¡|Ã¡/g, "á")
    .replace(/ÃƒÂ­|Ã­/g, "í")
    .replace(/ÃƒÂ³|Ã³/g, "ó")
    .replace(/ÃƒÂº|Ãº/g, "ú");
}

function askChangeReason(action) {
  const reason = window.prompt(`Motivo para ${action}`);
  return reason ? reason.trim() : "";
}

function withAuditPayload(payload, reason) {
  return {
    ...payload,
    reason,
    changedBy: getOperatorName(),
  };
}

function showBitacoraNotice(message, type = "success") {
  const notice = document.getElementById("bitacoraNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.remove("hidden", "error");
  notice.classList.toggle("error", type === "error");
}

function clearBitacoraFilters() {
  const search = document.getElementById("bitSearch");
  const filter = document.getElementById("bitFilter");
  const dateFrom = document.getElementById("bitDateFrom");
  const dateTo = document.getElementById("bitDateTo");
  if (search) search.value = "";
  if (filter) filter.value = "";
  if (dateFrom) dateFrom.value = "";
  if (dateTo) dateTo.value = "";
}

function describeBitacoraSave(data) {
  const save = data?.save;
  if (!save) {
    const total = data?.summary?.total ?? data?.items?.length ?? 0;
    return `Registro guardado. Bitacora actual: ${total} registros.`;
  }

  const before = Number(save.before?.active ?? 0);
  const after = Number(save.after?.active ?? 0);
  const key = [save.folio, save.poliza].filter(Boolean).join(" / ");

  if (save.action === "updated_existing") {
    return `Ya existia en bitacora (${key}). Actualice ese registro; el total se mantiene en ${after}.`;
  }
  if (save.action === "followup_existing") {
    return `Nueva pauta agregada al historial de ${key}. El registro base no se modifico.`;
  }

  return `Registro nuevo guardado (${key}). Bitacora: ${before} -> ${after} registros.`;
}

function resetBitacoraForm() {
  document.getElementById("bitacoraForm").reset();
  document.getElementById("bitId").value = "";
  document.getElementById("bitOTInterna").value = generateOTInterna();
  document.getElementById("bitResponsable").value = currentUser?.displayName || "";
  document.getElementById("bitCancelEdit").classList.add("hidden");
  document.getElementById("bitSaveBtn").textContent = "Guardar";
}

function normalizeDateForInput(value) {
  const text = displayValue(value);
  if (text === "-") return "";
  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "";
}

function monitorRowToBitacoraEntry(row) {
  return {
    id: "",
    folio: row.ot || "",
    poliza: row.poliza || "",
    cliente: row.contratante || "",
    tramite: displayValue(row.tipoSolicitud) === "-" ? "" : titleCase(row.tipoSolicitud),
    estado: displayValue(row.estatus).toUpperCase() === "-" ? "PENDIENTE" : displayValue(row.estatus).toUpperCase(),
    responsable: row.usuarioCreador || "",
    fechaEntrega: normalizeDateForInput(row.fechaCompromiso),
    descripcion: [row.producto, row.guia && row.guia !== "-" ? `Guia ${row.guia}` : ""].filter(Boolean).join(" - "),
    comentarios: "",
    aseguradora: "GNP",
    otInterna: generateOTInterna(),
    ramo: inferRamoFromMonitorRow(row),
  };
}

function sendMonitorRowToBitacora(row) {
  if (!row) return;
  fillBitacoraForm(monitorRowToBitacoraEntry(row));
  setMainView("bitacora");
  showBitacoraNotice("Datos del monitor precargados. Completa los campos faltantes y guarda.");
  document.getElementById("bitComentarios")?.focus();
}

function findSinBitacoraRow(alertItem) {
  const alertOt = normalizeBitacoraKey(alertItem.ot);
  return bitacoraData.sinBitacora.find((row) => normalizeBitacoraKey(row.ot) === alertOt) || null;
}

function findBitacoraItemById(id) {
  const allItems = [
    ...(Array.isArray(bitacoraData.items) ? bitacoraData.items : []),
    ...(Array.isArray(bitacoraData.archived) ? bitacoraData.archived : []),
  ];
  return allItems.find((item) => item.id === id) || null;
}

function followupBitacoraItem(item) {
  if (!item) return;
  fillBitacoraForm({
    ...item,
    id: "",
    comentarios: "",
  });
  document.getElementById("bitSaveBtn").textContent = "Agregar al historial";
  setMainView("bitacora");
  showBitacoraNotice("Caso cargado como nuevo seguimiento. Al guardar se agregara al historial sin modificar el registro base.");
  document.getElementById("bitComentarios")?.focus();
}

function fillBitacoraForm(entry) {
  document.getElementById("bitId").value = entry.id || "";
  document.getElementById("bitFolio").value = entry.folio || "";
  document.getElementById("bitPoliza").value = entry.poliza || "";
  document.getElementById("bitCliente").value = entry.cliente || "";
  document.getElementById("bitTramite").value = entry.tramite || "";
  document.getElementById("bitEstado").value = entry.estado || "PENDIENTE";
  document.getElementById("bitResponsable").value = entry.responsable || currentUser?.displayName || "";
  document.getElementById("bitOTInterna").value = entry.otInterna || entry.ot_interna || generateOTInterna();
  document.getElementById("bitEntrega").value = entry.fechaEntrega || "";
  document.getElementById("bitRamo").value = resolveRamoInputValue(entry.ramo);
  document.getElementById("bitDescripcion").value = entry.descripcion || "";
  document.getElementById("bitComentarios").value = entry.comentarios || "";
  document.getElementById("bitAseguradora").value = entry.aseguradora || "";
  document.getElementById("bitCancelEdit").classList.remove("hidden");
  document.getElementById("bitFolio").focus();
}

function seguimientoClass(item) {
  const severity = item && item.seguimiento ? item.seguimiento.severity : "warning";
  if (severity === "danger") return "seguimiento-danger";
  if (severity === "ok") return "seguimiento-ok";
  return "seguimiento-warning";
}

function formatMatchBy(value) {
  if (value === "folio") return "Folio / OT";
  if (value === "poliza") return "Poliza";
  return "Sin coincidencia";
}

function normalizeBitacoraKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function bitacoraCaseKey(item) {
  const folio = normalizeBitacoraKey(item.folio || item.monitor?.ot);
  if (folio) return `folio:${folio}`;
  const poliza = normalizeBitacoraKey(item.poliza || item.monitor?.poliza);
  if (poliza) return `poliza:${poliza}`;
  return `id:${item.id}`;
}

function collapseBitacoraDuplicates(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = bitacoraCaseKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  return Array.from(groups.values()).map((group) => {
    const [primary, ...duplicates] = group;
    return {
      ...primary,
      duplicateCount: group.length,
      duplicateItems: duplicates,
    };
  });
}

function sameDisplayValue(left, right) {
  return normalizeText(displayValue(left)) === normalizeText(displayValue(right));
}

function bitacoraComparisonRows(item) {
  const monitor = item.monitor || {};
  return [
    { label: "Estado", manual: item.estado, monitor: monitor.estatus },
  ].map((row) => {
    const manual = displayValue(row.manual);
    const monitorValue = displayValue(row.monitor);
    const status = monitorValue === "-"
      ? "missing"
      : sameDisplayValue(manual, monitorValue)
        ? "match"
        : "diff";
    return { ...row, manual, monitor: monitorValue, status };
  });
}

function historySnapshotItem(item) {
  const selectedId = selectedBitacoraHistory.get(item.id);
  const history = bitacoraHistoryCache.get(item.id)?.history || [];
  const selected = history.find((entry) => String(entry.id) === String(selectedId));
  if (!selected?.after) {
    return { item, selected: null };
  }
  return {
    selected,
    item: {
      ...item,
      ...selected.after,
      id: item.id,
      ramo: selected.after.ramo || item.ramo || "",
      otInterna: selected.after.otInterna || selected.after.ot_interna || item.otInterna || "",
      monitor: Object.prototype.hasOwnProperty.call(selected.after, "monitor") ? selected.after.monitor : item.monitor,
      matchBy: Object.prototype.hasOwnProperty.call(selected.after, "matchBy") ? selected.after.matchBy : item.matchBy,
      seguimiento: item.seguimiento,
      historyCount: item.historyCount,
      archivedAt: item.archivedAt,
    },
  };
}

function renderBitacoraDetailRow(item) {
  const row = document.createElement("tr");
  row.className = "bitacora-detail-row";
  const cell = document.createElement("td");
  cell.colSpan = 15;

  const box = document.createElement("div");
  box.className = "bitacora-detail-box";

  const header = document.createElement("div");
  header.className = "bitacora-detail-header";
  const snapshot = historySnapshotItem(item);
  const comparisonItem = snapshot.item;
  const title = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = `Comparativa ${displayValue(item.monitor?.ot || item.folio || item.poliza)}`;
  const sub = document.createElement("span");
  sub.textContent = snapshot.selected
    ? `Version seleccionada v${snapshot.selected.version} - ${bitacoraActionLabel(snapshot.selected.action)} contra monitor GNP`
    : item.monitor
      ? `Coincidencia por ${formatMatchBy(comparisonItem.matchBy).toLowerCase()}`
    : "No hay captura del monitor para este registro";
  title.append(heading, sub);
  header.appendChild(title);

  if (item.duplicateCount > 1) {
    const duplicateBadge = document.createElement("span");
    duplicateBadge.className = "duplicate-badge";
    duplicateBadge.textContent = `${item.duplicateCount} registros del mismo caso`;
    header.appendChild(duplicateBadge);
  }
  box.appendChild(header);

  const comparison = document.createElement("div");
  comparison.className = "comparison-grid";
  const comparisonHeader = document.createElement("div");
  comparisonHeader.className = "comparison-row comparison-header";
  const emptyHeader = document.createElement("span");
  emptyHeader.textContent = "Campo";
  const manualHeader = document.createElement("strong");
  manualHeader.textContent = "Bitacora";
  const monitorHeader = document.createElement("strong");
  monitorHeader.textContent = "Monitor GNP";
  comparisonHeader.append(emptyHeader, manualHeader, monitorHeader);
  comparison.appendChild(comparisonHeader);
  bitacoraComparisonRows(comparisonItem).forEach((field) => {
    const line = document.createElement("div");
    line.className = `comparison-row comparison-${field.status}`;
    const label = document.createElement("span");
    label.textContent = field.label;
    const manual = document.createElement("strong");
    manual.textContent = field.manual;
    const monitor = document.createElement("strong");
    monitor.textContent = field.monitor;
    line.append(label, manual, monitor);
    comparison.appendChild(line);
  });
  box.appendChild(comparison);

  // Mostrar datos completos de la Bitacora
  const bitacoraDataBox = document.createElement("div");
  bitacoraDataBox.className = "comparison-grid bitacora-data-box";
  const bitacoraDataHeader = document.createElement("div");
  bitacoraDataHeader.className = "comparison-row comparison-header";
  const bitacoraHeaderLabel = document.createElement("span");
  bitacoraHeaderLabel.textContent = "Datos de Bitacora";
  const bitacoraHeaderValue = document.createElement("strong");
  bitacoraHeaderValue.textContent = "Valor";
  bitacoraDataHeader.append(bitacoraHeaderLabel, bitacoraHeaderValue);
  bitacoraDataBox.appendChild(bitacoraDataHeader);

  const bitacoraFields = [
    { label: "Folio / OT", value: comparisonItem.folio },
    { label: "Póliza", value: comparisonItem.poliza },
    { label: "Cliente", value: comparisonItem.cliente },
    { label: "Trámite", value: comparisonItem.tramite },
    { label: "Responsable", value: comparisonItem.responsable },
    { label: "Capturado por", value: comparisonItem.createdByName },
    { label: "Entrega", value: formatGnpDate(comparisonItem.fechaEntrega) },
    { label: "Ramo", value: comparisonItem.ramo },
    { label: "OT Interna", value: comparisonItem.otInterna || comparisonItem.ot_interna },
    { label: "Descripción", value: comparisonItem.descripcion },
    { label: "Comentarios", value: comparisonItem.comentarios },
    { label: "Aseguradora", value: comparisonItem.aseguradora },
  ];

  bitacoraFields.forEach((field) => {
    const fieldLine = document.createElement("div");
    fieldLine.className = "comparison-row";
    const fieldLabel = document.createElement("span");
    fieldLabel.textContent = field.label;
    const fieldValue = document.createElement("strong");
    fieldValue.textContent = displayValue(field.value);
    fieldLine.append(fieldLabel, fieldValue);
    bitacoraDataBox.appendChild(fieldLine);
  });

  box.appendChild(bitacoraDataBox);

  if (item.duplicateItems?.length) {
    const duplicates = document.createElement("div");
    duplicates.className = "duplicate-list";
    const duplicateTitle = document.createElement("strong");
    duplicateTitle.textContent = "Duplicados detectados";
    duplicates.appendChild(duplicateTitle);
    item.duplicateItems.forEach((duplicate) => {
      const duplicateLine = document.createElement("span");
      duplicateLine.textContent = `v${duplicate.version || 1} - ${fmtDate(duplicate.updatedAt)} - ${displayValue(duplicate.comentarios || duplicate.estado)}`;
      duplicates.appendChild(duplicateLine);
    });
    box.appendChild(duplicates);
  }

  box.appendChild(renderBitacoraHistoryBox(item));
  cell.appendChild(box);
  row.appendChild(cell);
  return row;
}

function renderBitacoraAlerts(alerts) {
  const box = document.getElementById("bitacoraAlerts");
  if (!box) return;
  clearElement(box);

  if (!alerts || !alerts.length) {
    const item = document.createElement("div");
    item.className = "bitacora-alert";
    const title = document.createElement("strong");
    title.textContent = "Sin alertas";
    const detail = document.createElement("span");
    detail.textContent = "La bitacora va al corriente con el monitor.";
    item.append(title, detail);
    box.appendChild(item);
    return;
  }

  alerts.slice(0, 8).forEach((alertItem) => {
    const item = document.createElement("div");
    item.className = `bitacora-alert ${alertItem.severity === "danger" ? "danger" : ""}`.trim();
    const title = document.createElement("strong");
    title.textContent = alertItem.title || "Alerta";
    const detail = document.createElement("span");
    detail.textContent = alertItem.message || "Requiere seguimiento.";
    item.append(title, detail);

    const monitorRow = alertItem.type === "sin_bitacora" ? findSinBitacoraRow(alertItem) : null;
    const bitacoraItem = alertItem.entryId ? findBitacoraItemById(alertItem.entryId) : null;
    const action = monitorRow
      ? () => sendMonitorRowToBitacora(monitorRow)
      : bitacoraItem
        ? () => followupBitacoraItem(bitacoraItem)
        : null;

    if (action) {
      item.classList.add("clickable");
      item.title = monitorRow
        ? "Precargar esta OT en la bitacora"
        : "Agregar seguimiento al historial de este caso";
      item.tabIndex = 0;
      item.addEventListener("click", action);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          action();
        }
      });
    }
    box.appendChild(item);
  });
}

function renderBitacora(data = bitacoraData) {
  bitacoraData = {
    items: Array.isArray(data.items) ? data.items : [],
    archived: Array.isArray(data.archived) ? data.archived : [],
    alerts: Array.isArray(data.alerts) ? data.alerts : [],
    sinBitacora: Array.isArray(data.sinBitacora) ? data.sinBitacora : [],
    summary: data.summary || {},
    db: data.db || null,
  };

  const summary = bitacoraData.summary || {};
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || 0);
  };

  setText("bitTotal", summary.total);
  setText("bitCorriente", summary.al_corriente);
  setText("bitVencidas", summary.vencida);
  setText("bitInconsistentes", summary.inconsistente);
  setText("bitSinMonitor", summary.sin_monitor);
  setText("bitSinBitacora", summary.sin_bitacora);
  const meta = document.getElementById("bitacoraMeta");
  if (meta) {
    const active = bitacoraData.db?.active ?? summary.total ?? 0;
    const archived = bitacoraData.db?.archived ?? bitacoraData.archived.length ?? 0;
    meta.textContent = archived
      ? `${active} activos / ${archived} archivados`
      : `${active} registros manuales`;
  }

  renderBitacoraAlerts(bitacoraData.alerts);

  const tbody = document.getElementById("bitacoraTbody");
  clearElement(tbody);

  const search = normalizeText(document.getElementById("bitSearch").value).trim();
  const filter = document.getElementById("bitFilter").value;
  const dateFrom = parseDateInputValue(document.getElementById("bitDateFrom").value);
  const dateTo = parseDateInputValue(document.getElementById("bitDateTo").value, true);
  const sourceItems = filter === "archived" ? bitacoraData.archived : bitacoraData.items;
  const filteredItems = sourceItems.filter((item) => {
    if (filter !== "archived" && filter && item.seguimiento && item.seguimiento.key !== filter) return false;
    const updatedAt = item.updatedAt ? new Date(item.updatedAt) : null;
    if (dateFrom && updatedAt && updatedAt < dateFrom) return false;
    if (dateTo && updatedAt && updatedAt > dateTo) return false;
    if (!search) return true;
    const text = [
      item.folio,
      item.poliza,
      item.cliente,
      item.tramite,
      item.estado,
      item.responsable,
      item.createdByName,
      item.comentarios,
      item.monitor && item.monitor.ot,
      item.monitor && item.monitor.poliza,
      item.monitor && item.monitor.contratante,
      item.monitor && item.monitor.estatus,
    ].join(" ");
    return normalizeText(text).includes(search);
  });
  const items = collapseBitacoraDuplicates(filteredItems);

  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 15;
    cell.textContent = "Sin registros de bitacora para mostrar.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");
    row.className = "bitacora-clickable-row";
    row.addEventListener("click", () => toggleBitacoraDetail(item.id));
    const seguimiento = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `seguimiento-badge ${seguimientoClass(item)}`;
    badge.textContent = item.seguimiento ? item.seguimiento.label : "Pendiente";
    seguimiento.appendChild(badge);
    row.appendChild(seguimiento);

    const caseCell = appendCell(row, item.monitor && item.monitor.ot ? item.monitor.ot : item.folio, { strong: true });
    if (item.duplicateCount > 1) {
      const count = document.createElement("span");
      count.className = "duplicate-count";
      count.textContent = `x${item.duplicateCount}`;
      caseCell.appendChild(count);
    }
    appendCell(row, formatMatchBy(item.matchBy));
    appendCell(row, item.poliza);
    appendCell(row, item.monitor && item.monitor.poliza);
    appendCell(row, item.cliente || (item.monitor && item.monitor.contratante));
    appendCell(row, item.tramite);
    appendCell(row, item.estado);
    appendCell(row, item.monitor ? item.monitor.estatus : "Sin captura");
    appendCell(row, item.responsable);
    appendCell(row, item.createdByName);
    appendCell(row, formatGnpDate(item.fechaEntrega || (item.monitor && item.monitor.fechaCompromiso)));
    appendCell(row, item.comentarios);
    appendCell(row, `v${item.version || 1} - ${fmtDate(item.updatedAt)}`);

    const actions = document.createElement("td");
    const wrapper = document.createElement("div");
    wrapper.className = "bitacora-actions-cell";
    const history = document.createElement("button");
    history.className = "bitacora-mini-btn";
    history.type = "button";
    history.setAttribute("aria-label", `Ver historial (${item.historyCount || item.version || 1})`);
    history.dataset.tooltip = expandedBitacoraDetailId === item.id ? "Ocultar historial y comparativa" : "Ver historial y comparativa";
    history.textContent = expandedBitacoraDetailId === item.id ? "Ocult." : `Hist. ${item.historyCount || item.version || 1}`;
    history.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleBitacoraDetail(item.id);
    });
    const edit = document.createElement("button");
    edit.className = "bitacora-mini-btn";
    edit.type = "button";
    edit.setAttribute("aria-label", "Agregar seguimiento");
    edit.dataset.tooltip = "Agregar seguimiento al historial";
    edit.textContent = "Seg.";
    edit.disabled = Boolean(item.archivedAt);
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      followupBitacoraItem(item);
    });
    const archive = document.createElement("button");
    archive.className = "bitacora-mini-btn";
    archive.type = "button";
    archive.setAttribute("aria-label", item.archivedAt ? "Restaurar registro archivado" : "Archivar y ocultar del monitor");
    archive.dataset.tooltip = item.archivedAt ? "Restaurar registro archivado" : "Archivar y ocultar del monitor";
    archive.textContent = item.archivedAt ? "Rest." : "Arch.";
    archive.addEventListener("click", (event) => {
      event.stopPropagation();
      if (item.archivedAt) {
        restoreBitacoraEntry(item.id);
      } else {
        archiveBitacoraEntry(item.id);
      }
    });
    wrapper.append(history, edit, archive);
    actions.appendChild(wrapper);
    row.appendChild(actions);
    if (item.archivedAt) {
      row.classList.add("archived-row");
    }
    tbody.appendChild(row);

    if (expandedBitacoraDetailId === item.id) {
      tbody.appendChild(renderBitacoraDetailRow(item));
    }
  });
}

function bitacoraActionLabel(action) {
  return {
    create: "Creacion",
    import: "Importacion",
    migrate: "Migracion",
    followup: "Seguimiento",
    update: "Edicion",
    archive: "Archivado",
    restore: "Restaurado",
  }[action] || titleCase(action);
}

function summarizeHistoryChange(item) {
  if (!item.before || !item.after) {
    return item.after ? "Registro inicial capturado automaticamente." : "Sin detalle.";
  }
  const labels = {
    folio: "Folio / OT",
    poliza: "Poliza",
    cliente: "Cliente",
    tramite: "Tramite",
    estado: "Estado",
    responsable: "Responsable",
    fechaEntrega: "Entrega",
    fechaSalida: "Salida",
    comentarios: "Comentarios",
    archivedAt: "Archivado",
  };
  const changes = Object.keys(labels)
    .filter((key) => displayValue(item.before[key]) !== displayValue(item.after[key]))
    .map((key) => `${labels[key]}: "${displayValue(item.before[key])}" -> "${displayValue(item.after[key])}"`);
  return changes.length ? changes.join("; ") : "Sin cambios visibles en campos principales.";
}

function renderBitacoraHistoryBox(item) {
  const box = document.createElement("div");
  box.className = "bitacora-history-box";
  const cached = bitacoraHistoryCache.get(item.id);

  if (!cached) {
    box.textContent = "Cargando historial...";
  } else if (!cached.history.length) {
    box.textContent = "Sin historial registrado.";
  } else {
    cached.history.forEach((entry) => {
      const line = document.createElement("button");
      line.className = "bitacora-history-item";
      if (String(selectedBitacoraHistory.get(item.id)) === String(entry.id)) {
        line.classList.add("active");
      }
      line.type = "button";
      const title = document.createElement("strong");
      title.textContent = `v${entry.version} - ${bitacoraActionLabel(entry.action)} - ${fmtDate(entry.changedAt)} - ${entry.changedBy || "Sistema"}`;
      const detail = document.createElement("span");
      detail.textContent = [entry.reason, summarizeHistoryChange(entry)].filter(Boolean).join(" | ");
      line.append(title, detail);
      line.addEventListener("click", () => {
        selectedBitacoraHistory.set(item.id, entry.id);
        renderBitacora();
      });
      box.appendChild(line);
    });
  }

  return box;
}

async function toggleBitacoraDetail(id) {
  expandedBitacoraDetailId = expandedBitacoraDetailId === id ? null : id;
  expandedBitacoraId = expandedBitacoraDetailId;
  renderBitacora();
  if (!expandedBitacoraDetailId || bitacoraHistoryCache.has(id)) {
    return;
  }

  try {
    const data = await apiJson(`/api/bitacora/${encodeURIComponent(id)}/history`);
    bitacoraHistoryCache.set(id, data);
    if (!selectedBitacoraHistory.has(id) && data.history?.[0]) {
      selectedBitacoraHistory.set(id, data.history[0].id);
    }
    renderBitacora();
  } catch (error) {
    bitacoraHistoryCache.set(id, { ok: true, history: [] });
    renderBitacora();
    console.warn("No pude cargar historial:", error);
  }
}

async function saveBitacoraEntry(event) {
  event.preventDefault();
  const payload = getBitacoraPayload();
  if (!payload.folio && !payload.poliza) {
    showBitacoraNotice("Captura folio/OT o poliza para poder comparar con el monitor.", "error");
    return;
  }
  if (!payload.ramo) {
    showBitacoraNotice("Selecciona el ramo correcto antes de guardar.", "error");
    document.getElementById("bitRamo")?.focus();
    return;
  }

  const saveButton = document.getElementById("bitSaveBtn");
  const previousSaveText = saveButton ? saveButton.textContent : "";
  let saveCompleted = false;
  try {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Guardando...";
    }
    const id = payload.id;
    const reason = id ? askChangeReason("guardar la modificacion") : "Captura inicial";
    if (id && !reason) return;
    const data = await apiJson(id ? `/api/bitacora/${encodeURIComponent(id)}` : "/api/bitacora", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(withAuditPayload(payload, reason)),
    });
    const savedId = data?.save?.id || id;
    if (savedId) bitacoraHistoryCache.delete(savedId);
    clearBitacoraFilters();
    resetBitacoraForm();
    if (data?.save?.action === "followup_existing" && savedId) {
      expandedBitacoraDetailId = savedId;
      expandedBitacoraId = savedId;
      selectedBitacoraHistory.delete(savedId);
    }
    renderBitacora(data);
    if (data?.save?.action === "followup_existing" && savedId) {
      try {
        const history = await apiJson(`/api/bitacora/${encodeURIComponent(savedId)}/history`);
        bitacoraHistoryCache.set(savedId, history);
        const latest = history.history?.[0];
        if (latest) selectedBitacoraHistory.set(savedId, latest.id);
        renderBitacora();
      } catch (historyError) {
        bitacoraHistoryCache.set(savedId, { ok: true, history: [] });
        renderBitacora();
        console.warn("No pude cargar historial:", historyError);
      }
    }
    showBitacoraNotice(describeBitacoraSave(data));
    saveCompleted = true;
  } catch (error) {
    showBitacoraNotice(`No se guardo: ${error.message}`, "error");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = saveCompleted ? "Guardar" : previousSaveText || "Guardar";
    }
  }
}

async function archiveBitacoraEntry(id) {
  if (!id) return;
  const reason = askChangeReason("archivar este registro");
  if (!reason) return;
  try {
    const data = await apiJson(`/api/bitacora/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify(withAuditPayload({}, reason)),
    });
    if (expandedBitacoraId === id) expandedBitacoraId = null;
    if (expandedBitacoraDetailId === id) expandedBitacoraDetailId = null;
    bitacoraHistoryCache.delete(id);
    renderBitacora(data);
    showBitacoraNotice("Registro archivado.");
  } catch (error) {
    showBitacoraNotice(`No se archivo: ${error.message}`, "error");
  }
}

async function restoreBitacoraEntry(id) {
  if (!id) return;
  const reason = askChangeReason("restaurar este registro");
  if (!reason) return;
  try {
    const data = await apiJson(`/api/bitacora/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: JSON.stringify(withAuditPayload({}, reason)),
    });
    if (expandedBitacoraId === id) expandedBitacoraId = null;
    if (expandedBitacoraDetailId === id) expandedBitacoraDetailId = null;
    bitacoraHistoryCache.delete(id);
    renderBitacora(data);
    showBitacoraNotice("Registro restaurado.");
  } catch (error) {
    showBitacoraNotice(`No se restauro: ${error.message}`, "error");
  }
}

async function importBitacoraExcel(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const data = await apiJson("/api/bitacora/import-excel", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Change-Reason": "Importacion desde Excel",
        "X-Operator": getOperatorName(),
      },
      body: buffer,
    });
    bitacoraHistoryCache.clear();
    renderBitacora(data);
    const stats = data.import || {};
    showBitacoraNotice(`Excel importado. Nuevos: ${stats.inserted || 0}. Actualizados: ${stats.updated || 0}.`);
  } catch (error) {
    showBitacoraNotice(`No se importo el Excel: ${error.message}`, "error");
  }
}

function showSiniestrosNotice(message, type = "success") {
  const notice = document.getElementById("siniestrosNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.remove("hidden", "error");
  notice.classList.toggle("error", type === "error");
}

function renderSiniestros(data = siniestrosData) {
  siniestrosData = data || siniestrosData;
  const results = Array.isArray(siniestrosData.results) ? siniestrosData.results : [];
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok).length;
  document.getElementById("sinTotal").textContent = String(siniestrosData.total || 0);
  document.getElementById("sinCompleted").textContent = String(siniestrosData.completed || 0);
  document.getElementById("sinSuccess").textContent = String(succeeded);
  document.getElementById("sinFailed").textContent = String(failed);
  document.getElementById("sinSearchBtn").disabled = Boolean(siniestrosData.busy);
  document.getElementById("sinExcelInput").disabled = Boolean(siniestrosData.busy);

  const body = document.getElementById("siniestrosTbody");
  clearElement(body);
  if (!results.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "muted";
    cell.textContent = "Aun no hay consultas solicitadas.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  results.forEach((result) => {
    const row = document.createElement("tr");
    appendCell(row, result.folio, { strong: true });
    const status = appendCell(row, result.status === "pdf" ? "PDF" : "Error");
    status.className = result.ok ? "result-ok" : "result-error";
    appendCell(row, result.message);
    const documentCell = document.createElement("td");
    if (result.pdfId) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary siniestros-pdf-btn";
      button.textContent = "Ver PDF";
      button.addEventListener("click", () => openSiniestroPdf(result.pdfId));
      documentCell.appendChild(button);
    } else {
      documentCell.textContent = "-";
    }
    row.appendChild(documentCell);
    appendCell(row, formatClock(result.at));
    body.appendChild(row);
  });
}

async function openSiniestroPdf(pdfId) {
  const target = window.open("", "_blank");
  try {
    const blob = await apiBlob(`/api/siniestros/pdf/${encodeURIComponent(pdfId)}`);
    const url = URL.createObjectURL(blob);
    if (target) {
      target.location.href = url;
    } else {
      window.open(url, "_blank");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    if (target) target.close();
    showSiniestrosNotice(`No se pudo abrir el PDF: ${error.message}`, "error");
  }
}

async function searchSiniestro(event) {
  event.preventDefault();
  const folio = document.getElementById("sinFolio").value.trim();
  const ramo = document.getElementById("sinRamo").value;
  const otInterna = document.getElementById("sinOTInterna");
  
  if (!folio) return;
  if (!ramo) {
    showSiniestrosNotice("Selecciona un ramo para continuar", "error");
    return;
  }
  
  // Generar OT interna si está vacía
  if (!otInterna.value) {
    otInterna.value = generateOTInterna();
  }
  
  try {
    const result = await apiJson("/api/siniestros/search", {
      method: "POST",
      body: JSON.stringify({ 
        folio,
        ramo,
        otInterna: otInterna.value
      }),
    });
    showSiniestrosNotice(`Consulta iniciada para ${result.accepted || 1} folio (OT: ${otInterna.value}).`);
    document.getElementById("sinFolio").value = "";
    // No limpiar sinOTInterna para mantenerla visible
    await fetchStatus();
  } catch (error) {
    showSiniestrosNotice(`No se inicio la consulta: ${error.message}`, "error");
  }
}

async function importSiniestrosExcel(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const result = await apiJson("/api/siniestros/import-excel", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
    });
    showSiniestrosNotice(`Excel recibido. Se consultaran ${result.accepted} folio(s).`);
    await fetchStatus();
  } catch (error) {
    showSiniestrosNotice(`No se proceso el Excel: ${error.message}`, "error");
  }
}

function showAxaSiniestrosNotice(message, type = "success") {
  const notice = document.getElementById("axaSiniestrosNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.remove("hidden", "error");
  notice.classList.toggle("error", type === "error");
}

function renderAxaSiniestros(data = axaSiniestrosData) {
  axaSiniestrosData = data || axaSiniestrosData;
  const results = Array.isArray(axaSiniestrosData.results) ? axaSiniestrosData.results : [];
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok).length;
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  };
  setText("axaSinTotal", axaSiniestrosData.total || 0);
  setText("axaSinCompleted", axaSiniestrosData.completed || 0);
  setText("axaSinSuccess", succeeded);
  setText("axaSinFailed", failed);
  const button = document.getElementById("axaSinRunBtn");
  if (button) {
    button.disabled = Boolean(axaSiniestrosData.busy);
    button.textContent = axaSiniestrosData.busy ? "Consultando..." : "Consultar en AXA";
  }

  const body = document.getElementById("axaSiniestrosTbody");
  if (!body) return;
  clearElement(body);
  if (!results.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "muted";
    cell.textContent = "Aun no hay consultas AXA solicitadas.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  results.forEach((result) => {
    const row = document.createElement("tr");
    appendCell(row, result.folio, { strong: true });
    const status = appendCell(row, result.ok ? "Consultado" : "Error");
    status.className = result.ok ? "result-ok" : "result-error";
    appendCell(row, result.message);
    appendCell(row, result.details?.siniestro || "-");
    appendCell(row, result.details?.estadoPago || result.details?.etapaActual || "-");
    const actionsCell = document.createElement("td");
    if (result.details || result.screenshotId) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary siniestros-pdf-btn";
      button.textContent = "Ver detalle";
      button.addEventListener("click", () => openAxaSiniestrosResult(result));
      actionsCell.appendChild(button);
    } else {
      actionsCell.textContent = "-";
    }
    row.appendChild(actionsCell);
    appendCell(row, formatClock(result.at));
    body.appendChild(row);
  });
}

async function openAxaSiniestrosResult(result) {
  const modal = document.getElementById("axaSiniestrosModal");
  const title = document.getElementById("axaSiniestrosModalTitle");
  const subtitle = document.getElementById("axaSiniestrosModalSubtitle");
  const body = document.getElementById("axaSiniestrosModalBody");
  if (!modal || !title || !subtitle || !body) return;

  title.textContent = `Folio AXA ${displayValue(result.folio)}`;
  subtitle.textContent = result.message || "Resultado de Consulta Express";
  clearElement(body);

  const details = result.details || {};
  const grid = document.createElement("div");
  grid.className = "axa-result-grid";
  [
    ["Siniestro", details.siniestro],
    ["Ramo", details.ramo],
    ["Asegurado", details.asegurado],
    ["Poliza", details.poliza],
    ["Tipo de siniestro", details.tipoSiniestro],
    ["Fecha del registro", details.fechaRegistro],
    ["Fecha del siniestro", details.fechaSiniestro],
    ["Estado", details.estadoPago],
    ["Tramite", details.tipoTramite],
    ["Folio respuesta", details.folio],
    ["Fecha solicitud", details.fechaSolicitud],
    ["Compromiso respuesta", details.compromisoRespuesta],
    ["Etapa actual", details.etapaActual],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "axa-result-field";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.textContent = displayValue(value);
    item.append(labelEl, valueEl);
    grid.appendChild(item);
  });
  body.appendChild(grid);

  if (Array.isArray(details.etapas) && details.etapas.length) {
    const stages = document.createElement("div");
    stages.className = "axa-result-stages";
    details.etapas.forEach((stage) => {
      const pill = document.createElement("span");
      pill.textContent = stage;
      if (stage === details.etapaActual) pill.classList.add("active");
      stages.appendChild(pill);
    });
    body.appendChild(stages);
  }

  if (result.screenshotId) {
    const imageWrap = document.createElement("div");
    imageWrap.className = "axa-result-shot";
    imageWrap.textContent = "Cargando captura...";
    body.appendChild(imageWrap);
    try {
      const blob = await apiBlob(`/api/axa/siniestros/screenshot/${encodeURIComponent(result.screenshotId)}`);
      const url = URL.createObjectURL(blob);
      clearElement(imageWrap);
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Captura AXA ${result.folio}`;
      image.onload = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
      imageWrap.appendChild(image);
    } catch (error) {
      imageWrap.textContent = `No se pudo cargar la captura: ${error.message}`;
    }
  }

  modal.classList.remove("hidden");
}

function closeAxaSiniestrosResult() {
  document.getElementById("axaSiniestrosModal")?.classList.add("hidden");
}

function parseFoliosInput(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((folio) => folio.trim())
    .filter(Boolean)
    .filter((folio, index, all) => all.indexOf(folio) === index);
}

async function searchAxaSiniestro(event) {
  event.preventDefault();
  const field = document.getElementById("axaSinFolios");
  const ramo = document.getElementById("axaSinRamo")?.value || "Autos";
  const folios = parseFoliosInput(field?.value);
  if (!folios.length) return;

  try {
    const result = await apiJson("/api/axa/siniestros/search", {
      method: "POST",
      body: JSON.stringify({ folios, ramo }),
    });
    if (result.axaSiniestros) {
      renderAxaSiniestros(result.axaSiniestros);
    }
    showAxaSiniestrosNotice(`Consulta AXA iniciada para ${result.accepted || 1} folio(s).`);
    if (field) field.value = "";
    await fetchStatus();
  } catch (error) {
    showAxaSiniestrosNotice(`No se inicio AXA: ${error.message}`, "error");
  }
}

async function importAxaSiniestrosExcel(event) {
  const file = event.target.files && event.target.files[0];
  const ramo = document.getElementById("axaSinRamo")?.value || "Autos";
  event.target.value = "";
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const result = await apiJson(`/api/axa/siniestros/import-excel?ramo=${encodeURIComponent(ramo)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
    });
    if (result.axaSiniestros) {
      renderAxaSiniestros(result.axaSiniestros);
    }
    showAxaSiniestrosNotice(`Excel AXA recibido. Se consultaran ${result.accepted} folio(s).`);
    await fetchStatus();
  } catch (error) {
    showAxaSiniestrosNotice(`No se proceso el Excel AXA: ${error.message}`, "error");
  }
}

function setBitacoraMaximized(maximized) {
  bitacoraMaximized = Boolean(maximized);
  document.body.classList.toggle("bitacora-maximized", bitacoraMaximized);
  const button = document.getElementById("bitMaximizeBtn");
  if (button) {
    const text = bitacoraMaximized ? "Restaurar" : "Maximizar";
    const label = button.querySelector("span") || button;
    label.textContent = text;
    button.title = text;
    button.setAttribute("aria-label", text);
  }
}

function toggleBitacoraMaximized() {
  setBitacoraMaximized(!bitacoraMaximized);
}

function appendDetailField(container, label, value) {
  const item = document.createElement("div");
  item.className = "detail-field";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = displayValue(value);
  item.append(labelEl, valueEl);
  container.appendChild(item);
}

function renderSelectedDetail() {
  const panel = document.getElementById("detailPanel");
  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!panel || !body || !title) return;

  const row = selectedOt ? allData.find((item) => item.ot === selectedOt) : null;
  clearElement(body);

  if (!row) {
    panel.classList.add("hidden");
    return;
  }

  const due = getDueInfo(row);
  panel.classList.remove("hidden");
  title.textContent = `OT ${displayValue(row.ot)}`;

  const header = document.createElement("div");
  header.className = "detail-summary";
  const status = document.createElement("span");
  status.className = `badge ${estatusBadgeClass(row.estatus)}`.trim();
  status.textContent = displayValue(row.estatus);
  const priority = document.createElement("span");
  priority.className = `priority-badge priority-${due.key}`;
  priority.textContent = due.label;
  header.append(status, priority);
  body.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "detail-grid";
  appendDetailField(grid, "Poliza", row.poliza);
  appendDetailField(grid, "Contratante", row.contratante);
  appendDetailField(grid, "Agente", row.agente);
  appendDetailField(grid, "Producto", row.producto);
  appendDetailField(grid, "Tipo solicitud", titleCase(row.tipoSolicitud));
  appendDetailField(grid, "Fecha compromiso", formatGnpDate(row.fechaCompromiso));
  appendDetailField(grid, "Fecha registro", formatGnpDate(row.fechaRegistro));
  appendDetailField(grid, "Primer ingreso", formatGnpDate(row.primerIngreso));
  appendDetailField(grid, "Ultimo ingreso", formatGnpDate(row.ultimoIngreso));
  appendDetailField(grid, "Medio", row.medioApertura);
  appendDetailField(grid, "Rol", formatRole(row.rol));
  appendDetailField(grid, "Guia", row.guia);
  body.appendChild(grid);

  const change = getStatusChange(row.ot);
  if (change) {
    const section = document.createElement("div");
    section.className = "detail-change";
    const heading = document.createElement("span");
    heading.textContent = "Cambio de estatus";
    const detail = document.createElement("strong");
    const statusChange = change.changes.find((entry) => entry.field === "estatus");
    detail.textContent = `${displayValue(statusChange.before)} -> ${displayValue(statusChange.after)}`;
    section.append(heading, detail);
    body.appendChild(section);
  }

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const copyOt = document.createElement("button");
  copyOt.className = "detail-action";
  copyOt.type = "button";
  copyOt.textContent = "Copiar OT";
  copyOt.addEventListener("click", () => navigator.clipboard?.writeText(displayValue(row.ot)));
  const copyPolicy = document.createElement("button");
  copyPolicy.className = "detail-action";
  copyPolicy.type = "button";
  copyPolicy.textContent = "Copiar poliza";
  copyPolicy.addEventListener("click", () => navigator.clipboard?.writeText(displayValue(row.poliza)));
  const sendBitacora = document.createElement("button");
  sendBitacora.className = "detail-action primary";
  sendBitacora.type = "button";
  sendBitacora.textContent = "Enviar a bitacora";
  sendBitacora.addEventListener("click", () => sendMonitorRowToBitacora(row));
  actions.append(copyOt, copyPolicy, sendBitacora);
  body.appendChild(actions);
}

function selectRow(ot) {
  selectedOt = ot;
  renderTablePage();
  renderSelectedDetail();
}

function closeDetail() {
  selectedOt = null;
  renderTablePage();
  renderSelectedDetail();
}

function renderTvAlerts(diff) {
  const box = document.getElementById("tvAlerts");
  if (!box) return;

  clearElement(box);

  const statusChanges = diff && diff.cambiados
    ? diff.cambiados.filter((row) => row.changes && row.changes.some((change) => change.field === "estatus"))
    : [];
  const activeRows = filteredData.filter((row) => statusRank(row.estatus) <= statusPriority.rechazada);

  if (!statusChanges.length && !activeRows.length) {
    box.classList.add("quiet");
    const item = document.createElement("div");
    item.className = "tv-alert-item";
    item.textContent = "Sin cambios de estatus ni casos prioritarios";
    box.appendChild(item);
    return;
  }

  box.classList.remove("quiet");

  statusChanges.slice(0, 4).forEach((row) => {
    const change = row.changes.find((entry) => entry.field === "estatus");
    const item = document.createElement("div");
    item.className = "tv-alert-item urgent";
    item.textContent = `${row.ot}: ${displayValue(change.before)} -> ${displayValue(change.after)}`;
    box.appendChild(item);
  });

  const statusCounts = activeRows.reduce((acc, row) => {
    const key = normalizeStatus(row.estatus);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  ["en proceso", "activada", "en registro", "rechazada"].forEach((status) => {
    if (!statusCounts[status]) return;
    const item = document.createElement("div");
    item.className = `tv-alert-item status-${status.replace(/\s+/g, "-")}`;
    item.textContent = `${statusCounts[status]} ${titleCase(status)}`;
    box.appendChild(item);
  });
}

function renderChangeTicker(diff) {
  const ticker = document.getElementById("changeTicker");
  const textBox = document.getElementById("changeTickerText");
  if (!ticker || !textBox) return;

  const statusChanges = diff && diff.cambiados
    ? diff.cambiados.filter((row) => row.changes && row.changes.some((change) => change.field === "estatus"))
    : [];
  const newRows = diff && diff.nuevos ? diff.nuevos : [];

  const messages = [
    ...statusChanges.map((row) => {
      const change = row.changes.find((entry) => entry.field === "estatus");
      return `${row.ot}: ${displayValue(change.before)} -> ${displayValue(change.after)}`;
    }),
    ...newRows.map((row) => `${row.ot}: Nuevo`),
  ];
//hi
  clearElement(textBox);
  if (!messages.length) {
    ticker.classList.add("hidden");
    return;
  }

  ticker.classList.remove("hidden");
  textBox.textContent = messages.join("   |   ");
}

function maybePlayAlertSound(diff) {
  if (!tvConfig.soundEnabled || !diff) return;

  const statusChanges = diff.cambiados
    ? diff.cambiados.filter((row) => row.changes && row.changes.some((change) => change.field === "estatus"))
    : [];
  const newRows = diff.nuevos || [];
  const signature = [
    ...statusChanges.map((row) => row.ot),
    ...newRows.map((row) => row.ot),
  ].join("|");

  if (!signature || signature === lastAlertSignature) return;
  lastAlertSignature = signature;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  } catch {}
}

function renderTvMeta(data) {
  const lastRunChip = document.getElementById("lastRunChip");
  const nextRunChip = document.getElementById("nextRunChip");
  const staleBanner = document.getElementById("staleBanner");
  const staleText = document.getElementById("staleText");

  if (lastRunChip) lastRunChip.textContent = data.lastUpdate ? formatClock(data.lastUpdate) : "-";
  if (nextRunChip) {
    nextRunChip.textContent =
      data.scheduler && data.scheduler.enabled && data.scheduler.nextTrigger
        ? formatClock(data.scheduler.nextTrigger)
        : "Desactivada";
  }

  const age = minutesSince(data.lastUpdate);
  const stale = age !== null && age >= tvConfig.staleMinutes;
  if (staleBanner) staleBanner.classList.toggle("hidden", !stale);
  if (staleText && stale) {
    staleText.textContent = `La ultima consulta fue hace ${age} min.`;
  }
}

function updateClock() {
  const clock = document.getElementById("clockChip");
  if (clock) clock.textContent = formatClock();
  updateAxaRefreshCountdown();

  const nextRunChip = document.getElementById("nextRunChip");
  if (nextRunChip && lastStatusData && lastStatusData.scheduler && lastStatusData.scheduler.enabled) {
    const next = lastStatusData.scheduler.nextTrigger ? new Date(lastStatusData.scheduler.nextTrigger) : null;
    if (next && !Number.isNaN(next.getTime())) {
      const remaining = Math.max(0, Math.ceil((next.getTime() - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const seconds = String(remaining % 60).padStart(2, "0");
      nextRunChip.textContent = `${formatClock(next)} (${minutes}:${seconds})`;
    }
  }
}

function renderManualBanner(data) {
  const banner = document.getElementById("manualBanner");
  const reason = document.getElementById("manualReason");
  const steps = document.getElementById("manualSteps");
  const show = data.mode === "waiting_manual_login" && data.manualLogin && data.manualLogin.required;

  banner.classList.toggle("show", show);
  if (!show) return;

  reason.textContent = data.manualLogin.reason || "Login manual requerido.";
  clearElement(steps);

  const details = [
    data.manualLogin.emailFilled && data.manualLogin.passwordFilled
      ? "El navegador ya tiene los datos de acceso cargados."
      : "El navegador no pudo llenar todos los datos.",
    data.manualLogin.detectedCaptcha
      ? "Se detecto reCAPTCHA durante el acceso."
      : "No se confirmo el acceso de forma automatica.",
    ...(data.manualLogin.instructions || []),
  ];

  details.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    steps.appendChild(item);
  });
}

function renderErrorBanner(data) {
  const banner = document.getElementById("errorBanner");
  const errorText = document.getElementById("errorText");
  if (!banner || !errorText) return;
  const show = Boolean(data.error);
  banner.classList.toggle("show", show);
  errorText.textContent = data.error || "-";
}

function showLoading(show, mode) {
  const loadingState = document.getElementById("loadingState");
  const emptyState = document.getElementById("emptyState");
  const tableWrap = document.getElementById("tableWrap");
  const tableContainer = document.querySelector(".table-container");
  const loadingTitle = document.getElementById("loadingTitle");
  const loadingDesc = document.getElementById("loadingDesc");
  
  if (show) {
    emptyState.style.display = "none";
    const keepTvTableVisible = activeUiMode === "tv" && filteredData.length > 0;
    loadingState.classList.toggle("hidden", keepTvTableVisible);
    tableWrap.classList.toggle("hidden", !keepTvTableVisible);
    if (tableContainer) {
      tableContainer.classList.toggle("updating", keepTvTableVisible);
      tableContainer.dataset.loadingTitle = modeLabels[mode] || "Actualizando";
      tableContainer.dataset.loadingDesc = loadingMessages[mode] || "Proceso en ejecucion...";
    }
    
    loadingTitle.textContent = modeLabels[mode] || "Procesando";
    loadingDesc.textContent = loadingMessages[mode] || "Por favor espera...";
  } else {
    loadingState.classList.add("hidden");
    if (tableContainer) {
      tableContainer.classList.remove("updating");
      delete tableContainer.dataset.loadingTitle;
      delete tableContainer.dataset.loadingDesc;
    }
  }
}

function renderStatus(data) {
  lastStatusData = data;
  if (data.auth && data.auth.user) {
    setCurrentUser(data.auth.user);
  }
  applyTvConfig(data.tv || {});

  const summary =
    data.summary ||
    (data.diff && data.diff.summary) ||
    (diffData && diffData.summary) ||
    {};
  const badge = document.getElementById("statusBadge");
  badge.className = `status-indicator ${data.mode || "idle"}`;

  const isLoading = ["querying", "booting", "checking_session", "auto_login", "siniestros"].includes(data.mode);
  
  if (isLoading) {
    showLoading(true, data.mode);
  } else {
    showLoading(false);
    renderTablePage();
    updatePagination();
  }

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  setText("statusLabel", modeLabels[data.mode] || data.mode || "Listo");
  setText("statusMessage", data.message || "Sin actividad");
  setText("statusSecondary", data.error || (data.busy ? "Proceso en ejecucion..." : "Esperando"));
  setText("sumTotal", String(summary.totalActual ?? (data.data || []).length ?? 0));
  setText("sumNuevos", String(summary.nuevos ?? 0));
  setText("sumCambiados", String(summary.cambiados ?? 0));
  setText("sumEliminados", String(summary.eliminados ?? 0));
  setText("lastUpdateChip", fmtDate(data.lastUpdate));
  setText("sessionChip", data.sessionInfo && data.sessionInfo.alive ? "Activa" : "No verificada");
  setText("urlChip", data.sessionInfo && data.sessionInfo.lastUrl ? data.sessionInfo.lastUrl : "-");

  document.getElementById("runBtn").disabled = Boolean(data.busy);
  document.getElementById("cancelBtn").disabled = !data.busy;
  document.getElementById("startLoginBtn").disabled = Boolean(data.busy && data.mode !== "waiting_manual_login");
  document.getElementById("manualBtn").disabled = !Boolean(data.requiresManualLogin || (data.manualLogin && data.manualLogin.required));
  const schedulerEnabled = Boolean(data.scheduler && data.scheduler.enabled);
  const schedulerPaused = Boolean(data.scheduler && data.scheduler.paused);
  document.getElementById("pauseMonitorBtn").disabled = !schedulerEnabled || schedulerPaused;
  document.getElementById("resumeMonitorBtn").disabled = !schedulerEnabled || !schedulerPaused;
  const restartBrowserBtn = document.getElementById("restartBrowserBtn");
  if (restartBrowserBtn) restartBrowserBtn.disabled = Boolean(data.busy);

  renderManualBanner(data);
  renderErrorBanner(data);
  renderLogs(data.executionLog || []);

  if (data.diff) {
    diffData = data.diff;
  }
  renderChanges(diffData);
  renderTvAlerts(diffData);
  renderChangeTicker(diffData);
  maybePlayAlertSound(diffData);
  renderTvMeta(data);
  renderOperationalSummary();
  if (data.bitacora) {
    renderBitacora(data.bitacora);
  }
  if (data.siniestros) {
    renderSiniestros(data.siniestros);
  }
  if (data.axaSiniestros) {
    renderAxaSiniestros(data.axaSiniestros);
  }
  if (data.axa) {
    renderAxa(data.axa);
  }
  
  if (data.dataVersion) {
    statusVersion = data.dataVersion;
  }

  if (Array.isArray(data.data)) {
    const nextData = data.data;
    if (JSON.stringify(nextData) === JSON.stringify(allData)) {
      return;
    }
    allData = nextData;
    applyFilters();
  } else if (!allData.length && Number(summary.totalActual || 0) > 0) {
    statusVersion = null;
    setTimeout(fetchFullStatus, 0);
  }
}

function setCurrentUser(user) {
  currentUser = user || null;
  document.body.classList.toggle("is-admin", currentUser?.role === "admin");
  setTimeout(clearAutofilledSearchInputsForUser, 0);
  setTimeout(clearAutofilledSearchInputsForUser, 250);
  const overlay = document.getElementById("loginOverlay");
  const userPill = document.getElementById("userPill");
  const userName = document.getElementById("userName");
  const adminButton = document.getElementById("adminViewBtn");
  const importInput = document.getElementById("bitExcelInput");
  overlay?.classList.toggle("hidden", Boolean(currentUser));
  userPill?.classList.toggle("hidden", !currentUser);
  adminButton?.classList.toggle("hidden", currentUser?.role !== "admin");
  if (importInput) {
    importInput.closest("label")?.classList.toggle("hidden", currentUser?.role !== "admin");
  }
  if (userName) {
    userName.textContent = currentUser ? `${currentUser.displayName} (${formatRole(currentUser.role)})` : "-";
  }
  if (currentUser?.role !== "admin" && activeMainView === "admin") {
    setMainView("monitor");
  }
}

function showLogin(message = "") {
  const overlay = document.getElementById("loginOverlay");
  const error = document.getElementById("loginError");
  overlay?.classList.remove("hidden");
  if (error) {
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }
}

async function checkAuth() {
  try {
    const data = await apiJson("/api/auth/me", { skipAuthPrompt: true });
    setCurrentUser(data.user);
    return Boolean(data.user);
  } catch {
    setCurrentUser(null);
    showLogin();
    return false;
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    const data = await apiJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      skipAuthPrompt: true,
    });
    setCurrentUser(data.user);
    document.getElementById("loginPassword").value = "";
    await fetchFullStatus();
    startStatusPolling();
  } catch (error) {
    showLogin(error.message);
  }
}

async function logout() {
  try {
    await apiJson("/api/auth/logout", { method: "POST", skipAuthPrompt: true });
  } catch {}
  setCurrentUser(null);
  showLogin();
}

async function fetchStatus() {
  try {
    const query = statusVersion && allData.length ? `?since=${encodeURIComponent(statusVersion)}` : "";
    renderStatus(await apiJson(`/api/status${query}`));
  } catch (err) {
    console.error("Error fetching status:", err);
  }
}

async function fetchFullStatus() {
  try {
    renderStatus(await apiJson("/api/status?full=1"));
  } catch (err) {
    console.error("Error fetching full status:", err);
  }
}

async function runAxaNow() {
  const button = document.getElementById("axaRunBtn");
  try {
    if (button) {
      button.disabled = true;
    }
    const data = await apiPost("/api/axa/run-now");
    if (data.axa) renderAxa(data.axa);
  } catch (error) {
    if (error?.message) {
      renderAxa({
        ...axaState,
        mode: "error",
        message: "No se pudo actualizar AXA",
        error: error.message,
      });
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function apiPost(path) {
  return apiJson(path, { method: "POST" });
}

async function apiBlob(path) {
  const headers = {};

  let response = await fetch(path, { headers });
  if (response.status === 401) {
    showLogin("Inicia sesion para continuar.");
    throw new Error("Sesion requerida.");
  }
  if (response.status === 403) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "No tienes permisos.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `No se pudo obtener la vista remota. HTTP ${response.status}`);
  }
  return response.blob();
}

async function apiJson(path, options = {}) {
  const headers = {};
  const optionHeaders = options.headers || {};
  if (options.body && !optionHeaders["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response = await fetch(path, { ...options, headers: { ...headers, ...optionHeaders } });
  if (response.status === 401) {
    if (options.skipAuthPrompt) {
      throw new Error("Sesion requerida.");
    }
    showLogin("Inicia sesion para continuar.");
    throw new Error("Sesion requerida.");
  }
  const responseText = await response.text().catch(() => "");
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok || payload.ok === false) {
    const detail = responseText && responseText.length < 180 ? responseText : "";
    throw new Error(
      payload.message ||
        payload.error ||
        detail ||
        `La accion no pudo completarse. HTTP ${response.status}`
    );
  }
  return payload;
}

function openBitacoraExcel(event) {
  event.preventDefault();
  window.location.href = "/api/bitacora/excel";
}

function getAdminFilterValues() {
  return {
    userId: document.getElementById("adminMetricUser")?.value || "",
    status: document.getElementById("adminMetricStatus")?.value || "",
    risk: document.getElementById("adminMetricRisk")?.value || "",
    dateField: document.getElementById("adminMetricDateField")?.value || "delivery",
    dateFrom: document.getElementById("adminMetricFrom")?.value || "",
    dateTo: document.getElementById("adminMetricTo")?.value || "",
  };
}

function buildAdminMetricsQuery() {
  const params = new URLSearchParams();
  Object.entries(getAdminFilterValues()).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function setSelectOptions(select, options, getValue, getLabel, emptyLabel = "Todos") {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  select.appendChild(empty);
  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = getValue(option);
    item.textContent = getLabel(option);
    select.appendChild(item);
  });
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function riskLabel(value) {
  const labels = {
    overdue: "Vencida",
    no_followup: "Sin seguimiento",
    open: "Abierta",
    closed: "Cerrada",
    archived: "Archivada",
  };
  return labels[value] || "-";
}

function setAdminTab(tab) {
  activeAdminTab = ["users", "metrics", "cases"].includes(tab) ? tab : "users";
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const isActive = button.dataset.adminTab === activeAdminTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  [
    ["users", "adminUsersPane"],
    ["metrics", "adminMetricsPane"],
    ["cases", "adminCasesPane"],
  ].forEach(([name, id]) => {
    document.getElementById(id)?.classList.toggle("active", name === activeAdminTab);
  });
}

function renderAdminFilters(data = adminMetricsState) {
  setSelectOptions(
    document.getElementById("adminMetricUser"),
    data.users || [],
    (user) => user.id,
    (user) => `${user.displayName} (${formatRole(user.role)})`
  );
  setSelectOptions(
    document.getElementById("adminMetricStatus"),
    data.statusOptions || [],
    (status) => status,
    (status) => status
  );
}

function renderAdminCases(cases = adminMetricsState.cases || []) {
  const tbody = document.getElementById("adminCasesTbody");
  const count = document.getElementById("adminDetailCount");
  const title = document.getElementById("adminDetailTitle");
  const subtitle = document.getElementById("adminDetailSubtitle");
  if (!tbody) return;
  tbody.innerHTML = "";

  const visibleCases = selectedAdminUserId
    ? cases.filter((item) => item.executiveId === selectedAdminUserId)
    : cases;
  if (count) count.textContent = `${visibleCases.length} caso${visibleCases.length === 1 ? "" : "s"}`;
  const selectedMetric = adminMetricsState.metrics.find((row) => row.user?.id === selectedAdminUserId);
  if (title) title.textContent = selectedMetric ? `Detalle de ${selectedMetric.user.displayName}` : "Detalle de casos";
  if (subtitle) subtitle.textContent = selectedMetric ? "Casos filtrados para el ejecutivo seleccionado." : "Selecciona un ejecutivo o usa los filtros.";

  if (!visibleCases.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 11;
    cell.className = "muted";
    cell.textContent = "No hay casos con los filtros actuales.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  visibleCases.forEach((item) => {
    const row = document.createElement("tr");
    [
      displayValue(item.executive),
      displayValue(item.folio),
      displayValue(item.poliza),
      displayValue(item.cliente),
      displayValue(item.estado),
      displayValue(item.fechaEntrega),
      riskLabel(item.risk),
      displayValue(item.lastComment),
      fmtDate(item.lastFollowupAt),
      item.updates || 0,
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      row.appendChild(td);
    });
    const actions = document.createElement("td");
    actions.className = "admin-case-actions";
    const openButton = document.createElement("button");
    openButton.className = "btn-secondary admin-mini-btn";
    openButton.type = "button";
    openButton.textContent = "Abrir";
    openButton.addEventListener("click", () => {
      void openAdminCaseInBitacora(item);
    });
    actions.appendChild(openButton);
    row.appendChild(actions);
    tbody.appendChild(row);
  });
}

function renderAdminUsers(users = adminMetricsState.users || []) {
  const tbody = document.getElementById("adminUsersTbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!users.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "muted";
    cell.textContent = "No hay usuarios registrados.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  users.forEach((user) => {
    const row = document.createElement("tr");
    [
      displayValue(user.username),
      displayValue(user.displayName),
      formatRole(user.role),
      user.active ? "Activo" : "Inactivo",
      fmtDate(user.updatedAt || user.createdAt),
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      row.appendChild(td);
    });

    const actions = document.createElement("td");
    actions.className = "admin-user-actions";
    const editButton = document.createElement("button");
    editButton.className = "btn-secondary admin-mini-btn";
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => startAdminUserEdit(user));

    const activeButton = document.createElement("button");
    activeButton.className = user.active ? "btn-ghost admin-mini-btn danger" : "btn-secondary admin-mini-btn";
    activeButton.type = "button";
    activeButton.textContent = user.active ? "Desactivar" : "Reactivar";
    activeButton.disabled = user.active && user.id === currentUser?.id;
    activeButton.addEventListener("click", () => {
      void toggleAdminUserActive(user);
    });
    actions.append(editButton, activeButton);
    row.appendChild(actions);
    tbody.appendChild(row);
  });
}

function renderAdminMetrics(payload = {}) {
  const metrics = Array.isArray(payload) ? payload : payload.metrics || [];
  adminMetricsState = {
    metrics,
    cases: Array.isArray(payload.cases) ? payload.cases : metrics.flatMap((row) => row.cases || []),
    users: payload.users || adminMetricsState.users || [],
    statusOptions: payload.statusOptions || adminMetricsState.statusOptions || [],
  };
  renderAdminFilters(adminMetricsState);
  renderAdminUsers(adminMetricsState.users);
  const totals = metrics.reduce(
    (acc, row) => {
      acc.total += row.total || 0;
      acc.completed += row.completed || 0;
      acc.overdue += row.overdue || 0;
      acc.updates += row.updates || 0;
      acc.active += row.active || 0;
      acc.withoutFollowup += row.withoutFollowup || 0;
      return acc;
    },
    { total: 0, completed: 0, overdue: 0, updates: 0, active: 0, withoutFollowup: 0 }
  );
  const effectiveness = totals.total ? Math.round((totals.completed / totals.total) * 1000) / 10 : 0;
  const grid = document.getElementById("adminMetricsGrid");
  if (grid) {
    grid.innerHTML = "";
    [
      ["Total bitacoras", totals.total],
      ["Activas", totals.active],
      ["Terminadas", totals.completed],
      ["Vencidas", totals.overdue],
      ["Sin seguimiento", totals.withoutFollowup],
      ["Efectividad", `${effectiveness}%`],
    ].forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "summary-card";
      card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
      grid.appendChild(card);
    });
  }

  const tbody = document.getElementById("adminMetricsTbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  metrics.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = "admin-metric-row";
    tr.tabIndex = 0;
    tr.addEventListener("click", () => {
      selectedAdminUserId = selectedAdminUserId === row.user?.id ? "" : row.user?.id || "";
      const userFilter = document.getElementById("adminMetricUser");
      if (userFilter) userFilter.value = selectedAdminUserId;
      renderAdminMetrics(adminMetricsState);
      setAdminTab("cases");
    });
    [
      displayValue(row.user?.displayName),
      formatRole(row.user?.role),
      row.total || 0,
      row.active || 0,
      row.completed || 0,
      row.overdue || 0,
      row.withoutFollowup || 0,
      row.updates || 0,
      row.avgResolutionDays || 0,
      `${row.effectivenessRate || 0}%`,
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    });
    tr.classList.toggle("active", selectedAdminUserId === row.user?.id);
    tbody.appendChild(tr);
  });
  renderAdminCases(adminMetricsState.cases);
}

async function openAdminCaseInBitacora(caseItem) {
  let item = findBitacoraItemById(caseItem.id);
  if (!item) {
    await fetchFullStatus();
    item = findBitacoraItemById(caseItem.id);
  }
  if (!item) {
    showAdminNotice("No encontre el caso en la bitacora actual.", "error");
    return;
  }
  fillBitacoraForm(item);
  setMainView("bitacora");
  expandedBitacoraDetailId = null;
  expandedBitacoraId = null;
  await toggleBitacoraDetail(item.id);
  showBitacoraNotice("Caso abierto desde Admin.");
}

async function refreshAdminMetrics() {
  if (currentUser?.role !== "admin") return;
  try {
    const query = buildAdminMetricsQuery();
    const data = await apiJson(`/api/admin/metrics${query ? `?${query}` : ""}`);
    renderAdminMetrics(data);
  } catch (error) {
    console.error("Error loading admin metrics:", error);
  }
}

function showAdminNotice(message, type = "success") {
  const notice = document.getElementById("adminNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.remove("hidden", "error");
  notice.classList.toggle("error", type === "error");
}

async function createAdminUser(event) {
  event.preventDefault();
  const form = document.getElementById("adminUserForm");
  const editId = document.getElementById("adminEditUserId")?.value || "";
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value;
  try {
    const payload = {
      username,
      displayName: document.getElementById("adminDisplayName").value.trim(),
      role: document.getElementById("adminRole").value,
    };
    if (password) payload.password = password;

    if (editId) {
      const data = await apiJson(`/api/users/${encodeURIComponent(editId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      adminMetricsState.users = data.users || adminMetricsState.users;
      resetAdminUserForm();
      showAdminNotice("Usuario actualizado.");
      await refreshAdminMetrics();
      return;
    }

    payload.password = password;
    await apiJson("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const panel = document.getElementById("adminCredentialsPanel");
    const createdUsername = document.getElementById("createdUsername");
    const createdPassword = document.getElementById("createdPassword");
    if (createdUsername) createdUsername.textContent = username;
    if (createdPassword) createdPassword.textContent = password;
    panel?.classList.remove("hidden");
    if (form) {
      form.reset();
    }
    showAdminNotice("Usuario creado.");
    await refreshAdminMetrics();
  } catch (error) {
    showAdminNotice(error.message, "error");
  }
}

function resetAdminUserForm() {
  const form = document.getElementById("adminUserForm");
  const editId = document.getElementById("adminEditUserId");
  const username = document.getElementById("adminUsername");
  const password = document.getElementById("adminPassword");
  const submit = document.getElementById("adminUserSubmitBtn");
  const cancel = document.getElementById("adminCancelUserEditBtn");
  form?.reset();
  if (editId) editId.value = "";
  if (username) username.disabled = false;
  if (password) {
    password.required = true;
    password.placeholder = "";
  }
  if (submit) submit.textContent = "Crear usuario";
  cancel?.classList.add("hidden");
}

function startAdminUserEdit(user) {
  const editId = document.getElementById("adminEditUserId");
  const username = document.getElementById("adminUsername");
  const displayName = document.getElementById("adminDisplayName");
  const role = document.getElementById("adminRole");
  const password = document.getElementById("adminPassword");
  const submit = document.getElementById("adminUserSubmitBtn");
  const cancel = document.getElementById("adminCancelUserEditBtn");
  if (editId) editId.value = user.id || "";
  if (username) {
    username.value = user.username || "";
    username.disabled = true;
  }
  if (displayName) displayName.value = user.displayName || "";
  if (role) role.value = user.role || "executive";
  if (password) {
    password.value = "";
    password.required = false;
    password.placeholder = "Dejar vacia para no cambiar";
  }
  if (submit) submit.textContent = "Guardar cambios";
  cancel?.classList.remove("hidden");
  document.getElementById("adminCredentialsPanel")?.classList.add("hidden");
}

async function toggleAdminUserActive(user) {
  if (user.active && user.id === currentUser?.id) {
    showAdminNotice("No puedes desactivar tu propio usuario.", "error");
    return;
  }
  try {
    const action = user.active ? "deactivate" : "reactivate";
    const data = await apiJson(`/api/users/${encodeURIComponent(user.id)}/${action}`, { method: "POST" });
    adminMetricsState.users = data.users || adminMetricsState.users;
    renderAdminUsers(adminMetricsState.users);
    showAdminNotice(user.active ? "Usuario desactivado." : "Usuario reactivado.");
    await refreshAdminMetrics();
  } catch (error) {
    showAdminNotice(error.message, "error");
  }
}

function clearAdminFilters() {
  ["adminMetricUser", "adminMetricStatus", "adminMetricRisk", "adminMetricFrom", "adminMetricTo"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
  const dateField = document.getElementById("adminMetricDateField");
  if (dateField) dateField.value = "delivery";
  selectedAdminUserId = "";
  void refreshAdminMetrics();
}

function exportAdminMetricsCsv() {
  const rows = [
    ["Ejecutivo", "Rol", "Total", "Activas", "Terminadas", "Vencidas", "Sin seguimiento", "Actualizaciones", "Resolucion promedio", "Efectividad"],
    ...adminMetricsState.metrics.map((row) => [
      row.user?.displayName || "",
      formatRole(row.user?.role),
      row.total || 0,
      row.active || 0,
      row.completed || 0,
      row.overdue || 0,
      row.withoutFollowup || 0,
      row.updates || 0,
      row.avgResolutionDays || 0,
      `${row.effectivenessRate || 0}%`,
    ]),
    [],
    ["Detalle"],
    ["Ejecutivo", "Folio", "Poliza", "Cliente", "Estado", "Entrega", "Riesgo", "Ultimo comentario", "Ultimo seguimiento", "Seguimientos"],
    ...adminMetricsState.cases.map((item) => [
      item.executive || "",
      item.folio || "",
      item.poliza || "",
      item.cliente || "",
      item.estado || "",
      item.fechaEntrega || "",
      riskLabel(item.risk),
      item.lastComment || "",
      fmtDate(item.lastFollowupAt),
      item.updates || 0,
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `metricas-admin-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function runNow() {
  try {
    showLoading(true, "booting");
    await apiPost("/api/monitor/run-now");
  } catch (error) {
    alert(error.message);
  } finally {
    await fetchStatus();
  }
}

async function startManualLogin() {
  try {
    await apiPost("/api/session/start-login");
    openRemoteLogin();
  } catch (error) {
    alert(error.message);
  }
  await fetchStatus();
}

async function continueManual() {
  try {
    await apiPost("/api/session/mark-ready");
    closeRemoteLogin();
  } catch (error) {
    alert(error.message);
  }
  await fetchStatus();
}

async function pauseMonitor() {
  await apiPost("/api/monitor/pause").catch((error) => alert(error.message));
  await fetchStatus();
}

async function resumeMonitor() {
  await apiPost("/api/monitor/resume").catch((error) => alert(error.message));
  await fetchStatus();
}

async function cancelRun() {
  await apiPost("/api/cancel").catch((error) => alert(error.message));
  await fetchStatus();
}

async function restartBrowser() {
  await apiPost("/api/restart-browser").catch((error) => alert(error.message));
  await fetchStatus();
}

function setRemoteLoginError(message = "") {
  const element = document.getElementById("remoteLoginError");
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

async function refreshRemoteLogin() {
  const modal = document.getElementById("remoteLoginModal");
  if (modal.classList.contains("hidden") || remoteViewBusy) return;
  remoteViewBusy = true;
  const loading = document.getElementById("remoteLoginLoading");
  const image = document.getElementById("remoteLoginImage");
  loading.classList.remove("hidden");

  try {
    const blob = await apiBlob(`/api/session/remote-view?t=${Date.now()}`);
    const nextUrl = URL.createObjectURL(blob);
    image.onload = () => {
      loading.classList.add("hidden");
    };
    image.src = nextUrl;
    if (remoteImageUrl) URL.revokeObjectURL(remoteImageUrl);
    remoteImageUrl = nextUrl;
    setRemoteLoginError();
  } catch (error) {
    loading.classList.add("hidden");
    setRemoteLoginError(error.message);
  } finally {
    remoteViewBusy = false;
  }
}

function openRemoteLogin() {
  document.getElementById("remoteLoginModal").classList.remove("hidden");
  setRemoteLoginError();
  void refreshRemoteLogin();
  if (remoteLoginTimer) clearInterval(remoteLoginTimer);
  remoteLoginTimer = setInterval(refreshRemoteLogin, 1500);
}

function closeRemoteLogin() {
  document.getElementById("remoteLoginModal").classList.add("hidden");
  if (remoteLoginTimer) {
    clearInterval(remoteLoginTimer);
    remoteLoginTimer = null;
  }
}

async function remoteAction(payload) {
  try {
    await apiJson("/api/session/remote-action", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await refreshRemoteLogin();
  } catch (error) {
    setRemoteLoginError(error.message);
  }
}

async function sendRemoteText() {
  const input = document.getElementById("remoteTextInput");
  const text = input.value;
  if (!text) return;
  await remoteAction({ action: "type", text });
  input.value = "";
}

function togglePanel() {
  const panel = document.getElementById("sidePanel");
  panelVisible = !panelVisible;
  panel.classList.toggle("hidden", !panelVisible);
}

function setTvControlsMenu(open) {
  const menu = document.getElementById("tvControlsMenu");
  const button = document.getElementById("tvControlsMenuBtn");
  const dropdown = document.getElementById("tvControlsDropdown");
  if (!menu || !button || !dropdown) return;

  menu.classList.toggle("open", open);
  dropdown.classList.toggle("hidden", !open);
  button.setAttribute("aria-expanded", String(open));
}

function toggleTvControlsMenu() {
  const dropdown = document.getElementById("tvControlsDropdown");
  setTvControlsMenu(dropdown ? dropdown.classList.contains("hidden") : true);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    console.warn("No se pudo cambiar pantalla completa", error);
  } finally {
    updateTvControls();
  }
}

let floatingTooltip = null;

function hideFloatingTooltip() {
  if (floatingTooltip) {
    floatingTooltip.remove();
    floatingTooltip = null;
  }
}

function showFloatingTooltip(target) {
  const text = target?.dataset?.tooltip;
  if (!text) return;

  hideFloatingTooltip();
  floatingTooltip = document.createElement("div");
  floatingTooltip.className = "floating-tooltip";
  floatingTooltip.textContent = text;
  document.body.appendChild(floatingTooltip);

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = floatingTooltip.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(targetRect.left + targetRect.width / 2 - tooltipRect.width / 2, margin),
    window.innerWidth - tooltipRect.width - margin
  );
  const top = Math.max(targetRect.top - tooltipRect.height - 12, margin);
  floatingTooltip.style.left = `${left}px`;
  floatingTooltip.style.top = `${top}px`;
}

// Event Listeners
document.getElementById("runBtn").addEventListener("click", runNow);
document.getElementById("startLoginBtn").addEventListener("click", startManualLogin);
document.getElementById("openRemoteLoginBtn").addEventListener("click", openRemoteLogin);
document.getElementById("manualBtn").addEventListener("click", continueManual);
document.getElementById("pauseMonitorBtn").addEventListener("click", pauseMonitor);
document.getElementById("resumeMonitorBtn").addEventListener("click", resumeMonitor);
document.getElementById("cancelBtn").addEventListener("click", cancelRun);
document.getElementById("restartBrowserBtn").addEventListener("click", restartBrowser);
document.getElementById("closeRemoteLoginBtn").addEventListener("click", closeRemoteLogin);
document.getElementById("refreshRemoteLoginBtn").addEventListener("click", refreshRemoteLogin);
document.getElementById("remoteMarkReadyBtn").addEventListener("click", continueManual);
document.getElementById("remoteSendTextBtn").addEventListener("click", sendRemoteText);
document.getElementById("remoteTextInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void sendRemoteText();
  }
});
document.getElementById("remoteLoginImage").addEventListener("click", (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  void remoteAction({
    action: "click",
    xRatio: (event.clientX - rect.left) / rect.width,
    yRatio: (event.clientY - rect.top) / rect.height,
  });
});
document.querySelectorAll(".remote-key-btn").forEach((button) => {
  button.addEventListener("click", () => remoteAction({ action: "key", key: button.dataset.key }));
});
document.getElementById("remoteScrollUpBtn").addEventListener("click", () => remoteAction({ action: "scroll", deltaY: -600 }));
document.getElementById("remoteScrollDownBtn").addEventListener("click", () => remoteAction({ action: "scroll", deltaY: 600 }));
document.getElementById("refreshBtn").addEventListener("click", fetchStatus);

document.getElementById("searchInput").addEventListener("input", applyFilters);
document.getElementById("statusFilter").addEventListener("change", applyFilters);
document.getElementById("toggleHiddenRowsBtn").addEventListener("click", () => {
  setTvOverride("hideTerminadas", !tvConfig.hideTerminadas);
});
document.getElementById("bitacoraForm").addEventListener("submit", saveBitacoraEntry);
document.getElementById("bitCancelEdit").addEventListener("click", resetBitacoraForm);
document.getElementById("bitSearch").addEventListener("input", () => renderBitacora());
document.getElementById("bitFilter").addEventListener("change", () => renderBitacora());
document.getElementById("bitDateFrom").addEventListener("change", () => renderBitacora());
document.getElementById("bitDateTo").addEventListener("change", () => renderBitacora());
document.getElementById("bitExcelInput").addEventListener("change", importBitacoraExcel);
document.getElementById("bitExcelLink").addEventListener("click", openBitacoraExcel);
document.getElementById("bitMaximizeBtn").addEventListener("click", toggleBitacoraMaximized);
document.getElementById("siniestrosForm").addEventListener("submit", searchSiniestro);
document.getElementById("axaSiniestrosForm")?.addEventListener("submit", searchAxaSiniestro);
document.getElementById("axaSiniestrosModalClose")?.addEventListener("click", closeAxaSiniestrosResult);
document.getElementById("axaSiniestrosModal")?.addEventListener("click", (event) => {
  if (event.target?.id === "axaSiniestrosModal") closeAxaSiniestrosResult();
});
document.getElementById("sinExcelInput").addEventListener("change", importSiniestrosExcel);
document.getElementById("axaSinExcelInput")?.addEventListener("change", importAxaSiniestrosExcel);
document.getElementById("operatorModeBtn").addEventListener("click", () => setUiMode("operator"));
document.getElementById("tvModeBtn").addEventListener("click", () => setUiMode("tv"));
document.getElementById("gnpCarrierBtn").addEventListener("click", () => setCarrier("gnp"));
document.getElementById("axaCarrierBtn").addEventListener("click", () => setCarrier("axa"));
document.getElementById("monitorViewBtn").addEventListener("click", () => setMainView(carrierView("monitor")));
document.getElementById("bitacoraViewBtn").addEventListener("click", () => setMainView("bitacora"));
document.getElementById("siniestrosViewBtn").addEventListener("click", () => setMainView(carrierView("siniestros")));
document.getElementById("adminViewBtn").addEventListener("click", () => setMainView("admin"));
document.getElementById("axaRunBtn")?.addEventListener("click", runAxaNow);
document.getElementById("axaSearchInput")?.addEventListener("input", applyAxaFilters);
document.getElementById("axaStatusFilter")?.addEventListener("change", applyAxaFilters);
document.getElementById("axaPrevPage")?.addEventListener("click", () => {
  if (axaCurrentPage > 1) {
    axaCurrentPage -= 1;
    renderAxaTable();
  }
});
document.getElementById("axaNextPage")?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(axaFilteredRows.length / axaRowsPerPage));
  if (axaCurrentPage < totalPages) {
    axaCurrentPage += 1;
    renderAxaTable();
  }
});
document.querySelectorAll(".axa-filter-tab").forEach((button) => {
  button.addEventListener("click", () => {
    axaQuickFilter = button.dataset.axaFilter || "all";
    document.querySelectorAll(".axa-filter-tab").forEach((item) => {
      item.classList.toggle("active", item.dataset.axaFilter === axaQuickFilter);
    });
    applyAxaFilters();
  });
});
document.getElementById("loginForm").addEventListener("submit", submitLogin);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("adminUserForm").addEventListener("submit", createAdminUser);
document.getElementById("adminCancelUserEditBtn").addEventListener("click", resetAdminUserForm);
document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
});
["adminMetricUser", "adminMetricStatus", "adminMetricRisk", "adminMetricDateField", "adminMetricFrom", "adminMetricTo"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => {
    selectedAdminUserId = document.getElementById("adminMetricUser")?.value || "";
    void refreshAdminMetrics();
  });
});
document.getElementById("adminClearFiltersBtn").addEventListener("click", clearAdminFilters);
document.getElementById("adminExportBtn").addEventListener("click", exportAdminMetricsCsv);
document.querySelectorAll(".quick-filter").forEach((button) => {
  button.addEventListener("click", () => setQuickFilter(button.dataset.filter));
});

document.getElementById("prevPage").addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    renderTablePage();
    updatePagination();
  }
});

document.getElementById("nextPage").addEventListener("click", () => {
  const totalPages = getTotalPages();
  if (currentPage < totalPages) {
    currentPage++;
    renderTablePage();
    updatePagination();
  }
});

document.getElementById("toggleTerminatedBtn").addEventListener("click", () => {
  setTvOverride("hideTerminadas", !tvConfig.hideTerminadas);
  setTvControlsMenu(false);
});

document.getElementById("toggleAutoScrollBtn").addEventListener("click", () => {
  setTvOverride("autoScroll", !tvConfig.autoScroll);
  setTvControlsMenu(false);
});

document.getElementById("toggleSoundBtn").addEventListener("click", () => {
  setTvOverride("soundEnabled", !tvConfig.soundEnabled);
  setTvControlsMenu(false);
});

document.getElementById("fullscreenBtn").addEventListener("click", () => {
  toggleFullscreen();
  setTvControlsMenu(false);
});

document.getElementById("scrollTopBtn").addEventListener("click", () => {
  const tableWrap = document.getElementById("tableWrap");
  if (!tableWrap) return;

  resetTableScroll(tableWrap);

  if (tvConfig.autoScroll) {
    startAutoScroll();
  }

  setTvControlsMenu(false);
});

document.getElementById("tvControlsMenuBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleTvControlsMenu();
});

document.getElementById("tvControlsDropdown").addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("mouseover", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) showFloatingTooltip(target);
});

document.addEventListener("mouseout", (event) => {
  if (event.target.closest("[data-tooltip]")) hideFloatingTooltip();
});

document.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) showFloatingTooltip(target);
});

document.addEventListener("focusout", (event) => {
  if (event.target.closest("[data-tooltip]")) hideFloatingTooltip();
});

document.addEventListener("scroll", hideFloatingTooltip, true);
document.addEventListener("click", () => setTvControlsMenu(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideFloatingTooltip();
    if (activeUiMode === "tv") setUiMode("operator");
    setTvControlsMenu(false);
    if (bitacoraMaximized) setBitacoraMaximized(false);
  }
});
document.addEventListener("fullscreenchange", updateTvControls);

document.getElementById("togglePanelBtn").addEventListener("click", togglePanel);
document.getElementById("closePanelBtn").addEventListener("click", togglePanel);
document.getElementById("closeDetailBtn").addEventListener("click", closeDetail);

// Initial load
setUiMode(activeUiMode);
setQuickFilter(quickFilter);
updateClock();
setInterval(updateClock, 1000);
startCarousel();
checkAuth().then((authenticated) => {
  if (authenticated) {
    fetchStatus();
    startStatusPolling();
  }
});
