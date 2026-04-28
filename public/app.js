const modeLabels = {
  idle: "Listo",
  booting: "Preparando",
  checking_session: "Revisando sesion",
  auto_login: "Login automatico",
  waiting_manual_login: "Login manual",
  querying: "Consultando",
  done: "Completado",
  error: "Error",
};

const loadingMessages = {
  booting: "Iniciando navegador...",
  checking_session: "Verificando sesion activa...",
  auto_login: "Intentando login automatico...",
  querying: "Consultando ordenes de trabajo...",
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
let diffData = null;
let panelVisible = true;
let statusVersion = null;
let hiddenTerminatedCount = 0;
let lastStatusData = null;
let activeUiMode = localStorage.getItem("gnpUiMode") || "operator";
let quickFilter = localStorage.getItem("gnpQuickFilter") || "all";
let selectedOt = null;
let carouselTimer = null;
let statusPollTimer = null;
let autoScrollTimer = null;
let lastAlertSignature = "";
let postTokenRequired = false;
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
}

function setTvOverride(key, value) {
  tvOverrides[key] = value;
  saveTvOverrides();
  applyTvConfig({});
  applyFilters();
}

function setUiMode(mode) {
  activeUiMode = mode === "tv" ? "tv" : "operator";
  localStorage.setItem("gnpUiMode", activeUiMode);
  document.body.classList.toggle("tv-mode", activeUiMode === "tv");
  document.body.classList.toggle("operator-mode", activeUiMode !== "tv");
  document.getElementById("operatorModeBtn").classList.toggle("active", activeUiMode !== "tv");
  document.getElementById("tvModeBtn").classList.toggle("active", activeUiMode === "tv");
  currentPage = 1;
  renderTablePage();
  updatePagination();
  startCarousel();
  resetTableScroll(document.getElementById("tableWrap"));
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
}

function appendPriorityCell(row, sourceRow) {
  const due = getDueInfo(sourceRow);
  const cell = document.createElement("td");
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
    "coordinacion da": "Coordinador Agencia GMM",
    coordinacion_da: "Coordinador Agencia GMM",
    "agente certificado": "Coordinador Agente Certificado GMM",
    agente_certificado: "Coordinador Agente Certificado GMM",
    "coordinador agencia gmm": "Coordinador Agencia GMM",
    "coordinador agente certificado gmm": "Coordinador Agente Certificado GMM",
  };
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

function applyFilters() {
  const searchTerm = normalizeText(document.getElementById("searchInput").value).trim();
  const statusFilter = normalizeText(document.getElementById("statusFilter").value);
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
  
  clearElement(tbody);
  
  if (loadingState && !loadingState.classList.contains("hidden")) {
    return;
  }
  
  if (!filteredData || !filteredData.length) {
    tableWrap.classList.add("hidden");
    emptyState.style.display = "flex";
    document.getElementById("tableCount").textContent = "0 registros";
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
    
    appendCell(tr, row.ot, { strong: true });
    appendCell(tr, row.usuarioCreador);
    appendCell(tr, row.estatus, { badgeClass });
    appendPriorityCell(tr, row);
    appendCell(tr, formatGnpDate(row.fechaCompromiso));
    appendCell(tr, row.poliza);
    appendCell(tr, row.agente);
    appendCell(tr, row.contratante);
    appendCell(tr, titleCase(row.tipoSolicitud));
    appendCell(tr, row.producto);
    appendCell(tr, row.guia);
    appendCell(tr, formatGnpDate(row.fechaRegistro));
    appendCell(tr, formatGnpDate(row.primerIngreso));
    appendCell(tr, formatGnpDate(row.ultimoIngreso));
    appendCell(tr, row.medioApertura);
    appendCell(tr, formatRole(row.rol));
    tr.addEventListener("click", () => selectRow(row.ot));
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
  
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
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

  addItem(`${summary.nuevos} Nuevos`, diff.nuevos, "#10b981");
  addItem(`${summary.cambiados} Cambiados`, diff.cambiados, "#8b5cf6");
  addItem(`${summary.eliminados} Eliminados`, diff.eliminados, "#ef4444");

  clearElement(box);
  box.appendChild(list);
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
  actions.append(copyOt, copyPolicy);
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

function showLoading(show, mode) {
  const loadingState = document.getElementById("loadingState");
  const emptyState = document.getElementById("emptyState");
  const tableWrap = document.getElementById("tableWrap");
  const loadingTitle = document.getElementById("loadingTitle");
  const loadingDesc = document.getElementById("loadingDesc");
  
  if (show) {
    loadingState.classList.remove("hidden");
    emptyState.style.display = "none";
    tableWrap.classList.add("hidden");
    
    loadingTitle.textContent = modeLabels[mode] || "Procesando";
    loadingDesc.textContent = loadingMessages[mode] || "Por favor espera...";
  } else {
    loadingState.classList.add("hidden");
  }
}

function renderStatus(data) {
  lastStatusData = data;
  postTokenRequired = Boolean(data.auth && data.auth.postTokenRequired);
  applyTvConfig(data.tv || {});

  const summary =
    data.summary ||
    (data.diff && data.diff.summary) ||
    (diffData && diffData.summary) ||
    {};
  const badge = document.getElementById("statusBadge");
  badge.className = `status-badge ${data.mode || "idle"}`;

  const isLoading = ["querying", "booting", "checking_session", "auto_login"].includes(data.mode);
  
  if (isLoading) {
    showLoading(true, data.mode);
  } else {
    showLoading(false);
    renderTablePage();
    updatePagination();
  }

  document.getElementById("statusLabel").textContent = modeLabels[data.mode] || data.mode || "Listo";
  document.getElementById("statusMessage").textContent = data.message || "Sin actividad";
  document.getElementById("statusSecondary").textContent =
    data.error || (data.busy ? "Proceso en ejecucion..." : "Esperando");
  document.getElementById("sumTotal").textContent = String(summary.totalActual ?? (data.data || []).length ?? 0);
  document.getElementById("sumNuevos").textContent = String(summary.nuevos ?? 0);
  document.getElementById("sumCambiados").textContent = String(summary.cambiados ?? 0);
  document.getElementById("sumEliminados").textContent = String(summary.eliminados ?? 0);
  document.getElementById("lastUpdateChip").textContent = fmtDate(data.lastUpdate);
  document.getElementById("sessionChip").textContent =
    data.sessionInfo && data.sessionInfo.alive ? "Activa" : "No verificada";
  document.getElementById("urlChip").textContent =
    data.sessionInfo && data.sessionInfo.lastUrl ? data.sessionInfo.lastUrl : "-";

  document.getElementById("runBtn").disabled = Boolean(data.busy);
  document.getElementById("cancelBtn").disabled = !data.busy;
  document.getElementById("manualBtn").disabled = data.mode !== "waiting_manual_login";
  const restartBrowserBtn = document.getElementById("restartBrowserBtn");
  if (restartBrowserBtn) restartBrowserBtn.disabled = Boolean(data.busy);

  renderManualBanner(data);
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
  }
}

async function fetchStatus() {
  try {
    const query = statusVersion ? `?since=${encodeURIComponent(statusVersion)}` : "";
    const response = await fetch(`/api/status${query}`);
    renderStatus(await response.json());
  } catch (err) {
    console.error("Error fetching status:", err);
  }
}

function getMonitorToken() {
  return localStorage.getItem("gnpMonitorToken") || "";
}

function promptForMonitorToken() {
  const token = window.prompt("Token local del monitor");
  if (token) {
    localStorage.setItem("gnpMonitorToken", token);
  }
  return token || "";
}

async function apiPost(path) {
  const headers = {};
  const token = getMonitorToken();
  if (token) {
    headers["X-Monitor-Token"] = token;
  }

  let response = await fetch(path, { method: "POST", headers });
  if (response.status === 401) {
    const nextToken = promptForMonitorToken();
    if (!nextToken) {
      throw new Error("Token local requerido.");
    }
    response = await fetch(path, {
      method: "POST",
      headers: { "X-Monitor-Token": nextToken },
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || "La accion no pudo completarse.");
  }
  return payload;
}

async function runNow() {
  try {
    showLoading(true, "booting");
    await apiPost("/api/run");
  } catch (error) {
    alert(error.message);
  } finally {
    await fetchStatus();
  }
}

async function continueManual() {
  await apiPost("/api/continue-manual-login").catch((error) => alert(error.message));
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

// Event Listeners
document.getElementById("runBtn").addEventListener("click", runNow);
document.getElementById("manualBtn").addEventListener("click", continueManual);
document.getElementById("cancelBtn").addEventListener("click", cancelRun);
document.getElementById("restartBrowserBtn").addEventListener("click", restartBrowser);
document.getElementById("refreshBtn").addEventListener("click", fetchStatus);

document.getElementById("searchInput").addEventListener("input", applyFilters);
document.getElementById("statusFilter").addEventListener("change", applyFilters);
document.getElementById("operatorModeBtn").addEventListener("click", () => setUiMode("operator"));
document.getElementById("tvModeBtn").addEventListener("click", () => setUiMode("tv"));
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

document.addEventListener("click", () => setTvControlsMenu(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setTvControlsMenu(false);
});

document.getElementById("togglePanelBtn").addEventListener("click", togglePanel);
document.getElementById("closePanelBtn").addEventListener("click", togglePanel);
document.getElementById("closeDetailBtn").addEventListener("click", closeDetail);

// Initial load
setUiMode(activeUiMode);
setQuickFilter(quickFilter);
updateClock();
setInterval(updateClock, 1000);
startCarousel();
fetchStatus();
startStatusPolling();
