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
let carouselTimer = null;
let statusPollTimer = null;
let autoScrollTimer = null;
let lastAlertSignature = "";
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
  const previousAutoScroll = tvConfig.autoScroll;
  const previousScrollPixels = tvConfig.scrollPixels;
  const previousScrollIntervalMs = tvConfig.scrollIntervalMs;
  tvConfig = {
    ...tvConfig,
    ...nextConfig,
    ...tvOverrides,
  };
  rowsPerPage = Number(tvConfig.rowsPerPage) || rowsPerPage;
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

function shouldShowRow(row) {
  if (!tvConfig.hideTerminadas) return true;
  return !isTerminada(row) || isStatusChangedOt(row.ot);
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

    const rank = statusRank(left.estatus) - statusRank(right.estatus);
    if (rank !== 0) return rank;

    return 0;
  });
}

function applyFilters() {
  const searchTerm = normalizeText(document.getElementById("searchInput").value).trim();
  const statusFilter = normalizeText(document.getElementById("statusFilter").value);
  hiddenTerminatedCount = tvConfig.hideTerminadas
    ? allData.filter((row) => isTerminada(row) && !isStatusChangedOt(row.ot)).length
    : 0;
  
  filteredData = sortForTv(allData.filter(row => {
    if (!shouldShowRow(row)) return false;

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
  
  const start = 0;
  const end = filteredData.length;
  const pageData = filteredData;
  
  document.getElementById("tableCount").textContent = `${filteredData.length} registros`;
  
  pageData.forEach((row) => {
    const tr = document.createElement("tr");
    const badgeClass = estatusBadgeClass(row.estatus);
    
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
    tbody.appendChild(tr);
  });
}

function updatePagination() {
  const totalPages = 1;
  const pagination = document.getElementById("pagination");
  const pageIndicator = document.getElementById("pageIndicator");
  const paginationInfo = document.getElementById("paginationInfo");
  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  const visibleRowsChip = document.getElementById("visibleRowsChip");
  const hiddenChip = document.getElementById("hiddenTerminatedChip");
  
  pagination.classList.add("hidden");
  
  const start = (currentPage - 1) * rowsPerPage + 1;
  const end = Math.min(currentPage * rowsPerPage, filteredData.length);
  
  paginationInfo.textContent = `Mostrando ${filteredData.length} registros`;
  pageIndicator.textContent = `${currentPage} / ${totalPages}`;
  if (visibleRowsChip) visibleRowsChip.textContent = String(filteredData.length);
  if (hiddenChip) hiddenChip.textContent = String(hiddenTerminatedCount);
  
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function startCarousel() {
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

async function runNow() {
  showLoading(true, "booting");
  await fetch("/api/run", { method: "POST" });
  await fetchStatus();
}

async function continueManual() {
  await fetch("/api/continue-manual-login", { method: "POST" });
  await fetchStatus();
}

async function cancelRun() {
  await fetch("/api/cancel", { method: "POST" });
  await fetchStatus();
}

async function restartBrowser() {
  await fetch("/api/restart-browser", { method: "POST" });
  await fetchStatus();
}

function togglePanel() {
  const panel = document.getElementById("sidePanel");
  panelVisible = !panelVisible;
  panel.classList.toggle("hidden", !panelVisible);
}

// Event Listeners
document.getElementById("runBtn").addEventListener("click", runNow);
document.getElementById("manualBtn").addEventListener("click", continueManual);
document.getElementById("cancelBtn").addEventListener("click", cancelRun);
document.getElementById("restartBrowserBtn").addEventListener("click", restartBrowser);
document.getElementById("refreshBtn").addEventListener("click", fetchStatus);

document.getElementById("searchInput").addEventListener("input", applyFilters);
document.getElementById("statusFilter").addEventListener("change", applyFilters);

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
});

document.getElementById("toggleAutoScrollBtn").addEventListener("click", () => {
  setTvOverride("autoScroll", !tvConfig.autoScroll);
});

document.getElementById("scrollTopBtn").addEventListener("click", () => {
  const tableWrap = document.getElementById("tableWrap");
  if (!tableWrap) return;

  resetTableScroll(tableWrap);

  if (tvConfig.autoScroll) {
    startAutoScroll();
  }
});

document.getElementById("togglePanelBtn").addEventListener("click", togglePanel);
document.getElementById("closePanelBtn").addEventListener("click", togglePanel);

// Initial load
updateClock();
setInterval(updateClock, 1000);
startCarousel();
fetchStatus();
startStatusPolling();
