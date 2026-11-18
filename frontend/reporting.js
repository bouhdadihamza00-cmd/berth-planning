import { getLocale } from "./preferences.js?v=7";
const P = () => window.P;
const datasets = [
  ["daily_situation", "Daily situation"],
  ["vessel_lineup", "Vessel lineup"],
  ["cargo_lots", "Cargo specifications / lots"],
  ["berth_plan", "Berth planning"],
  ["delays", "Operational delays"],
  ["actuals", "Recorded actuals"],
  ["readiness", "Cargo readiness"],
  ["approvals", "Approval decisions"],
  ["plan_changes", "Schedule changes"],
  ["equipment", "Equipment availability"],
];
function state() {
  const { S } = P();
  if (!S.customReport || S.customReportPort !== S.portId) {
    S.customReportPort = S.portId;
    const day = S.data.port.excel_source?.report_date;
    S.customReport = {
      dataset: "daily_situation",
      origin: day ? "original" : "working",
      start: day || "",
      end: day || "",
      date_basis: "report_date",
      group_by: "none",
      limit: 500,
    };
    S.customReportResult = null;
    S.customReportError = "";
  }
  return S.customReport;
}
function options(values, selected) {
  return values
    .map(
      ([v, label]) =>
        `<option value="${P().esc(v)}" ${v === selected ? "selected" : ""}>${P().esc(label)}</option>`,
    )
    .join("");
}
function select(label, key, values) {
  return `<label>${label}<select data-report-key="${key}">${options(values, state()[key])}</select></label>`;
}
function input(label, key, type = "text") {
  return `<label>${label}<input type="${type}" data-report-key="${key}" value="${P().esc(state()[key] || "")}" ${type === "text" ? 'placeholder="Any"' : ""}></label>`;
}
function multi(label, key, values) {
  const selected = state()[key] || [];
  const summary = selected.length ? selected.join(", ") : "All";
  return `<div class="report-multi-field"><span id="report-label-${key}">${label}</span><details class="report-multi-dropdown" data-report-multi="${key}"><summary aria-labelledby="report-label-${key} report-summary-${key}"><span id="report-summary-${key}" title="${P().esc(summary)}">${P().esc(summary)}</span>${P().icon("chevron-down")}</summary><div class="report-multi-options" role="group" aria-labelledby="report-label-${key}">${values.map(v => `<label><input type="checkbox" value="${P().esc(v)}" ${selected.includes(v) ? "checked" : ""}><span>${P().esc(v)}</span></label>`).join("") || '<span class="subtle">No options available</span>'}</div></details></div>`;
}
export function renderReports() {
  const { S, esc, icon, can } = P();
  const q = state(),
    result = S.customReportResult;
  const sources =
    q.origin === "original"
      ? S.data.calls
          .filter((c) => c.source_snapshot)
          .map((c) => c.source_snapshot)
      : S.data.calls;
  const unique = (key) =>
    [...new Set(sources.map((c) => c[key]).filter(Boolean))].sort();
  const rows = result?.rows || [],
    fields = result?.fields || [];
  return `<section class="report-workbench"><aside class="card report-builder"><div class="card-head"><h3>${icon("list-filter")}Build your report</h3></div><div class="report-controls"><section class="report-section"><h4>01 · Data source</h4>
    ${select("Data type", "dataset", datasets)}
    ${select("Data version", "origin", [
      ["working", "Current working version"],
      ["original", "Original workbook snapshot"],
    ])}
    </section><section class="report-section"><h4>02 · Period & presentation</h4><div class="report-date-grid">${input("From", "start", "date")}${input("Through", "end", "date")}</div>
    ${select("Apply date interval to", "date_basis", [
      ["report_date", "Workbook date / working planned start"],
      ["eta", "Expected arrival"],
      ["start", "Planned start"],
      ["end", "Planned completion"],
      ["overlap", "Any planned overlap"],
      ["actual_arrival", "Actual arrival"],
      ["actual_start", "Actual operation start"],
      ["actual_end", "Actual completion"],
      ["event_time", "Recorded event / decision"],
    ])}
    ${select("Group results", "group_by", [
      ["none", "Individual records"],
      ["product", "Product"],
      ["grade", "Grade"],
      ["berth", "Quai / berth"],
      ["direction", "Import / export"],
      ["status", "Status"],
      ["day", "Day"],
      ["week", "Week (Monday)"],
      ["month", "Month"],
      ["year", "Year"],
    ])}
    </section><section class="report-section"><h4>03 · Narrow your results</h4>${input("Search records", "search")}<details class="report-advanced"><summary>Advanced filters</summary><div class="report-filter-grid">${input("Customer / destination", "customer")}${input("Supplier / origin", "supplier")}
    ${multi("Import / export", "directions", unique("direction"))}${multi("Products", "products", unique("product"))}${multi("Grades", "grades", unique("grade"))}${multi("Sub-grades", "subgrades", unique("subgrade"))}
    ${multi("Quais / berths", "berths", S.data.berths.map((b) => b.code).sort())}${multi("Statuses", "statuses", unique("status"))}
    </div></details></section>
    ${fields.length && q.group_by === "none" ? `<details class="report-fields"><summary>Report columns</summary><div class="toolbar"><button class="btn small" id="report-all-fields">Select all</button></div>${fields.map((f) => `<label class="check-row"><input type="checkbox" data-report-column="${f.id}" ${(q.columns || result.columns.map((c) => c.id)).includes(f.id) ? "checked" : ""}>${esc(f.label)}</label>`).join("")}</details>` : ""}
  </div><div class="report-builder-actions"><button class="btn primary" id="run-custom-report">${icon("play")}Generate preview</button><button class="btn" id="clear-custom-report">Reset filters</button></div></aside><section class="card report-preview"><div class="card-head"><h3>${icon("file-chart-column")}${esc(result?.title || "Report preview")}</h3><div class="toolbar">${can("reports.export") ? ["csv", "xlsx", "pdf"].map((f) => `<button class="btn small" data-custom-export="${f}" ${!result ? "disabled" : ""}>${icon("download")}${f.toUpperCase()}</button>`).join("") : ""}</div></div>
    ${S.customReportError ? `<div class="notice error" role="alert">${esc(S.customReportError)}</div>` : ""}
    ${
      result
        ? `<div class="report-summary">${Object.entries({
            Records: result.summary.records,
            "Vessel calls": result.summary.vessels,
            "Nominated (t)": result.summary.quantity,
            "Handled (t)": result.summary.handled,
            "Remaining (t)": result.summary.remaining,
            "Workbook daily (t)": result.summary.daily_handled,
            "Delay / planned hours": result.summary.duration_hours,
          })
            .filter(([, v]) => v !== null && v !== undefined)
            .map(
              ([k, v]) =>
                `<span><small>${esc(k)}</small><b>${Number(v).toLocaleString(getLocale(), { maximumFractionDigits: 3 })}</b></span>`,
            )
            .join(
              "",
            )}</div><div class="notice"><span>${result.notes.map(esc).join("<br>")}</span></div><div class="table-scroll report-table"><table><thead><tr>${result.columns.map((f) => `<th>${esc(f.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${result.columns.map((f) => `<td>${row[f.id] === null || row[f.id] === undefined ? '<span class="subtle">—</span>' : esc(f.type === "number" ? Number(row[f.id]).toLocaleString(getLocale(), { maximumFractionDigits: 3 }) : row[f.id])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${result.columns.length}">No matching records. Widen the date interval or remove filters.</td></tr>`}</tbody></table></div><div class="subtle report-footer">${rows.length} of ${result.total_rows} result rows${result.truncated ? " · Preview limited to 500 rows; download includes up to 10,000 rows." : ""} · ${esc(result.origin === "original" ? "Original workbook snapshot" : "Current working version")}</div>`
        : `<div class="report-empty"><div class="report-empty-icon">${icon("file-chart-column")}</div><small>YOUR OPERATIONAL DATA, IN FOCUS</small><h3>${esc(datasets.find(([id]) => id === q.dataset)?.[1] || "Report preview")}</h3><p>Set your period and filters, then generate a preview to explore the records and totals.</p><div class="report-empty-steps"><span>01 Configure</span><span>02 Preview</span><span>03 Export</span></div></div>`
    }
  </section></section>`;
}
function readForm() {
  const q = state();
  document.querySelectorAll("[data-report-key]").forEach((el) => {
    q[el.dataset.reportKey] = el.value;
  });
  document.querySelectorAll("[data-report-multi]").forEach((el) => {
    q[el.dataset.reportMulti] = [...el.querySelectorAll("input:checked")].map((o) => o.value);
  });
  const checks = [...document.querySelectorAll("[data-report-column]")];
  if (checks.length)
    q.columns = checks
      .filter((el) => el.checked)
      .map((el) => el.dataset.reportColumn);
  return { ...q };
}
export function bindReports() {
  const { S, api, path, renderApp, toast } = P();
  const q = state();
  document.querySelectorAll("[data-report-multi]").forEach(dropdown => {
    dropdown.addEventListener("toggle", () => {
      if (dropdown.open) document.querySelectorAll("[data-report-multi]").forEach(other => { if (other !== dropdown) other.open = false; });
    });
    dropdown.addEventListener("change", () => {
      const selected = [...dropdown.querySelectorAll("input:checked")].map(el => el.value);
      q[dropdown.dataset.reportMulti] = selected;
      const summary = dropdown.querySelector("summary > span");
      summary.textContent = selected.length ? selected.join(", ") : "All";
      summary.title = summary.textContent;
    });
  });
  const run = async () => {
    const payload = readForm();
    if (payload.group_by === "none" && payload.columns?.length === 0) {
      toast("Choose at least one report column.");
      return;
    }
    const requestPort = S.portId;
    const token = {};
    S.customReportRequest = token;
    try {
      const result = await api(path("/reports/query"), "POST", payload);
      if (S.portId !== requestPort || S.customReportRequest !== token) return;
      S.customReportResult = result;
      S.customReportError = "";
    } catch (e) {
      if (S.portId !== requestPort || S.customReportRequest !== token) return;
      S.customReportError = e.message;
    }
    if (S.tab === "reports") renderApp();
  };
  document.querySelector("#run-custom-report").onclick = run;
  document.querySelectorAll("[data-report-key]").forEach((el) => {
    if (["dataset", "origin", "group_by"].includes(el.dataset.reportKey))
      el.onchange = () => {
        readForm();
        S.customReportRequest = null;
        delete q.columns;
        if (
          el.dataset.reportKey === "dataset" &&
          ["equipment", "delays", "approvals", "plan_changes"].includes(
            q.dataset,
          )
        ) {
          q.start = "";
          q.end = "";
          q.origin = "working";
        }
        S.customReportResult = null;
        S.customReportError = "";
        renderApp();
      };
  });
  document.querySelector("#clear-custom-report").onclick = () => {
    S.customReportRequest = null;
    const { dataset, origin } = q;
    S.customReport = {
      dataset,
      origin,
      date_basis: "report_date",
      group_by: "none",
      limit: 500,
    };
    S.customReportResult = null;
    S.customReportError = "";
    renderApp();
  };
  document
    .querySelector("#report-all-fields")
    ?.addEventListener("click", () => {
      document.querySelectorAll("[data-report-column]").forEach((el) => {
        el.checked = true;
      });
    });
  document.querySelectorAll("[data-custom-export]").forEach((button) => {
    button.onclick = async () => {
      const payload = readForm();
      if (payload.group_by === "none" && payload.columns?.length === 0) {
        toast("Choose at least one report column.");
        return;
      }
      button.disabled = true;
      try {
        const response = await fetch("/api" + path("/reports/custom-export"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            format: button.dataset.customExport,
          }),
        });
        if (!response.ok) {
          const detail = await response.json();
          throw new Error(
            typeof detail.detail === "string"
              ? detail.detail
              : "Export failed. Check the report filters.",
          );
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `portside-${payload.dataset}-${payload.origin}.${button.dataset.customExport}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        toast(e.message);
      } finally {
        button.disabled = false;
      }
    };
  });
}
