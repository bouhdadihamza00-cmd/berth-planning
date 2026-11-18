import test from "node:test";
import assert from "node:assert/strict";
import {
  filterImportItems,
  editedImportData,
  reviewData,
  renderDocuments,
  renderAssistant,
} from "../frontend/documents.js";
const rows = [
  {
    id: "1",
    action: "update",
    data: { name: "MV Atlas", product: "Sulfur" },
    evidence: [{ ref: "Lineup!R2" }],
    errors: [],
  },
  {
    id: "2",
    action: "ambiguous",
    data: { name: "MV Vega", product: "Fertilizer" },
    issues: ["Two possible vessel matches"],
  },
  {
    id: "3",
    action: "create",
    data: { name: "MV Orion", product: "Sulfur" },
    errors: ["Unknown berth"],
  },
];
test("import row filters combine source search, action and unresolved issues without mutating records", () => {
  assert.deepEqual(
    filterImportItems(rows, "sulfur", "", true).map((r) => r.id),
    ["3"],
  );
  assert.deepEqual(
    filterImportItems(rows, "lineup!r2", "update").map((r) => r.id),
    ["1"],
  );
  assert.deepEqual(
    filterImportItems(rows, "VEGA", "ambiguous", true).map((r) => r.id),
    ["2"],
  );
  assert.equal(rows[0].selected, undefined);
});
test("manual corrections preserve explicit zero and false while leaving blank values unspecified", () => {
  const original = {
    name: "MV Atlas",
    quantity: 100,
    ready: true,
    grade: "DAP",
    start: "2023-11-28T10:00:00Z",
  };
  const changed = editedImportData(
    { quantity: "0", ready: "false", grade: "", name: " MV Atlas " },
    original,
  );
  assert.equal(changed.quantity, 0);
  assert.equal(changed.ready, false);
  assert.equal(changed.name, "MV Atlas");
  assert.equal("grade" in changed, false);
  assert.equal(changed.start, original.start);
  assert.equal(original.grade, "DAP");
  assert.throws(
    () => editedImportData({ quantity: "Infinity" }),
    /finite number/,
  );
});
function setup() {
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  globalThis.window = {
    P: {
      S: {
        portId: "jph",
        page: "center",
        tab: "imports",
        data: {
          calls: [],
          berths: [],
          port: { timezone: "Africa/Casablanca" },
        },
      },
      esc,
      icon: (name) => `<i data-icon="${name}"></i>`,
      can: () => true,
      path: (s) => "/ports/jph" + s,
      date: (value) => value,
    },
  };
  return window.P.S;
}
test("document history is port scoped and extracted content is escaped in the review preview", () => {
  const S = setup();
  renderDocuments();
  S.documentWorkspace.loaded = true;
  S.documentWorkspace.batch = {
    id: "batch",
    revision: 1,
    filename: "<script>bad()</script>.csv",
    status: "Review",
    method: "local",
    items: [
      {
        id: "row",
        action: "create",
        data: { name: "<img src=x onerror=bad()>", product: "Sulfur" },
        errors: ["<b>missing</b>"],
      },
    ],
    mapping: {},
    extraction: {},
  };
  let html = renderDocuments();
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  S.portId = "safi";
  html = renderDocuments();
  assert.equal(S.documentWorkspace.port, "safi");
  assert.equal(S.documentWorkspace.batch, null);
  assert.doesNotMatch(html, /bad\(\)/);
});
test("fresh imports remain editable with an empty applied ledger; drafted batches direct users to approvals", () => {
  const S = setup();
  renderDocuments();
  S.documentWorkspace.batch = {
    id: "batch",
    revision: 1,
    filename: "plan.csv",
    status: "Ready",
    method: "local",
    applied: [],
    items: [
      { id: "1", action: "create", data: { name: "MV Atlas" }, errors: [] },
    ],
    mapping: {},
    extraction: {},
  };
  let html = renderDocuments();
  assert.match(html, /id="save-import-review"/);
  assert.match(html, /id="draft-import"/);
  assert.doesNotMatch(html, /id="rollback-import"/);
  S.documentWorkspace.batch.status = "Drafted";
  html = renderDocuments();
  assert.match(html, /Workflow center → Approvals/);
  assert.doesNotMatch(html, /id="save-import-review"|id="rollback-import"/);
});
test("operational assistant escapes evidence and enables explicit questions only when a deployment model is ready", () => {
  const S = setup();
  renderAssistant();
  S.operationalAssistant.loaded = true;
  S.operationalAssistant.ai = {
    configured: true,
    external: true,
    provider: "cloud",
  };
  S.operationalAssistant.analysis = {
    metrics: { conflicts: 1 },
    findings: [
      {
        id: "F1",
        title: "<b>Resource clash</b>",
        severity: "High",
        evidence: ["<script>ignore rules</script>"],
        recommendation: "Review shared loader use",
      },
    ],
  };
  const html = renderAssistant();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /Client-hosted AI|Configured model/);
  assert.doesNotMatch(html, /type="submit" disabled/);
  S.operationalAssistant.ai.configured = false;
  assert.match(renderAssistant(), /type="submit" disabled/);
  assert.doesNotMatch(html, /<script>/);
});

test("assistant keeps data-sharing information on demand without model diagnostics", () => {
  const S = setup();
  renderAssistant();
  S.operationalAssistant.ai = {
    configured: true, free_only: true, provider: "openrouter-free",
    model: "openrouter/free", external: true,
  };
  const html = renderAssistant();
  assert.match(html, /<details class="ai-data-use"><summary>Data use<\/summary>/);
  assert.match(html, /sent to OpenRouter/);
  assert.doesNotMatch(html, /Free-only AI|openrouter-free|openrouter\/free|paid fallback/);
});

test("row review uses normalized units and explicit booleans without filling unspecified fields", () => {
  const shown = reviewData({
    data: { name: "Atlas", quantity: 2.5, ready: "False" },
    normalized_data: { name: "Atlas", quantity: 2500, ready: false },
    proposed: { loa: 200 },
  });
  assert.equal(shown.quantity, 2500);
  assert.equal(shown.ready, false);
  assert.equal(shown.loa, undefined);
});
test("document library omits provider and model diagnostics while retaining import actions", () => {
  const S = setup();
  renderDocuments();
  S.documentWorkspace.ai = {configured:true,free_only:true,provider:'openrouter-free',model:'openrouter/free',endpoint_host:'openrouter.ai'};
  const html = renderDocuments();
  assert.doesNotMatch(html, /document-ai-status|Free-only AI|openrouter-free|openrouter\/free|openrouter.ai/);
  assert.match(html, /id="upload-planning-document"/);
  assert.match(html, /Import history/);
});

test("assistant modules render one selected panel and preserve the chosen tool", () => {
  const S = setup();
  let html = renderAssistant();
  assert.equal((html.match(/role="tab" /g) || []).length, 6);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 6);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(html, /id="assistant-tab-analysis"[^>]*aria-selected="true"/);
  S.operationalAssistant.activeTab = "forecasts";
  html = renderAssistant();
  assert.match(html, /id="assistant-tab-forecasts"[^>]*aria-selected="true"/);
  assert.match(html, /id="assistant-panel-analysis"[^>]*hidden/);
  assert.match(html, /id="assistant-panel-forecasts"[^>]*tabindex="0"[^>]*><div/);
  assert.match(html, /Model not connected/);
  S.portId = "another-port";
  assert.match(renderAssistant(), /id="assistant-tab-analysis"[^>]*aria-selected="true"/);
});

test("assistant analytics use recorded measures and scenario access follows permissions", () => {
  const S = setup();
  renderAssistant();
  S.operationalAssistant.analysis = { metrics: { active_calls: 7, waiting_calls: 0, window_start: "2026-11-18" }, findings: [] };
  let html = renderAssistant();
  assert.match(html, /<dt>Active calls<\/dt><dd>7<\/dd>/);
  assert.match(html, /<dt>Waiting vessel calls<\/dt><dd>0<\/dd>/);
  assert.match(html, /data-action="scenario"/);
  window.P.can = () => false;
  assert.doesNotMatch(renderAssistant(), /data-action="scenario"/);
});

test("assistant capacity views use stored occupancy and escape asset names", () => {
  const S = setup();
  renderAssistant();
  S.operationalAssistant.analysis = { findings: [], metrics: {
    berth_load: [{ name: '<Berth A>', occupancy_percent: 50 }],
    equipment_load: [{ name: 'Loader', occupancy_percent: 0 }],
    occupancy_basis: 'Union of planned intervals',
  } };
  const html = renderAssistant();
  assert.match(html, /&lt;Berth A&gt;/);
  assert.match(html, /width:50%/);
  assert.match(html, /<strong>0%<\/strong>/);
  assert.match(html, /<details class="assistant-capacity-note">/);
  assert.match(html, /Union of planned intervals/);
  assert.doesNotMatch(html, /<Berth A>/);
});

test("assistant distinguishes unloaded metrics from measured zero and links model empty states", () => {
  const S = setup();
  let html = renderAssistant();
  assert.match(html, /class="assistant-kpi"[\s\S]*?<strong>—<\/strong>/);
  assert.match(html, /data-open-assistant-tab="models"/);
  S.operationalAssistant.analysis = { findings: [], metrics: { active_calls: 0 } };
  html = renderAssistant();
  assert.match(html, /class="assistant-kpi"[\s\S]*?<strong>0<\/strong>/);
  assert.match(html, /assistant-evidence/);
  assert.doesNotMatch(html, /assistant-module-empty/);
});
