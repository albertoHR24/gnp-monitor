const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildGetPendientesUrl,
  compareRows,
  extractItems,
  mergeCurrentMonthWithOpenOlderRows,
  parseDateForSort,
  publicSessionInfo,
  sortRows,
  writeJson,
} = require("../gnp-monitor");

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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gnp-monitor-test-"));
const file = path.join(tempDir, "state.json");
writeJson(file, { ok: true });
assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ok: true });

console.log("pure tests passed");
