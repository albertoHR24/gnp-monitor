const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const {
  buildGetPendientesUrl,
  compareRows,
  extractItems,
  getCurrentMonthDateRange,
  isAllowedUserRole,
  isLocalHost,
  mergeCurrentMonthWithOpenOlderRows,
  parseAxaListadoText,
  parseAxaSiniestrosListadoText,
  parseSiniestrosExcel,
  parseDateForSort,
  publicSessionInfo,
  sortRows,
  writeJson,
  validateExcelBuffer,
  hashPassword,
  verifyPassword,
  normalizeText,
  sanitizeBitacoraEntry,
  isTerminada,
} = require("../gnp-monitor");

assert.strictEqual(isAllowedUserRole("admin"), true, "admin should be an allowed active role");
assert.strictEqual(isAllowedUserRole("executive"), true, "executive should be an allowed active role");
assert.strictEqual(isAllowedUserRole("viewer"), false, "viewer/consulta should not be an allowed active role");

assert.strictEqual(
  parseDateForSort("02/04/2026") < parseDateForSort("16/04/2026"),
  true,
  "parseDateForSort should understand dd/mm/yyyy"
);

assert.deepStrictEqual(
  sortRows([
    { ot: "B", fechaCompromiso: "16/04/2026" },
    { ot: "A", fechaCompromiso: "02/04/2026" },
  ]).map((row) => row.ot),
  ["A", "B"],
  "sortRows should sort dates chronologically"
);

const diff = compareRows(
  [{ ot: "1", estatus: "En Proceso" }],
  [
    { ot: "1", estatus: "Terminada" },
    { ot: "1", estatus: "Terminada" },
  ]
);
assert.strictEqual(diff.summary.cambiados, 1, "compareRows should detect changed rows");
assert.strictEqual(diff.warnings.length, 1, "compareRows should warn about duplicate OTs");

assert.deepStrictEqual(
  extractItems({
    pages: [
      { body: { data: [{ ot: "1" }] } },
      { body: { ordenes: [{ ot: "2" }] } },
    ],
  }).map((row) => row.ot),
  ["1", "2"],
  "extractItems should flatten paginated direct-api responses"
);

assert.deepStrictEqual(
  mergeCurrentMonthWithOpenOlderRows(
    [
      { ot: "MES-1", estatus: "Terminada", fechaCompromiso: "02/04/2026" },
      { ot: "ABIERTA-REPETIDA", estatus: "En Proceso", fechaCompromiso: "03/04/2026" },
      { ot: "MARZO-TERMINADA", estatus: "Terminada", fechaCompromiso: "18/03/2026" },
    ],
    [
      { ot: "VIEJA-ABIERTA", estatus: "Rechazada", fechaCompromiso: "10/01/2026" },
      { ot: "VIEJA-TERMINADA", estatus: "Terminada", fechaCompromiso: "11/01/2026" },
      { ot: "ABIERTA-REPETIDA", estatus: "En Proceso", fechaCompromiso: "03/04/2026" },
    ]
  ).map((row) => row.ot),
  ["VIEJA-ABIERTA", "MES-1", "ABIERTA-REPETIDA"],
  "mergeCurrentMonthWithOpenOlderRows should include only non-terminated older rows without duplicates"
);

const currentMonthRange = getCurrentMonthDateRange();
const expectedMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
assert.strictEqual(
  currentMonthRange.end,
  `${expectedMonthEnd.getFullYear()}${String(expectedMonthEnd.getMonth() + 1).padStart(2, "0")}${String(expectedMonthEnd.getDate()).padStart(2, "0")}`,
  "getCurrentMonthDateRange should include the whole current month"
);

assert.deepStrictEqual(
  publicSessionInfo({
    alive: true,
    lastCheckedAt: "2026-04-24T00:00:00.000Z",
    lastUrl: "https://example.test/path?token=secret",
    lastLoginMethod: "manual",
    note: "ok",
    bearerTokenPreview: "secret",
  }),
  {
    alive: true,
    lastCheckedAt: "2026-04-24T00:00:00.000Z",
    lastUrl: "https://example.test/path",
    lastLoginMethod: "manual",
    note: "ok",
  },
  "publicSessionInfo should hide query strings and token fields"
);

const url = buildGetPendientesUrl({
  tipo: "consulta",
  num_pag: "2",
  registrosPorPagina: "50",
  usuario: "user@example.test",
});
assert.strictEqual(new URL(url).searchParams.get("num_pag"), "2");

assert.strictEqual(isLocalHost("127.0.0.1"), true, "isLocalHost should accept loopback IPv4");
assert.strictEqual(isLocalHost("0.0.0.0"), false, "isLocalHost should reject public bind hosts");

const siniestrosBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  siniestrosBook,
  XLSX.utils.aoa_to_sheet([["Folio"], ["SIN-100"], ["SIN-100"], ["SIN-200"], [45678]]),
  "Folios"
);
assert.deepStrictEqual(
  parseSiniestrosExcel(XLSX.write(siniestrosBook, { type: "buffer", bookType: "xlsx" })),
  ["SIN-100", "SIN-200", "45678"],
  "parseSiniestrosExcel should read and deduplicate folios"
);

const flexibleSiniestrosBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  flexibleSiniestrosBook,
  XLSX.utils.aoa_to_sheet([
    ["Reporte sin columna util"],
    ["Cliente", "Fecha", "Importe"],
    ["Uno", "2026-06-01", 100],
  ]),
  "Resumen"
);
XLSX.utils.book_append_sheet(
  flexibleSiniestrosBook,
  XLSX.utils.aoa_to_sheet([
    ["Archivo libre AXA"],
    [],
    ["Cliente", "Notas", "Numero de Folio", "Fecha"],
    ["A", "ok", 17181465, "2026-06-01"],
    ["B", "ok", " 17181466 ", "2026-06-02"],
    ["C", "duplicado", 17181465, "2026-06-03"],
  ]),
  "Carga"
);
assert.deepStrictEqual(
  parseSiniestrosExcel(XLSX.write(flexibleSiniestrosBook, { type: "buffer", bookType: "xlsx" })),
  ["17181465", "17181466"],
  "parseSiniestrosExcel should find Folio column in any sheet and any position"
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gnp-monitor-test-"));
const file = path.join(tempDir, "state.json");
writeJson(file, { ok: true });
assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ok: true });

// ===== TESTS CRÍTICOS =====

// Test de validación de Excel (Prototype Pollution mitigation)
try {
  validateExcelBuffer("not a buffer");
  assert.fail("validateExcelBuffer should reject non-Buffer input");
} catch (err) {
  assert.strictEqual(err.message.includes("binario"), true);
}

try {
  validateExcelBuffer(Buffer.alloc(0));
  assert.fail("validateExcelBuffer should reject empty buffer");
} catch (err) {
  assert.strictEqual(err.message.includes("vacío"), true);
}

try {
  validateExcelBuffer(Buffer.alloc(11 * 1024 * 1024));
  assert.fail("validateExcelBuffer should reject buffers > 10MB");
} catch (err) {
  assert.strictEqual(err.message.includes("demasiado grande"), true);
}

// Test de hashing y verificación de contraseña
const password = "TestPassword123!";
const hash = hashPassword(password);
assert.strictEqual(verifyPassword(password, hash), true, "verifyPassword should accept correct password");
assert.strictEqual(verifyPassword("WrongPassword", hash), false, "verifyPassword should reject wrong password");
assert.notStrictEqual(hash, password, "hashPassword should not store plain text");

// Test de compareRows con datos grandes (performance/correctness)
const largeDataset = Array.from({ length: 100 }, (_, i) => ({
  ot: `OT-${String(i + 1).padStart(4, "0")}`,
  estatus: i % 3 === 0 ? "Terminada" : "En Proceso",
  fechaCompromiso: `${String((i % 28) + 1).padStart(2, "0")}/04/2026`,
  poliza: `POL-${i}`,
}));

const largeDatasetModified = largeDataset.map((row) => ({
  ...row,
  estatus: row.estatus === "Terminada" ? "Terminada" : "En Espera",
}));

const largeComparison = compareRows(largeDataset, largeDatasetModified);
assert.strictEqual(
  largeComparison.summary.totalAnterior,
  100,
  "compareRows should handle large datasets - count anterior"
);
assert.strictEqual(
  largeComparison.summary.totalActual,
  100,
  "compareRows should handle large datasets - count actual"
);
assert.strictEqual(
  largeComparison.summary.cambiados > 0,
  true,
  "compareRows should detect changes in large datasets"
);

// Test de normalizeText (no debe normalizar null/undefined indefinidamente)
assert.strictEqual(normalizeText(null), "", "normalizeText should handle null");
assert.strictEqual(normalizeText(undefined), "", "normalizeText should handle undefined");
assert.strictEqual(normalizeText("  test  "), "test", "normalizeText should trim");
assert.strictEqual(normalizeText("test  \n  value"), "test value", "normalizeText should normalize whitespace");

const bitacoraEntry = sanitizeBitacoraEntry({
  folio: " 26Y28G3374 ",
  ramo: " GMM ",
  otInterna: " OT-260603-00001 ",
  createdByUserId: " usr-1 ",
  createdByName: " Ejecutivo Uno ",
  fechaEntradaCorreo: "03/06/2026",
  fechaSalida: "04/06/2026",
});
assert.strictEqual(bitacoraEntry.ramo, "GMM", "sanitizeBitacoraEntry should keep ramo");
assert.strictEqual(bitacoraEntry.otInterna, "OT-260603-00001", "sanitizeBitacoraEntry should keep OT interna");
assert.strictEqual(bitacoraEntry.createdByUserId, "usr-1", "sanitizeBitacoraEntry should keep creator user id");
assert.strictEqual(bitacoraEntry.createdByName, "Ejecutivo Uno", "sanitizeBitacoraEntry should keep creator user name");
assert.strictEqual(bitacoraEntry.fechaEntradaCorreo, "03/06/2026", "sanitizeBitacoraEntry should keep fecha entrada correo");
assert.strictEqual(bitacoraEntry.fechaSalida, "04/06/2026", "sanitizeBitacoraEntry should keep fecha salida");

assert.strictEqual(sanitizeBitacoraEntry({ folio: "1", ramo: "Autos" }).ramo, "Autos");
assert.strictEqual(sanitizeBitacoraEntry({ folio: "1", ramo: "Daño" }).ramo, "Daños");
assert.strictEqual(sanitizeBitacoraEntry({ folio: "1", ramo: "GMM (Gastos Médicos)" }).ramo, "GMM");
assert.strictEqual(sanitizeBitacoraEntry({ folio: "1", ramo: "Vida" }).ramo, "Vida");
assert.strictEqual(sanitizeBitacoraEntry({ folio: "1", ramo: "Da\u00c3\u00b1o" }).ramo, "Daños");
assert.strictEqual(sanitizeBitacoraEntry({ folio: "1", ramo: "GMM (Gastos M\u00c3\u00a9dicos)" }).ramo, "GMM");
assert.strictEqual(
  sanitizeBitacoraEntry({ folio: "1", ot_interna: " OT-260603-00002 ", ramo: "GMM" }).otInterna,
  "OT-260603-00002",
  "sanitizeBitacoraEntry should accept snake_case OT interna from form/API payloads"
);

const axaRows = parseAxaListadoText(`
SALUD
Nombre del contratante: GUILLERMO DE ALBA CRUZ
Póliza: 91744108
Trámite: ENDOSO
Fecha Solicitud: 25/05/2026
Estatus: TERMINADO
Folio: 93841571
Numero de Solicitudes: 1
SALUD
Nombre del contratante: GUILLERMO DE ALBA CRUZ
Póliza: 91744108
Trámite: ENDOSO
Fecha Solicitud: 19/05/2026
Estatus: RECHAZO EN LA DIVISION
Folio: 93832620
Comentario: RECHNPM Le informamos que su movimiento es improcedente.
Numero de Solicitudes: 1
`);
assert.strictEqual(axaRows.length, 2, "parseAxaListadoText should extract AXA listing rows");
assert.strictEqual(axaRows[0].ramo, "SALUD", "parseAxaListadoText should read branch from the first line");
assert.strictEqual(axaRows[0].folio, "93841571", "parseAxaListadoText should read folio");
assert.strictEqual(axaRows[0].poliza, "91744108", "parseAxaListadoText should read policy");
assert.strictEqual(axaRows[0].numeroSolicitudes, "1", "parseAxaListadoText should read request count");
assert.strictEqual(axaRows[1].estatus, "RECHAZO EN LA DIVISION", "parseAxaListadoText should read AXA status");
assert.strictEqual(
  axaRows[1].comentario,
  "RECHNPM Le informamos que su movimiento es improcedente.",
  "parseAxaListadoText should read comments"
);
const axaRowsWithChrome = parseAxaListadoText(`
SALUD
Estatus Nombre Solicitados Adicionales
Nombre del contratante: -
Póliza: Estatus Nombre Solicitados Adicionales
Trámite: -
Fecha Solicitud: -
Estatus: Nombre Solicitados Adicionales
Folio: Póliza
Numero de Solicitudes: -
SALUD
Nombre del contratante: WILLIAM KISEL LAITER
Póliza: S8028729
Trámite: ENDOSO
Fecha Solicitud: 14/04/2026
Estatus: TERMINADO
Folio: 93817266
Numero de Solicitudes: 1 DESCARGAR SOLICITUD Registros por página: 10 1 - 10 of 50 SOLICITAR NUEVO TRÁMITE REGRESAR AXA México 2026
`);
assert.strictEqual(axaRowsWithChrome.length, 1, "parseAxaListadoText should ignore AXA header/footer chrome");
assert.strictEqual(axaRowsWithChrome[0].folio, "93817266", "parseAxaListadoText should keep the valid last folio");
assert.strictEqual(axaRowsWithChrome[0].numeroSolicitudes, "1", "parseAxaListadoText should trim footer from request count");

const axaSiniestrosRows = parseAxaSiniestrosListadoText(`
Consulta de siniestros
D2592125
Abierto
Asegurado
WILLIAM KISEL LAITER
No.de P\u00f3liza
SDA333240000
Tipo de siniestro
Da\u00f1os a terceros en cualquiera de sus bienes y personas
Fecha del registro
2025-12-04
Ver detalle
`);
assert.strictEqual(axaSiniestrosRows.length, 1, "parseAxaSiniestrosListadoText should extract visible AXA claim rows");
assert.strictEqual(axaSiniestrosRows[0].siniestro, "D2592125", "parseAxaSiniestrosListadoText should read claim number");
assert.strictEqual(axaSiniestrosRows[0].estadoPago, "Abierto", "parseAxaSiniestrosListadoText should read status");
assert.strictEqual(axaSiniestrosRows[0].asegurado, "WILLIAM KISEL LAITER", "parseAxaSiniestrosListadoText should read insured");
assert.strictEqual(axaSiniestrosRows[0].poliza, "SDA333240000", "parseAxaSiniestrosListadoText should read policy");
assert.strictEqual(axaSiniestrosRows[0].ramo, "Daños", "parseAxaSiniestrosListadoText should normalize damage claim branch");
assert.strictEqual(axaSiniestrosRows[0].fechaRegistro, "2025-12-04", "parseAxaSiniestrosListadoText should read registry date");

const bitacoraWithoutRamo = sanitizeBitacoraEntry({
  folio: "26Y28G3374",
  tramite: "Movimiento",
  descripcion: "Seguimiento sin ramo explicito",
});
assert.strictEqual(bitacoraWithoutRamo.ramo, "", "sanitizeBitacoraEntry should not invent Daños as default ramo");
assert.strictEqual(Boolean(bitacoraWithoutRamo.otInterna), true, "sanitizeBitacoraEntry should still generate OT interna");

// Test de isTerminada (critical for filtering)
assert.strictEqual(isTerminada({ estatus: "Terminada" }), true, "isTerminada should detect Terminada");
assert.strictEqual(isTerminada({ estatus: "TERMINADA" }), true, "isTerminada should be case-insensitive");
assert.strictEqual(isTerminada({ estatus: "En Proceso" }), false, "isTerminada should reject En Proceso");
assert.strictEqual(isTerminada({}), false, "isTerminada should handle missing estatus");

// Test de sortRows performance (no debe perder datos)
const unsorted = [
  { ot: "C", fechaCompromiso: "30/04/2026" },
  { ot: "A", fechaCompromiso: "01/04/2026" },
  { ot: "B", fechaCompromiso: "15/04/2026" },
  { ot: "D", fechaCompromiso: "01/04/2026" },
];
const sorted = sortRows(unsorted);
assert.strictEqual(sorted.length, 4, "sortRows should preserve all rows");
assert.strictEqual(sorted[0].ot, "A", "sortRows should sort by date then OT");
assert.strictEqual(sorted[1].ot, "D", "sortRows should sort same-date OTs alphabetically");
assert.strictEqual(sorted[2].ot, "B", "sortRows should maintain correct order");
assert.strictEqual(sorted[3].ot, "C", "sortRows should place latest date last");

console.log("pure tests passed");
