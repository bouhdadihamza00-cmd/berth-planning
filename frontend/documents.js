import { getLocale } from "./preferences.js?v=7";
import { confirmRemoval } from "./removal.js?v=5";
const P = () => window.P;
export const IMPORT_FIELDS = [
  ["name", "Vessel name", "text"],
  ["imo", "IMO number", "text"],
  ["mmsi", "MMSI", "text"],
  ["call_reference", "Company call reference", "text"],
  ["direction", "Import / export", "text"],
  ["product", "Product", "text"],
  ["grade", "Product grade", "text"],
  ["subgrade", "Product sub-grade", "text"],
  ["quantity", "Cargo quantity, tonnes", "number"],
  ["berth", "Quai / berth", "text"],
  ["equipment", "Equipment", "text"],
  ["eta", "Expected arrival", "text"],
  ["start", "Planned start", "text"],
  ["end", "Planned completion", "text"],
  ["duration_hours", "Operation duration, hours", "number"],
  ["loa", "Vessel length, metres", "number"],
  ["draft", "Vessel draft, metres", "number"],
  ["ready", "Cargo ready", "boolean"],
  ["priority", "Planning priority", "number"],
  ["status", "Operational status", "text"],
  ["progress", "Progress, %", "number"],
  ["delay_hours", "Delay duration, hours", "number"],
  ["delay_cause", "Delay cause", "text"],
  ["delay_description", "Delay explanation", "text"],
];
const LABELS = Object.fromEntries(
  IMPORT_FIELDS.map(([key, label]) => [key, label]),
);
const NUMBERS = new Set(
  IMPORT_FIELDS.filter((x) => x[2] === "number").map((x) => x[0]),
);
const ACCEPT =
  ".xlsx,.xlsm,.xlsb,.xls,.csv,.tsv,.pdf,.docx,.txt,.md,.png,.jpg,.jpeg";
const esc = (value) => P().esc(value ?? "");
export function filterImportItems(
  items,
  query = "",
  action = "",
  problems = false,
) {
  const q = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (!action || item.action === action) &&
      (!problems ||
        issues(item).length > 0 ||
        (item.warnings || item.validation?.warnings || []).length > 0) &&
      (!q ||
        JSON.stringify([
          item.data,
          item.proposed,
          item.action,
          item.evidence,
          item.errors,
          item.issues,
        ])
          .toLocaleLowerCase()
          .includes(q)),
  );
}
function issues(item) {
  return [
    ...(item.errors || item.validation?.errors || []),
    ...(item.issues || []),
  ];
}
function workspace() {
  const { S } = P();
  if (!S.documentWorkspace || S.documentWorkspace.port !== S.portId)
    S.documentWorkspace = {
      port: S.portId,
      batches: [],
      templates: [],
      loaded: false,
      loading: false,
      batch: null,
      query: "",
      filter: "",
      problems: false,
      error: "",
      reviewDirty: false,
      ai: null,
    };
  return S.documentWorkspace;
}
function current(w) {
  return P().S.portId === w.port && P().S.documentWorkspace === w;
}
function onScreen(tab) {
  return tab === "imports"
    ? P().S.page === "configuration" && P().S.configTab === "imports"
    : tab === "intelligence"
      ? P().S.page === "assistant"
      : P().S.page === "center" && P().S.tab === tab;
}
function redraw(tab = "imports") {
  if (onScreen(tab)) P().renderApp();
}
function icon(name) {
  return P().icon(name);
}
function label(key) {
  return LABELS[key] || String(key).replaceAll("_", " ");
}
function applied(b) {
  return Boolean(
    (Array.isArray(b?.applied) ? b.applied.length > 0 : b?.applied === true) ||
    /^(applied|partially applied|drafted|published|rolled.back|rollback)/i.test(
      b?.status || "",
    ),
  );
}
function canEdit(b) {
  return P().can("planning.draft") && !applied(b);
}
function pending(b) {
  return (b?.items || []).some(
    (x) => x.selected !== false && x.action !== "unchanged",
  );
}
function errorMessage(error) {
  return error?.message || "The request could not be completed.";
}
function date(value) {
  try {
    return value ? P().date(value) : "";
  } catch {
    return String(value || "");
  }
}
export function renderDocuments() {
  const w = workspace(),
    b = w.batch,
    { can } = P();
  return `<section class="document-workbench"><aside class="card document-library"><div class="card-head"><h3>${icon("files")}Import history</h3><button class="icon-btn" id="refresh-imports" aria-label="Refresh import history">${icon("refresh-cw")}</button></div><div class="document-library-tools">${can("planning.draft") ? `<button class="btn primary" id="upload-planning-document">${icon("upload")}Upload documents</button>` : ""}<p class="subtle">Excel, PDF, Word, CSV and scanned documents. Original files remain linked to each import.</p></div><label class="document-search">Find an import<input type="search" id="import-library-search" placeholder="File name or status…"></label><div class="document-library-list">${w.batches.map((item) => `<button class="document-batch ${item.id === b?.id ? "active" : ""}" data-import-id="${esc(item.id)}"><strong>${esc(item.filename)}</strong><span>${esc(item.status || "Ready for review")} · ${esc(item.method || "local")}${item.setup_candidates?.some(x=>x.status === "Pending administrator") ? " · Admin review requested" : ""}</span><small>${esc(date(item.created_at))}</small></button>`).join("") || `<div class="document-empty"><p>${w.loaded ? "No documents uploaded yet." : "Loading import history…"}</p></div>`}</div></aside><section class="card document-review">${b ? `<div class="toolbar">${can("config.edit") ? `<button class="btn small danger" id="remove-import-entry">Remove import</button>` : ""}</div>` + reviewPanel(w) : `<div class="card-head"><h3>${icon("file-input")}Document to planning</h3></div><div class="document-empty"><h3>Bring the latest company plan into the app</h3><p>Upload a document, check vessel matches and source references, then save proposals or apply validated changes. Reusable templates speed up later uploads.</p><div class="document-flow"><span>${icon("upload")}Upload</span><span>${icon("scan-text")}Extract</span><span>${icon("git-compare-arrows")}Review</span><span>${icon("calendar-check")}Update planning</span></div></div>`}${w.error ? `<div class="notice error" role="alert">${esc(w.error)}</div>` : ""}</section></section>`;
}
function setupPanel(batch) {
  const candidates = batch.setup_candidates || [];
  if (!candidates.length) return "";
  const pending = candidates.filter(x => x.status === "Pending administrator");
  return `<details class="document-setup" ${pending.length ? "open" : ""}><summary>Document setup · ${candidates.filter(x => ["Applied", "Matched"].includes(x.status)).length} populated / matched · ${pending.length} administrator requests</summary><div class="document-setup-list">${candidates.map(x => `<div class="document-setup-row"><div><strong>${esc(x.kind === "catalog" ? "Product specification" : x.kind === "berths" ? "Berth" : "Equipment")} · ${esc(x.data.product || x.data.code || x.data.name || "Unidentified")}</strong><small>${esc(x.status)}</small>${x.issues?.length ? `<p>${x.issues.map(esc).join(" · ")}</p>` : ""}</div>${x.status === "Pending administrator" && P().can("config.edit") ? `<button class="btn small" data-setup-review="${esc(x.id)}">Administrator review</button>` : ""}</div>`).join("")}</div></details>`;
}
function reviewSetup(w, candidate) {
  const fields = candidate.kind === "catalog" ? ["product","direction","grade","subgrade"] : candidate.kind === "berths" ? ["code","name","terminal","length","max_loa","max_draft","buffer_hours","cargo","status"] : ["name","type","capacity","status","berths"];
  const lists = new Set(["cargo","berths"]), numbers = new Set(["length","max_loa","max_draft","buffer_hours","capacity"]);
  P().modal("Administrator · confirm document setup", `<form id="setup-review-form"><p>Confirm missing values from your records. Existing conflicting configuration is never overwritten; resolve it in Configuration or skip this request.</p><div class="notice">${(candidate.issues || []).map(esc).join("<br>")}</div><div class="form-grid">${fields.map(field => `<label class="field">${esc(label(field))}${lists.has(field) ? " (comma separated; leave empty to confirm none)" : ""}<input name="${field}" type="${numbers.has(field) ? "number" : "text"}" ${numbers.has(field) ? 'step="any"' : ""} value="${esc(Array.isArray(candidate.data[field]) ? candidate.data[field].join(", ") : candidate.data[field] ?? "")}"></label>`).join("")}</div><details><summary>Source evidence</summary>${(candidate.evidence || []).map(e=>`<p><strong>${esc(e.ref)}</strong> · ${esc(e.column || e.field)}: ${esc(e.quote)}</p>`).join("")}</details><div class="form-actions"><button class="btn" type="button" id="skip-setup-request">Skip request</button><button class="btn primary" type="submit">Confirm and populate</button></div></form>`,true);
  const resolve = async (action,data) => {
    w.batch = await P().api("/ports/"+encodeURIComponent(w.port)+"/imports/"+w.batch.id+"/setup/"+candidate.id,"POST",{revision:w.batch.revision,action,data});
    P().closeModal();
    await P().refresh();
    await bootstrap(w,true);
    redraw();
  };
  P().handleForm("#setup-review-form", async values => {
    const data={};
    for (const field of fields) {
      if (lists.has(field)) data[field]=(values[field] || "").split(",").map(x=>x.trim()).filter(Boolean);
      else if (values[field] !== "") data[field]=numbers.has(field) ? Number(values[field]) : values[field];
    }
    await resolve("confirm",data);
  });
  document.querySelector("#skip-setup-request").onclick=async()=>{try{await resolve("skip");}catch(e){P().toast(e.message,true);}};
}
function reviewPanel(w) {
  const b = w.batch,
    rows = filterImportItems(b.items || [], w.query, w.filter, w.problems),
    editable = canEdit(b),
    needsDepartmentReview =
      (b.items || []).some(
        (x) => x.selected !== false && x.action === "update",
      ) && P().S.data.port.workflow?.approval_mode !== "automatic";
  const counts = (b.items || []).reduce(
    (out, x) => ((out[x.action] = (out[x.action] || 0) + 1), out),
    {},
  );
  return `<div class="card-head"><h3>${icon("file-check-2")}${esc(b.filename)}</h3><span class="subtle">${esc(b.status || "Review")} · revision ${esc(b.revision)}</span></div><div class="document-summary"><div><strong>${(b.items || []).length}</strong><span>Document rows</span></div><div><strong>${counts.create || 0}</strong><span>New calls</span></div><div><strong>${counts.update || 0}</strong><span>Updates</span></div><div><strong>${(b.items || []).filter((x) => issues(x).length).length}</strong><span>Need attention</span></div></div>${b.summary ? `<p class="document-context">${esc(b.summary)}</p>` : ""}${editable && needsDepartmentReview ? '<p class="document-context">Departmental approval is required for these updates. Use Save planning proposals, then review them in Approvals.</p>' : ""}${(b.warnings || []).length ? `<details class="document-warnings"><summary>${b.warnings.length} import note${b.warnings.length === 1 ? "" : "s"}</summary>${b.warnings.map((x) => `<p>${esc(x)}</p>`).join("")}</details>` : ""}${setupPanel(b)}<div class="toolbar document-actions"><a class="btn small" href="/api${P().path("/imports/" + b.id + "/source")}" download>${icon("download")}Original file</a><button class="btn small" id="import-source-text">${icon("scan-text")}Extracted source</button>${b.extraction?.tables?.length && editable ? `<button class="btn small" id="map-import-columns">${icon("columns-3")}Map columns</button>` : ""}${P().can("config.edit") && b.mapping && Object.keys(b.mapping).length ? '<button class="btn small" id="save-import-template">Save template</button>' : ""}<div class="spacer"></div>${/^(applied|partially applied|published)$/i.test(b.status || "") && Boolean(b.applied?.length) && P().can("planning.publish") ? '<button class="btn small danger" id="rollback-import">Restore previous plan</button>' : ""}</div><div class="toolbar document-filters"><div class="search-box">${icon("search")}<input type="search" id="import-items-search" aria-label="Search import rows" placeholder="Vessel, cargo or source reference…" value="${esc(w.query)}"></div><select id="import-action-filter" aria-label="Filter import action">${[
    ["", "All changes"],
    ["create", "New calls"],
    ["update", "Updates"],
    ["unchanged", "Unchanged"],
    ["ambiguous", "Uncertain matches"],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${w.filter === v ? "selected" : ""}>${t}</option>`,
    )
    .join(
      "",
    )}</select><label class="check-row"><input type="checkbox" id="import-problems-filter" ${w.problems ? "checked" : ""}>Needs attention</label><span class="subtle" id="import-result-count">${rows.length} of ${(b.items || []).length}</span></div><div class="table-scroll document-item-table"><table><thead><tr><th><input type="checkbox" id="import-select-all" aria-label="Select all eligible import rows" ${!editable ? "disabled" : ""}></th><th>Action</th><th>Vessel / cargo</th><th>Quai</th><th>Planning change</th><th>Validation</th><th></th></tr></thead><tbody id="import-item-rows">${renderRows(rows, b)}</tbody></table></div><div class="form-actions document-apply-actions"><span class="subtle">${applied(b) ? (b.status === "Drafted" ? "Planning proposals saved. Review and publish them in Workflow center → Approvals." : "This import has been processed. History and original source are retained.") : "Selected changes are validated again before saving. Existing approval rules still apply."}</span>${editable ? `<button class="btn" id="save-import-review">Save review</button><button class="btn" id="draft-import" ${!pending(b) ? "disabled" : ""}>${icon("git-pull-request")}Save planning proposals</button>${P().can("planning.publish") ? `<button class="btn primary" id="publish-import" ${!pending(b) || needsDepartmentReview ? "disabled" : ""}>${icon("calendar-check")}Apply selected changes</button>` : ""}` : ""}</div>`;
}
function renderRows(rows, b) {
  const editable = canEdit(b);
  return (
    rows
      .map((item) => {
        const d = item.proposed || item.data || {},
          raw = item.data || d,
          errors = issues(item),
          warnings = item.warnings || item.validation?.warnings || [];
        const changes = Object.entries(item.changes || {}).filter(
          ([key]) => !["id", "revision"].includes(key),
        );
        return `<tr data-import-row="${esc(item.id)}"><td><input type="checkbox" data-import-select="${esc(item.id)}" aria-label="Include ${esc(d.name || raw.name || "document row")}" ${item.selected !== false ? "checked" : ""} ${!editable || item.action === "unchanged" ? "disabled" : ""}></td><td><span class="status ${item.action === "ambiguous" ? "amber" : item.action === "create" ? "green" : item.action === "update" ? "blue" : ""}">${esc({ create: "New call", update: "Update", unchanged: "Unchanged", ambiguous: "Review match" }[item.action] || item.action || "Review")}</span></td><td><strong>${esc(d.name || raw.name || "Unnamed vessel")}</strong><small>${esc([d.product || raw.product, d.grade || raw.grade, d.quantity ? Number(d.quantity).toLocaleString() + " t" : ""].filter(Boolean).join(" · "))}</small>${item.match_id ? `<small>Matched: ${esc(P().S.data.calls.find((x) => x.id === item.match_id)?.name || item.match_id)}</small>` : ""}</td><td>${esc(raw.berth || P().S.data.berths.find((x) => x.id === d.berth_id)?.code || "—")}</td><td>${
          changes
            .slice(0, 4)
            .map(
              ([key, value]) =>
                `<small><b>${esc(label(key))}:</b> ${esc(typeof value === "object" ? JSON.stringify(value) : value)}</small>`,
            )
            .join("") ||
          `<small>${esc(d.start || raw.start || "No start supplied")}</small><small>${esc(d.end || raw.end || "No completion supplied")}</small>`
        }</td><td>${errors.length ? `<span class="status red">${errors.length} issue${errors.length === 1 ? "" : "s"}</span><small>${esc(errors[0])}</small>` : warnings.length ? `<span class="status amber">Review notes</span><small>${esc(warnings[0])}</small>` : '<span class="status green">Checks passed</span>'}</td><td><button class="btn small" data-import-evidence="${esc(item.id)}">Source</button>${editable ? `<button class="btn small" data-import-edit="${esc(item.id)}">Review</button>` : ""}</td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="7">No document rows match these filters. Map the source columns or widen the filters.</td></tr>'
  );
}
async function bootstrap(w, force = false) {
  if (w.loading || (w.loaded && !force)) return;
  w.loading = true;
  const port = w.port,
    { api } = P(),
    base = "/ports/" + encodeURIComponent(port);
  const results = await Promise.allSettled([
    api(base + "/imports"),
    api(base + "/intelligence/status"),
  ]);
  if (!current(w)) return;
  w.loading = false;
  w.loaded = true;
  if (results[0].status === "fulfilled") {
    w.batches = results[0].value.batches || [];
    w.templates = results[0].value.templates || [];
    w.error = "";
  } else w.error = errorMessage(results[0].reason);
  if (results[1].status === "fulfilled") w.ai = results[1].value;
  else w.ai = { configured: false, message: errorMessage(results[1].reason) };
  redraw();
}
async function loadBatch(id, w = workspace()) {
  try {
    const batch = await P().api(
      "/ports/" +
        encodeURIComponent(w.port) +
        "/imports/" +
        encodeURIComponent(id),
    );
    if (!current(w)) return;
    w.batch = batch;
    w.reviewDirty = false;
    w.query = "";
    w.filter = "";
    w.problems = false;
    w.error = "";
    redraw();
  } catch (e) {
    if (current(w)) {
      w.error = errorMessage(e);
      redraw();
    }
  }
}
export function bindDocuments() {
  const w = workspace();
  document.querySelector('#remove-import-entry')?.addEventListener('click', () => {
    const b = w.batch;
    confirmRemoval(P().path(`/imports/${b.id}?revision=${b.revision}`), b.filename, 'Only unprocessed imports can be removed. Applied changes and operational history are retained.', async () => {
      w.batch = null;
      await bootstrap(w, true);
    });
  });
  document.querySelectorAll("[data-setup-review]").forEach(button => button.onclick=()=>reviewSetup(w,w.batch.setup_candidates.find(x=>x.id===button.dataset.setupReview)));
  document
    .querySelector("#upload-planning-document")
    ?.addEventListener("click", () => uploadDialog(w));
  document
    .querySelector("#refresh-imports")
    ?.addEventListener("click", () => bootstrap(w, true));
  document
    .querySelectorAll("[data-import-id]")
    .forEach(
      (button) =>
        (button.onclick = () => loadBatch(button.dataset.importId, w)),
    );
  document
    .querySelector("#import-library-search")
    ?.addEventListener("input", (e) =>
      document
        .querySelectorAll(".document-batch")
        .forEach(
          (x) =>
            (x.hidden = !x.textContent
              .toLocaleLowerCase()
              .includes(e.target.value.toLocaleLowerCase())),
        ),
    );
  document
    .querySelector("#import-items-search")
    ?.addEventListener("input", (e) => {
      w.query = e.target.value;
      updateRows(w);
    });
  document
    .querySelector("#import-action-filter")
    ?.addEventListener("change", (e) => {
      w.filter = e.target.value;
      updateRows(w);
    });
  document
    .querySelector("#import-problems-filter")
    ?.addEventListener("change", (e) => {
      w.problems = e.target.checked;
      updateRows(w);
    });
  document
    .querySelector("#import-select-all")
    ?.addEventListener("change", (e) => {
      filterImportItems(w.batch.items, w.query, w.filter, w.problems)
        .filter((x) => x.action !== "unchanged")
        .forEach((x) => (x.selected = e.target.checked));
      w.reviewDirty = true;
      updateRows(w);
    });
  document
    .querySelector("#import-source-text")
    ?.addEventListener("click", () => sourceDialog(w.batch));
  document
    .querySelector("#map-import-columns")
    ?.addEventListener("click", () => mappingDialog(w));
  document
    .querySelector("#save-import-template")
    ?.addEventListener("click", () => templateDialog(w));
  document
    .querySelector("#save-import-review")
    ?.addEventListener("click", () => saveReview(w));
  document
    .querySelector("#draft-import")
    ?.addEventListener("click", () => applyDialog(w, "draft"));
  document
    .querySelector("#publish-import")
    ?.addEventListener("click", () => applyDialog(w, "publish"));
  document
    .querySelector("#rollback-import")
    ?.addEventListener("click", () => rollbackDialog(w));
  bindRows(w);
  if (!w.loaded && !w.loading) bootstrap(w);
}
function updateRows(w) {
  const rows = filterImportItems(
      w.batch.items || [],
      w.query,
      w.filter,
      w.problems,
    ),
    host = document.querySelector("#import-item-rows");
  if (!host) return;
  host.innerHTML = renderRows(rows, w.batch);
  document.querySelector("#import-result-count").textContent =
    `${rows.length} of ${w.batch.items.length}`;
  bindRows(w);
}
function bindRows(w) {
  document.querySelectorAll("[data-import-select]").forEach(
    (input) =>
      (input.onchange = () => {
        const item = w.batch.items.find(
          (x) => String(x.id) === input.dataset.importSelect,
        );
        if (item) {
          item.selected = input.checked;
          w.reviewDirty = true;
        }
      }),
  );
  document.querySelectorAll("[data-import-edit]").forEach(
    (button) =>
      (button.onclick = () =>
        rowDialog(
          w,
          w.batch.items.find((x) => String(x.id) === button.dataset.importEdit),
        )),
  );
  document.querySelectorAll("[data-import-evidence]").forEach(
    (button) =>
      (button.onclick = () =>
        evidenceDialog(
          w.batch,
          w.batch.items.find(
            (x) => String(x.id) === button.dataset.importEvidence,
          ),
        )),
  );
}
function formFooter(text = "Save") {
  return `<div class="form-actions"><button class="btn primary" type="submit">${text}</button></div>`;
}
function uploadDialog(w) {
  const { modal, handleForm, api, closeModal, toast } = P(),
    ai = w.ai;
  modal(
    "Import documents and initialize workspace",
    `<form id="upload-document-form"><label class="field">Documents<input type="file" multiple id="planning-document-file" accept="${ACCEPT}" required></label><p class="subtle">Maximum file size: 8 MB.</p><label class="check-row"><input type="checkbox" name="initialize" ${!P().S.data.berths.length || !P().S.data.port.products.length ? "checked" : ""}>Initialize configuration from documents</label><div class="form-grid"><label class="field">Document date<input type="date" name="document_date"></label><label class="field">Source date format<select name="date_order"><option value="ISO">ISO · year-month-day</option><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option></select></label><label class="field">Reusable template<select name="template_id"><option value="">Detect columns / review manually</option>${w.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.auto_apply ? " · trusted automatic update" : ""}</option>`).join("")}</select></label><label class="field full">Planning context<textarea name="context" rows="3" maxlength="4000" placeholder="Optional context for interpreting this document."></textarea></label><div class="field full"><label class="check-row"><input type="checkbox" name="use_ai" ${ai?.configured ? "" : "disabled"}>Use AI assistance</label>${ai?.configured ? `<details class="ai-data-use"><summary>Data use</summary><p>${ai.free_only ? "The selected document and relevant port records are sent to OpenRouter." : "The selected document and relevant port records are processed by the configured AI service."}</p></details>` : '<small>AI assistance unavailable</small>'}</div></div><div class="notice">${icon("file-check")}Uploading a document does not by itself replace the plan. A trusted automatic template may apply valid matching updates; other imports open for review.</div>${formFooter("Extract document")}</form>`,
    true,
  );
  document.querySelector(
    '#upload-document-form [name="template_id"]',
  ).onchange = (e) => {
    const template = w.templates.find((t) => t.id === e.target.value);
    document.querySelector('#upload-document-form [name="date_order"]').value =
      template?.date_order || "ISO";
  };
  handleForm("#upload-document-form", async (d, form) => {
    const files = [...document.querySelector("#planning-document-file").files];
    if (!files.length) throw new Error("Select documents to import.");
    if (files.some(file=>file.size>8*1024*1024)) throw new Error("Each document must be no larger than 8 MB.");
    if (d.use_ai === "on" && files.some(file=>/\.(png|jpe?g)$/i.test(file.name)) && !ai?.vision) throw new Error("This AI connection does not support scanned images. Use text documents or configure vision.");
    const button = form.querySelector("[type=submit]");
    let batch;
    try {
      for (const [index,file] of files.entries()) {
        button.textContent=`Reading ${index+1} of ${files.length}…`;
        batch=await api("/ports/"+encodeURIComponent(w.port)+"/imports/upload","POST",{
          filename:file.name,content_base64:await fileBase64(file),method:d.use_ai === "on" ? "ai" : "local",
          initialize:d.initialize === "on",document_date:d.document_date || null,context:d.context || "",date_order:d.date_order || "ISO",template_id:d.template_id || null,
        });
      }
    } catch (error) {
      await bootstrap(w,true);
      throw error;
    } finally { button.textContent="Extract document"; }
    if (!current(w)) return;
    closeModal();
    w.batch = batch;
    w.loaded = false;
    w.error = "";
    await P().refresh();
    await bootstrap(w, true);
    toast(
      applied(batch)
        ? "Trusted document update applied."
        : "Document extracted. Review matches and validation before applying changes.",
    );
  });
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}
function mappingDialog(w) {
  const b = w.batch,
    tables = b.extraction?.tables || [],
    { modal, handleForm, api, closeModal } = P();
  modal(
    "Map document columns",
    `<form id="import-mapping-form"><label class="field">Source table<select id="import-table-index" name="table_index">${tables.map((t, i) => `<option value="${i}" ${i === (b.table_index || 0) ? "selected" : ""}>${esc(t.name || "Table " + (i + 1))} · ${(t.rows || []).length} rows</option>`).join("")}</select></label><div class="form-grid"><label class="field">Header row override<input type="number" name="header_row" id="import-header-row" min="0" max="5000" value="${esc(b.header_row || 0)}"><small>0 uses the extracted header. 1 uses the first data row as the header.</small></label><label class="field">Source date format<select name="date_order"><option value="ISO">ISO · year-month-day</option><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option></select></label></div><p class="subtle">Match the source columns to operational fields. Leave fields blank when the document does not supply them. Existing matched calls retain values that are not supplied.</p><div class="document-mapping-grid" id="import-mapping-fields"></div><label class="field">Document date<input type="date" name="document_date" value="${esc(b.document_date || "")}"></label>${formFooter("Rebuild import preview")}</form>`,
    true,
  );
  const draw = (index) => {
    const override =
      Number(document.querySelector("#import-header-row").value) || 0;
    const table = tables[index];
    const headers = override
      ? (table?.rows?.[override - 1]?.values || []).map((v, i) =>
          String(v == null || v === "" ? "Column " + (i + 1) : v).trim(),
        )
      : table?.headers || [];
    document.querySelector("#import-mapping-fields").innerHTML =
      IMPORT_FIELDS.map(
        ([key, title]) =>
          `<label class="field">${esc(title)}<select name="map_${key}"><option value="">Not supplied</option>${headers.map((header) => `<option value="${esc(header)}" ${b.mapping?.[key] === header ? "selected" : ""}>${esc(header)}</option>`).join("")}</select></label>`,
      ).join("");
  };
  draw(b.table_index || 0);
  document.querySelector('#import-mapping-form [name="date_order"]').value =
    b.date_order || "ISO";
  document.querySelector("#import-table-index").onchange = (e) =>
    draw(Number(e.target.value));
  document.querySelector("#import-header-row").oninput = () =>
    draw(Number(document.querySelector("#import-table-index").value));
  handleForm("#import-mapping-form", async (d) => {
    const mapping = Object.fromEntries(
      IMPORT_FIELDS.map(([key]) => [key, d["map_" + key]]).filter(
        ([, value]) => value,
      ),
    );
    const batch = await api(
      "/ports/" + encodeURIComponent(w.port) + "/imports/" + b.id + "/map",
      "POST",
      {
        revision: b.revision,
        table_index: Number(d.table_index),
        header_row: Number(d.header_row) || 0,
        date_order: d.date_order || "ISO",
        mapping,
        document_date: d.document_date || null,
        context: b.context || "",
      },
    );
    if (!current(w)) return;
    w.batch = batch;
    w.reviewDirty = false;
    closeModal();
    redraw();
  });
}
export function editedImportData(formValues, previous = {}) {
  const data = { ...previous };
  for (const [key, , type] of IMPORT_FIELDS) {
    const value = formValues[key];
    if (value === undefined) continue;
    if (value === "") {
      delete data[key];
      continue;
    }
    if (type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number))
        throw new Error(label(key) + " must be a finite number.");
      data[key] = number;
    } else if (type === "boolean") data[key] = value === "true";
    else data[key] = String(value).trim();
  }
  return data;
}
export function reviewData(item) {
  return { ...(item.data || {}), ...(item.normalized_data || {}) };
}
function rowDialog(w, item) {
  if (!item) return;
  const data = reviewData(item),
    { modal, handleForm, api, closeModal } = P();
  modal(
    "Review extracted vessel row",
    `<form id="import-row-form"><label class="field">Match to an existing vessel call<select name="match_id"><option value="__unconfirmed__" ${!item.match_id && item.action === "ambiguous" ? "selected" : ""}>Choose the correct vessel call…</option><option value="__new__" ${!item.match_id && item.action !== "ambiguous" ? "selected" : ""}>Create a new vessel call / new voyage</option>${P()
      .S.data.calls.map(
        (c) =>
          `<option value="${esc(c.id)}" ${item.match_id === c.id ? "selected" : ""}>${esc(c.name)} · ${esc(c.start || c.eta || "")} · ${esc(P().S.data.berths.find((b) => b.id === c.berth_id)?.code || "Unassigned")}</option>`,
      )
      .join(
        "",
      )}</select></label><p class="subtle">Values below use tonnes, hours and metres after any supported source conversion. Confirm them against the source document. Dates should include a full year and time; the port timezone is ${esc(P().S.data.port.timezone)}. Empty fields remain unspecified.</p><div class="document-mapping-grid">${IMPORT_FIELDS.map(([key, title, type]) => `<label class="field">${esc(title)}${type === "boolean" ? `<select name="${key}"><option value="">Not supplied</option><option value="true" ${data[key] === true ? "selected" : ""}>Ready</option><option value="false" ${data[key] === false ? "selected" : ""}>Not ready</option></select>` : `<input name="${key}" type="${type === "number" ? "number" : "text"}" ${type === "number" ? 'step="any"' : ""} value="${esc(data[key] ?? "")}">`}</label>`).join("")}</div><label class="check-row"><input type="checkbox" name="selected" ${item.selected !== false ? "checked" : ""}>Include this row in the import</label><div class="notice">Confirmed conversions and edited values are retained as manual confirmations. The original source remains available; these values are not presented as verbatim source quotes.</div>${formFooter("Validate corrected row")}</form>`,
    true,
  );
  handleForm("#import-row-form", async (d) => {
    const data = editedImportData(d, item.data || {});
    const rows = w.batch.items.map((x) => ({
      id: x.id,
      selected: x.id === item.id ? d.selected === "on" : x.selected !== false,
      data: x.id === item.id ? data : x.data,
      match_id:
        x.id === item.id
          ? d.match_id.startsWith("__")
            ? null
            : d.match_id || null
          : x.match_id || null,
      ...(x.id === item.id && d.match_id === "__new__"
        ? { new_call: true }
        : {}),
    }));
    const batch = await api(
      "/ports/" +
        encodeURIComponent(w.port) +
        "/imports/" +
        w.batch.id +
        "/review",
      "POST",
      { revision: w.batch.revision, items: rows },
    );
    if (!current(w)) return;
    w.batch = batch;
    w.reviewDirty = false;
    closeModal();
    redraw();
  });
}
function sourceDialog(b) {
  const { modal } = P(),
    blocks = b.extraction?.blocks || [],
    tables = b.extraction?.tables || [];
  modal(
    "Extracted document source",
    `<div class="notice">${esc(b.filename)} · Source text is reference material. Operational changes are applied only from the validated import preview.</div><div class="document-source-scroll">${blocks.map((block) => `<section class="document-source-block"><h3>${esc(block.ref)}</h3><pre>${esc(block.text)}</pre></section>`).join("")}${
      tables
        .map(
          (t) =>
            `<section class="document-source-block"><h3>${esc(t.name)}</h3><div class="table-scroll"><table><thead><tr><th>Source row</th>${(t.headers || []).map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${(
              t.rows || []
            )
              .slice(0, 500)
              .map(
                (row) =>
                  `<tr><td>${esc(row.ref)}</td>${(row.values || []).map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`,
              )
              .join(
                "",
              )}</tbody></table></div>${(t.rows || []).length > 500 ? '<p class="subtle">Showing the first 500 source rows. Download the original file for the complete table.</p>' : ""}</section>`,
        )
        .join("") ||
      (!blocks.length
        ? "<p>No machine-readable text was found. Use an AI provider with document vision for scanned content.</p>"
        : "")
    }</div>`,
    true,
  );
}
function evidenceDialog(b, item) {
  if (!item) return;
  P().modal(
    "Source references",
    `<div class="notice">${esc(b.filename)} · ${esc(item.data?.name || item.proposed?.name || "Document row")}</div><div class="table-scroll"><table><thead><tr><th>Field</th><th>Page / sheet / row</th><th>Extracted evidence</th></tr></thead><tbody>${(item.evidence || []).map((e) => `<tr><td>${esc(label(e.field))}</td><td>${esc(e.ref)}</td><td>${esc(e.quote)}</td></tr>`).join("") || '<tr><td colspan="3">No direct source evidence is available for this row. Check the original file and review the values manually.</td></tr>'}</tbody></table></div>${[...issues(item), ...(item.warnings || [])].map((x) => `<p class="subtle">${esc(x)}</p>`).join("")}`,
    true,
  );
}
async function saveReview(w, quiet = false) {
  try {
    const batch = await P().api(
      "/ports/" +
        encodeURIComponent(w.port) +
        "/imports/" +
        w.batch.id +
        "/review",
      "POST",
      {
        revision: w.batch.revision,
        items: w.batch.items.map((x) => ({
          id: x.id,
          selected: x.selected !== false,
          data: x.data || {},
          match_id: x.match_id || null,
        })),
      },
    );
    if (!current(w)) return null;
    w.batch = batch;
    w.reviewDirty = false;
    if (!quiet) {
      P().toast("Review saved and validation refreshed.");
      redraw();
    }
    return batch;
  } catch (e) {
    if (!quiet) P().toast(errorMessage(e), true);
    else throw e;
    return null;
  }
}
function applyDialog(w, mode) {
  const { modal, handleForm, api, closeModal, refresh, toast } = P();
  modal(
    mode === "publish"
      ? "Apply selected planning changes"
      : "Save planning proposals",
    `<form id="apply-document-form"><p>${mode === "publish" ? "Apply selected changes that qualify under the configured approval policy. Existing calls requiring departmental approval must be saved as planning proposals. Hard conflicts block publication." : "Save the selected changes as proposals for the configured approval workflow. The published schedule will remain unchanged."}</p><p class="subtle">The import retains source references and a record of the previous plan. Rows not selected will be skipped.</p>${formFooter(mode === "publish" ? "Apply selected changes" : "Save proposals")}</form>`,
  );
  handleForm("#apply-document-form", async () => {
    if (w.reviewDirty)
      throw new Error(
        "Save review first to validate the selected rows and inspect the refreshed preview.",
      );
    const batch = w.batch;
    const result = await api(
      "/ports/" +
        encodeURIComponent(w.port) +
        "/imports/" +
        batch.id +
        "/apply",
      "POST",
      { revision: batch.revision, mode },
    );
    if (!current(w)) return;
    w.batch = result.batch || result;
    closeModal();
    await refresh(false);
    w.loaded = false;
    await bootstrap(w, true);
    toast(
      mode === "publish"
        ? "Planning changes applied."
        : "Planning proposals saved.",
    );
  });
}
function rollbackDialog(w) {
  const { modal, handleForm, api, closeModal, refresh, toast } = P();
  modal(
    "Restore the plan before this import",
    `<form id="rollback-document-form"><p>Restore the vessel records changed by this import. Calls created by the import will be cancelled. Restoration is blocked if an affected call has changed since the import.</p>${formFooter("Restore previous plan")}</form>`,
  );
  handleForm("#rollback-document-form", async () => {
    const result = await api(
      "/ports/" +
        encodeURIComponent(w.port) +
        "/imports/" +
        w.batch.id +
        "/rollback",
      "POST",
      { revision: w.batch.revision },
    );
    if (!current(w)) return;
    w.batch = result.batch || result;
    closeModal();
    await refresh(false);
    w.loaded = false;
    await bootstrap(w, true);
    toast("Previous planning state restored.");
  });
}
function templateDialog(w) {
  const { modal, handleForm, api, closeModal, toast } = P();
  modal(
    "Save a reusable import template",
    `<form id="import-template-form"><label class="field">Template name<input name="name" required maxlength="100" placeholder="Weekly fertilizer lineup"></label><label class="check-row"><input type="checkbox" name="auto_apply" ${w.batch.method === "local" && P().can("planning.publish") ? "" : "disabled"}>Automatically apply trusted matching updates</label><p class="subtle">Automatic application requires a valid local table import and the uploader’s permissions. Existing-call changes also follow the configured approval policy. Ambiguous values and AI interpretations require review.</p>${formFooter("Save template")}</form>`,
  );
  handleForm("#import-template-form", async (d) => {
    await api(
      "/ports/" +
        encodeURIComponent(w.port) +
        "/imports/" +
        w.batch.id +
        "/template",
      "POST",
      {
        revision: w.batch.revision,
        name: d.name,
        auto_apply: d.auto_apply === "on",
      },
    );
    if (!current(w)) return;
    closeModal();
    w.loaded = false;
    await bootstrap(w, true);
    toast("Import template saved.");
  });
}
export function assistantState() {
  const { S } = P();
  if (!S.operationalAssistant || S.operationalAssistant.port !== S.portId)
    S.operationalAssistant = {
      port: S.portId,
      loaded: false,
      loading: false,
      analysis: null,
      ai: null,
      error: "",
      answer: null,
    };
  return S.operationalAssistant;
}
const metricLabels = {
  calls: "Vessel calls",
  active_calls: "Active calls",
  berths: "Configured berths",
  equipment: "Equipment assets",
  conflicts: "Planning conflicts",
  calls_with_constraints: "Calls with planning constraints",
  equipment_at_capacity: "Equipment at capacity",
  unready: "Cargo not ready",
  occupied_berths: "Occupied berths",
  delay_hours: "Recorded delay hours",
  total_delay_hours: "Recorded delay hours",
  utilization: "Berth utilization",
  waiting_hours: "Waiting hours",
  waiting_calls: "Waiting vessel calls",
  incomplete_calls: "Calls with missing planning data",
  recorded_delay_hours: "Recorded delay hours",
  unready_calls: "Cargo not ready",
  equipment_bottlenecks: "Equipment bottlenecks",
};
function findingEvidence(f) {
  return (f.evidence || []).map((e) =>
    typeof e === "string" ? e : JSON.stringify(e),
  );
}
export function renderAssistant() {
  const s = assistantState(),
    findings = s.analysis?.findings || [];
  const selected =
    findings.find((f) => f.id === s.selectedFinding) || findings[0];
  const query = (s.findingQuery || "").toLocaleLowerCase();
  const matches = (f) => JSON.stringify(f).toLocaleLowerCase().includes(query);
  const metrics = Object.entries(s.analysis?.metrics || {}).filter(
    ([, value]) => typeof value === "number",
  );
  return `<section class="card intelligence-workbench">
    <div class="card-head"><h3>${icon("activity")}Operational intelligence</h3><button class="btn" id="refresh-intelligence" ${s.loading || s.asking ? "disabled" : ""}>${icon("refresh-cw")}<span>${s.loading ? "Refreshing…" : "Refresh analysis"}</span></button></div>
    <div class="intelligence-intro"><div class="intelligence-context"><span title="${esc(s.analysis?.metrics?.occupancy_basis || "")}">${icon("clock-3")}${s.analysis?.metrics?.window_start ? `${esc(date(s.analysis.metrics.window_start))} – ${esc(date(s.analysis.metrics.window_end))} · 48-hour planning window` : "Current planning window"}</span></div></div>
    ${s.error ? `<div class="notice error" role="alert">${esc(s.error)}</div>` : ""}
    <div class="intelligence-metrics">${metrics.map(([key, value]) => `<div><strong>${Number(value).toLocaleString(getLocale(), { maximumFractionDigits: 2 })}</strong><span>${esc(metricLabels[key] || label(key))}</span></div>`).join("")}</div>
    <div class="intelligence-layout"><div class="intelligence-findings">
      <div class="toolbar"><label class="search-box">${icon("search")}<input type="search" id="intelligence-search" placeholder="Find a bottleneck or vessel…" aria-label="Search operational findings" value="${esc(s.findingQuery || "")}"></label><span class="subtle" id="intelligence-count">${findings.filter(matches).length} of ${findings.length} findings</span></div>
      <div class="intelligence-finding-list" aria-label="Operational findings">${findings.map((f, index) => `<button type="button" class="intelligence-finding ${f === selected ? "selected" : ""}" data-finding-id="${esc(f.id)}" data-finding-text="${esc(JSON.stringify(f).toLocaleLowerCase())}" aria-pressed="${f === selected}" ${matches(f) ? "" : "hidden"}><span class="finding-index">${index + 1}</span><span class="finding-copy"><strong>${esc(f.title)}</strong><small>${esc(findingEvidence(f)[0] || "Select to review the evidence")}</small></span><span class="status ${/high|critical/i.test(f.severity) ? "red" : /medium|warning/i.test(f.severity) ? "amber" : "blue"}">${esc(f.severity || "Information")}</span>${icon("chevron-right")}</button>`).join("") || `<div class="document-empty"><h3>${s.loaded ? "No operational findings" : "Loading operational checks…"}</h3><p>${s.loaded ? "No supported checks identified a current bottleneck." : "Reading the current planning and operational records."}</p></div>`}</div>

    </div><aside class="intelligence-question"><h3>${icon("messages-square")}Ask the planning assistant</h3>${s.ai?.external || s.ai?.free_only ? `<details class="ai-data-use"><summary>Data use</summary><p>Your question and current analysis are sent to ${s.ai.free_only ? "OpenRouter" : "the configured AI service"}.</p></details>` : ""}<form id="intelligence-question-form"><label class="field">Operational question<textarea name="question" required maxlength="2000" rows="3" placeholder="Which constraint should the planning team address first?">${esc(s.question || "")}</textarea></label><button class="btn primary" type="submit" ${!s.ai?.configured || s.asking ? "disabled" : ""}>${icon(s.asking ? "loader-circle" : "sparkles")}<span>${s.asking ? "Analyzing findings…" : "Explain the findings"}</span></button></form>${!s.ai?.configured ? '<p class="subtle">AI assistance unavailable</p>' : ""}      <details class="intelligence-detail" aria-label="Selected finding" ${s.answer || s.asking ? "" : "open"}>${
      selected
        ? `<summary class="intelligence-detail-heading"><h3>${icon("list-checks")}Finding ${findings.indexOf(selected) + 1} · Evidence & recommendation</h3></summary><ul>${findingEvidence(
            selected,
          )
            .map((e) => `<li>${esc(e)}</li>`)
            .join(
              "",
            )}</ul><p><strong>Recommended action</strong> ${esc(selected.recommendation)}</p>`
        : ""
    }</details><div id="intelligence-answer" class="intelligence-answer" aria-live="polite">${s.asking ? '<p class="subtle">Analyzing…</p>' : s.answer ? renderAnswer(s.answer) : ""}</div></aside></div></section>`;
}
function renderAnswer(answer) {
  const findings = assistantState().analysis?.findings || [];
  const references = (answer.findings || answer.citations || []).map(
    (value) => {
      const id = typeof value === "string" ? value : value.id;
      const index = findings.findIndex((f) => f.id === id);
      return index >= 0 ? "Finding " + (index + 1) : "Source reference";
    },
  );
  return `<h3>Assistant explanation</h3><p>${esc(answer.answer || answer.summary || "")}</p>${references.length ? `<small class="subtle">References: ${references.map(esc).join(", ")}</small>` : ""}`;
}

export function bindAssistant() {
  const s = assistantState(),
    { api, handleForm, toast } = P();
  const load = async () => {
    if (s.loading) return;
    s.loading = true;
    const base = "/ports/" + encodeURIComponent(s.port);
    const results = await Promise.allSettled([
      api(base + "/intelligence/analysis"),
      api(base + "/intelligence/status"),
    ]);
    if (P().S.operationalAssistant !== s || P().S.portId !== s.port) return;
    s.loading = false;
    s.loaded = true;
    if (results[0].status === "fulfilled") {
      s.analysis = results[0].value;
      s.error = "";
    } else s.error = errorMessage(results[0].reason);
    if (results[1].status === "fulfilled") s.ai = results[1].value;
    else s.ai = { configured: false, message: errorMessage(results[1].reason) };
    redraw("intelligence");
  };
  document
    .querySelector("#refresh-intelligence")
    ?.addEventListener("click", () => {
      s.answer = null;
      load();
    });
  document
    .querySelector('#intelligence-question-form [name="question"]')
    ?.addEventListener("input", (e) => {
      s.question = e.target.value;
    });
  document
    .querySelector("#intelligence-search")
    ?.addEventListener("input", (e) => {
      s.findingQuery = e.target.value;
      let count = 0;
      document.querySelectorAll("[data-finding-text]").forEach((el) => {
        el.hidden = !el.dataset.findingText.includes(
          s.findingQuery.toLocaleLowerCase(),
        );
        if (!el.hidden) count++;
      });
      document.querySelector("#intelligence-count").textContent =
        `${count} of ${s.analysis?.findings?.length || 0} findings`;
    });
  document.querySelectorAll("[data-finding-id]").forEach((el) =>
    el.addEventListener("click", () => {
      s.selectedFinding = el.dataset.findingId;
      redraw("intelligence");
      document
        .querySelector(`[data-finding-id="${CSS.escape(s.selectedFinding)}"]`)
        ?.focus();
    }),
  );
  handleForm("#intelligence-question-form", async (d) => {
    if (s.asking) return;
    s.asking = true;
    redraw("intelligence");
    try {
      const answer = await api(
        "/ports/" + encodeURIComponent(s.port) + "/intelligence/explain",
        "POST",
        { question: d.question },
      );
      if (P().S.operationalAssistant !== s || P().S.portId !== s.port) return;
      s.answer = answer;
    } finally {
      s.asking = false;
      redraw("intelligence");
    }
  });
  if (!s.loaded && !s.loading) load();
}
