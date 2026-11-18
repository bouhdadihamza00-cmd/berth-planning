// Read-only inspection of dated source data with searchable scroll regions.
const P = () => window.P;
export function sourceFeedModal(initial = "calls") {
  const { S, modal, esc, icon, fmt, date, can, $, $$ } = P();
  let tab = initial,
    search = "";
  function draw() {
    const q = search.toLowerCase();
    const choices = [
      ["calls", "Vessel lineup"],
      ["plans", "Berth plans"],
      ["issues", "Source review"],
      ["sources", "Import details"],
    ];
    const originalCalls = S.data.calls
      .filter((c) => c.source_snapshot || c.cargo_lots)
      .map((c) => c.source_snapshot || c);
    const data =
      tab === "calls"
        ? originalCalls
        : tab === "plans"
          ? S.data.source_plans
          : tab === "issues"
            ? S.data.source_issues
            : (S.data.port.excel_source || S.data.port.source_feed).sources;
    const rows = data.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(q),
    );
    const subset = rows;
    const headings =
      tab === "calls"
        ? [
            "Vessel / flow",
            "Cargo",
            "Quantity",
            "Berth / status",
            "Arrival / ETA",
          ]
        : tab === "plans"
          ? ["Vessel", "Quai", "Start", "End", "Plan volume"]
          : tab === "issues"
            ? ["Source review", "Location"]
            : ["Workbook", "SHA-256"];
    const rowHtml = (r) =>
      tab === "calls"
        ? `<tr class="clickable" data-source-call="${esc(r.id)}"><td><b>${esc(r.name)}</b><br><small>${esc(r.direction)}</small></td><td>${esc(r.subgrade || r.product)}<br><small>${r.cargo_lots.length} cargo lot${r.cargo_lots.length === 1 ? "" : "s"}</small></td><td>${fmt(r.quantity, 1)} t</td><td>${esc(r.source_berth || "Unassigned")}<br><small>${esc(r.status)}</small></td><td>${r.eta ? date(r.eta) : esc(r.eta_text || "Not reported")}</td></tr>`
        : tab === "plans"
          ? `<tr class="clickable" data-source-plan="${esc(r.id)}"><td>${esc(r.name)}</td><td>${esc(r.berth_code)}</td><td>${date(r.start)}</td><td>${date(r.end)}</td><td>${fmt(r.quantity, 1)} t</td></tr>`
          : tab === "issues"
            ? `<tr><td>${esc(r.message)}</td><td>${esc(typeof r.source === "string" ? r.source : `${r.source.sheet}!${r.source.cell}`)}</td></tr>`
            : `<tr><td>${esc(r.file)}</td><td style="font-family:monospace;font-size:calc(9px * var(--ui-font-scale, 1));overflow-wrap:anywhere">${esc(r.sha256)}</td></tr>`;
    modal(
      "Imported source records",
      `<div class="notice">${icon("file-spreadsheet")}Original Excel reference. Working Gantt changes, delays, reports and configuration use the standard pages. Imported quantities and source notes below remain unchanged; demo planning assumptions are listed in Import details.</div><div class="source-tabs">${choices.map(([k, v]) => `<button class="btn small ${k === tab ? "primary" : ""}" data-source-tab="${k}">${v}</button>`).join("")}${can("reports.export") ? `<button class="btn small" id="source-export">${icon("download")}Export lineup</button>` : ""}</div><div class="search-box" style="margin:10px 0">${icon("search")}<input id="source-search" aria-label="Search source feed" placeholder="Search vessels, products or notes…" value="${esc(search)}"></div><div class="source-table"><table><thead><tr>${headings.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${subset.map(rowHtml).join("") || `<tr><td colspan="5">No matching records.</td></tr>`}</tbody></table></div><div class="source-result-count">${rows.length} matching records</div>${tab === "sources" ? `<p class="config-description">${esc((S.data.port.excel_source || S.data.port.source_feed).reference_note)} ${esc(S.data.port.demo_assumptions?.description || "")} Original files were read without executing macros. Missing or approximate times remain unresolved. The daily Feuil1 report takes precedence over its conflicting Sheet1 copy. Daily cargo totals and Gantt plan quantities are separate measures.</p>` : ""}`,
    );
    $$("[data-source-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.sourceTab;
          draw();
        }),
    );
    $("#source-search").onchange = (e) => {
      search = e.target.value;
      draw();
    };
    $$("[data-source-call]").forEach(
      (b) => (b.onclick = () => P().vesselModal(b.dataset.sourceCall)),
    );
    $$("[data-source-plan]").forEach(
      (b) => (b.onclick = () => sourcePlanModal(b.dataset.sourcePlan)),
    );
    if ($("#source-export"))
      $("#source-export").onclick = () => {
        const columns = [
          "Vessel",
          "Flow",
          "Product",
          "Grade",
          "Quality",
          "Quantity t",
          "Handled cumulative t",
          "Handled by 07:00 t",
          "Quai",
          "Status",
          "Arrival or ETA",
          "Destination",
          "Origin",
          "Source row",
        ];
        const rows = originalCalls.flatMap((c) =>
          c.cargo_lots.map((l) => [
            c.name,
            c.direction,
            l.product,
            l.grade,
            l.quality,
            l.quantity,
            l.handled_quantity,
            l.daily_handled_quantity,
            c.source_berth,
            c.status,
            c.eta_text,
            c.destination,
            c.origin,
            l.source_row,
          ]),
        );
        const csv = [columns, ...rows]
          .map((r) =>
            r
              .map(
                (v) =>
                  `"${String(v ?? "")
                    .replace(/^[=+@\-\t\r]/, "'$&")
                    .replaceAll('"', '""')}"`,
              )
              .join(","),
          )
          .join("\r\n");
        const url = URL.createObjectURL(
          new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "JPH-2023-11-28-cargo-lineup.csv";
        a.click();
        URL.revokeObjectURL(url);
      };
  }
  draw();
}
export function sourcePlanModal(id) {
  const { S, modal, esc, date, fmt, $ } = P();
  const r = S.data.source_plans.find((p) => p.id === id);
  if (!r) return;
  modal(
    "Source berth plan",
    `<div class="detail-banner"><h2>${esc(r.name)}</h2></div><dl class="detail-grid">${[
      ["Quai", r.berth_code],
      ["Start", date(r.start)],
      ["End", date(r.end)],
      ["Plan volume", fmt(r.quantity, 1) + " t"],
      ["Product as written", r.product],
      ["Time precision", r.time_precision],
      ["Source", `${r.source.file} · ${r.source.sheet}!${r.source.cell}`],
      ["Source vessel label", r.source_label],
      ["Daily record match", r.match_method || "Not linked"],
      ...Object.entries(r.source_fields || {}).map(([k, v]) => [
        {
          availability: "Cargo availability as written",
          eta: "Arrival / ETA as written",
          laycan: "Laycan / DLC as written",
          origin: "Supplying production entity",
          billing_origin: "Billing entity",
        }[k] || k,
        v.map((x) => `${x.value} (${x.cell})`).join("; "),
      ]),
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
      .join(
        "",
      )}</dl><p class="config-description">The volume is the sum of the source half-day quantity cells, converted from kt to tonnes. This is a planning estimate, separate from the daily report's actual cargo and handled tonnage.</p>${r.call_id ? '<button class="btn primary" id="source-plan-call">Open daily vessel record</button>' : ""}`,
  );
  if (r.call_id)
    $("#source-plan-call").onclick = () => P().vesselModal(r.call_id);
}
export function sourceCallDetails(c) {
  const { esc, fmt, date, icon } = P();
  const lots = c.cargo_lots
    .map(
      (l) =>
        `<tr><td>${esc(l.quality || l.source_product)}</td><td>${fmt(l.quantity, 3)}</td><td>${fmt(l.handled_quantity, 3)}</td><td>${fmt(l.daily_handled_quantity, 3)}</td><td>${esc(l.tolerance || "—")}</td><td>${l.source_row}</td></tr>`,
    )
    .join("");
  return `<div class="notice">${icon("file-spreadsheet")}${esc(c.source.file)} · ${esc(c.source.sheet)} · row ${c.source.row}. Historical source record.</div><div class="source-table"><table><thead><tr><th>Cargo lot</th><th>Nominated t</th><th>Cumulative t</th><th>By 07:00 t</th><th>Tolerance</th><th>Source row</th></tr></thead><tbody>${lots}</tbody></table></div><dl class="detail-grid">${[
    ["Source berth", c.source_berth || "Not assigned"],
    ["Arrival / ETA as written", c.eta_text || "Not reported"],
    ["Actual arrival", date(c.actual_arrival)],
    ["Docking", date(c.actual_docking)],
    ["Operation started", date(c.actual_start)],
    ["Operation finished", date(c.actual_end)],
    [
      "Departure",
      c.actual_departure
        ? date(c.actual_departure)
        : c.departure_text || "Not reported",
    ],
    ["Destination", c.destination || "Not reported"],
    ["Origin", c.origin || "Not reported"],
    ["Customer / supplier", c.counterparty || "Not reported"],
    ["Laycan as written", c.laycan_text || "Not reported"],
    ["Incoterm", c.incoterm || "Not reported"],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join(
      "",
    )}</dl>${c.notes ? `<p class="notice warning">${esc(c.notes)}</p>` : ""}<p class="config-description">${c.source_schedule.length} matching schedule entry or entries. Schedule times are estimates from half-day slots. Missing IMO, MMSI, vessel dimensions and positions remain unavailable.</p>`;
}
