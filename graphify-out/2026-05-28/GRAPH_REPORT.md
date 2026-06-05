# Graph Report - Nueva carpeta (5)  (2026-05-27)

## Corpus Check
- 11 files · ~33,694 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 515 nodes · 1202 edges · 30 communities (28 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `262a7a6c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]

## God Nodes (most connected - your core abstractions)
1. `pushLog()` - 45 edges
2. `normalizeText()` - 33 edges
3. `nowIso()` - 28 edges
4. `runMonitor()` - 23 edges
5. `Documentacion de funcionalidad e integracion - GNP Monitor` - 23 edges
6. `renderStatus()` - 20 edges
7. `serializeError()` - 19 edges
8. `getSearchTargets()` - 18 edges
9. `ensureConsultaOperational()` - 17 edges
10. `fetchGetPendientesDirect()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `saveSessionInfo()` --calls--> `writeJson()`  [EXTRACTED]
  gnp-monitor.js → gnp-monitor.js  _Bridges community 8 → community 0_
- `persistRunData()` --calls--> `writeJson()`  [EXTRACTED]
  gnp-monitor.js → gnp-monitor.js  _Bridges community 8 → community 24_
- `migrateBitacoraJsonToDb()` --calls--> `readJsonSafe()`  [EXTRACTED]
  gnp-monitor.js → gnp-monitor.js  _Bridges community 24 → community 3_
- `inferDirectQueryParams()` --calls--> `readJsonSafe()`  [EXTRACTED]
  gnp-monitor.js → gnp-monitor.js  _Bridges community 24 → community 10_
- `runMonitor()` --calls--> `readJsonSafe()`  [EXTRACTED]
  gnp-monitor.js → gnp-monitor.js  _Bridges community 24 → community 0_

## Communities (30 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.10
Nodes (65): appearsLoggedIn(), appendPersistentLog(), assertNotCancelled(), autoResolveManualLogin(), buildBrowserLaunchOptions(), cancelRun(), cleanupOldScreenshots(), clearConsultaStatusFilter() (+57 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (40): action, afterCounts, allowedKeys, app, audit, beforeCounts, { chromium }, comparison (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (40): allData, appendPriorityCell(), bitacoraCaseKey(), bitacoraData, bitacoraHistoryCache, filteredData, findSinBitacoraRow(), formatClock() (+32 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (14): appendBitacoraFollowup(), archiveBitacoraEntry(), attachBitacoraHistoryMeta(), countBitacoraRecords(), dbRowToBitacora(), ensureBitacoraAuditSchema(), findExistingBitacoraEntry(), importBitacoraEntries() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.19
Nodes (15): archiveBitacoraEntry(), askChangeReason(), clearBitacoraFilters(), describeBitacoraSave(), fillBitacoraForm(), followupBitacoraItem(), getBitacoraPayload(), getOperatorName() (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (21): appendCell(), appendDetailField(), bitacoraActionLabel(), bitacoraComparisonRows(), displayValue(), estatusBadgeClass(), formatGnpDate(), formatMatchBy() (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (30): clickFirst(), clickLocator(), clickSiniestrosVerDocumentos(), clickWorkflowOptionByCoordinates(), clickWorkflowOptionByDom(), createSiniestrosOutcomeCapture(), detectCaptcha(), fillFirst() (+22 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (30): applyFilters(), clearElement(), closeDetail(), collapseBitacoraDuplicates(), fmtDate(), getOperationalSummary(), getTotalPages(), maybePlayAlertSound() (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (21): buildGetPendientesUrl(), compareRows(), entries, isLocalHost(), parseSiniestrosExcel(), publicSessionInfo(), sortRows(), validateConfig() (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (16): author, dependencies, better-sqlite3, dotenv, express, playwright, xlsx, description (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.13
Nodes (19): buildAuditMeta(), buildAuditMetaFromRequest(), formatCompactDate(), formatDisplayDate(), getCurrentMonthDateRange(), getDefaultDateRange(), inferDirectQueryParams(), inferDirectQueryParamsFromIframe() (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (6): classifyBitacoraEntry(), dayDiffFromToday(), isClosedStatus(), isCurrentMonthRow(), parseGnpDate(), startOfDay()

### Community 12 - "Community 12"
Cohesion: 0.29
Nodes (8): applyTvConfig(), saveTvOverrides(), setTvOverride(), startAutoScroll(), startCarousel(), startStatusPolling(), toggleFullscreen(), updateTvControls()

### Community 13 - "Community 13"
Cohesion: 0.19
Nodes (15): bitacoraMonitorKeySets(), buildMonitorIndexes(), findMonitorMatch(), getReferenceMonth(), isTerminada(), makeKey(), mapScrapedRow(), mergeCurrentMonthWithOpenOlderRows() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (26): apiBlob(), apiJson(), apiPost(), cancelRun(), closeRemoteLogin(), continueManual(), fetchFullStatus(), fetchStatus() (+18 more)

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (6): getAllowedIpRules(), getClientIp(), ipv4ToInt(), matchesIpRule(), normalizeIpAddress(), requireAllowedIp()

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (24): code:powershell (npm install), code:env (HOST=0.0.0.0), code:powershell (.\start-monitor.cmd), code:powershell (npm install), code:powershell (pm2 status), code:powershell (Invoke-RestMethod http://127.0.0.1:3000/health), code:env (RUN_TIMEOUT_MINUTES=5), code:env (PORT=3000) (+16 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (18): API HTTP, code:text (http://127.0.0.1:3000), code:json ({), `DELETE /api/bitacora/:id`, `GET /`, `GET /api/bitacora`, `GET /api/bitacora/excel`, `GET /api/bitacora/:id/history` (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.50
Nodes (4): escapeXml(), excelCell(), excelRow(), excelSheet()

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (3): excelValueToText(), normalizeHeader(), pickExcelValue()

### Community 20 - "Community 20"
Cohesion: 0.05
Nodes (40): Archivos principales, Bitacora, Bitacora UI, code:powershell (npm install), code:text (Lee INTEGRACION_CODEX.md y el proyecto actual. Quiero integr), code:text (http://127.0.0.1:3000), code:powershell (npm test), code:powershell (powershell -ExecutionPolicy Bypass -File .\package-windows.p) (+32 more)

### Community 24 - "Community 24"
Cohesion: 0.35
Nodes (13): buildBitacoraComparison(), buildStatusPayload(), createEmptyDiff(), filterArchivedMonitorRows(), persistRunData(), readBitacora(), readJsonSafe(), saveComparisonHistory() (+5 more)

### Community 25 - "Community 25"
Cohesion: 0.18
Nodes (10): build, builder, dockerfilePath, deploy, healthcheckPath, healthcheckTimeout, restartPolicyMaxRetries, restartPolicyType (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (3): buildBrowserPayload(), buildHealthPayload(), publicSchedulerInfo()

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (3): hasValidMonitorToken(), requireMonitorToken(), requireRemoteControlToken()

## Knowledge Gaps
- **154 isolated node(s):** `express`, `fs`, `path`, `Database`, `XLSX` (+149 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Documentacion de funcionalidad e integracion - GNP Monitor` connect `Community 20` to `Community 17`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **Why does `API HTTP` connect `Community 17` to `Community 20`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `express`, `fs`, `path` to the rest of the system?**
  _155 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09759615384615385 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06183574879227053 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._