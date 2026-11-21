import { DEFAULT_KPI_IDS, currentKpiLayout, kpiTone, bindDashboardEditor } from "./dashboard-kpis.js?v=31";
import { confirmRemoval } from "./removal.js?v=6";
import { mountWeather } from "./weather.js?v=15";
import { portMapView, portMapBoundaryKey } from "./port-map-view.js?v=6";
import { renderProductIcon, activeThroughputProducts } from "./cargo.js?v=12";
import { mountAssistantChat } from "./assistant-chat.js?v=12";
import { renderAssistant, bindAssistant } from "./documents.js?v=15";
import { applyPreferences, translateUI, getLocale } from "./preferences.js?v=8";
import {
  sourceFeedModal,
  sourcePlanModal,
  sourceCallDetails,
} from "./source-feed.js?v=9";
import { mountVessels, aisObservationPresentation } from "./vessels.js?v=10";
import { attachBasemap } from "./basemaps.js?v=5";
import {
  prepareScreen,
  activateScreen,
  activateModalLists,
} from "./hmi.js?v=15";
import {
  renderPlanning,
  fitTimeline,
  bindPlanning,
  vesselForm,
  proposalForm,
  scenarioForm,
  historyModal,
} from "./planning.js?v=35";
import {
  renderCenter,
  bindCenter,
  delayForm,
  alertModal,
} from "./workflows.js?v=30";
import { renderConfig, bindConfig } from "./configuration.js?v=71";
const S = {
  user: null,
  ports: [],
  portId: localStorage.getItem("portside-port") || "",
  data: null,
  page: localStorage.getItem("portside-page") || "overview",
  tab: "alerts",
  configTab: "general",
  map: null,
  configMap: null,
  basemap: "satellite",
  layers: { berths: true, equipment: true, vessels: true, boundary: true },
  search: "",
  timelineScale: ["day", "week", "month", "year"].includes(
    localStorage.getItem("portside-gantt-scale"),
  )
    ? localStorage.getItem("portside-gantt-scale")
    : "week",
  date: null,
  scenario: null,
  draftOverlay: true,
  undo: [],
  redo: [],
};
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name, cls = "") => `<i data-lucide="${name}" class="${cls}"></i>`;
const fmt = (n, d = 0) =>
  n == null
    ? "—"
    : Number(n).toLocaleString(getLocale(), {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
const date = (value, opts = {}) =>
  value
    ? new Intl.DateTimeFormat(getLocale(), {
        timeZone: S.data?.port.timezone || "Africa/Casablanca",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        ...opts,
      }).format(new Date(value))
    : "—";
const time = (value) =>
  value
    ? new Intl.DateTimeFormat(getLocale(), {
        timeZone: S.data?.port.timezone || "Africa/Casablanca",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const inputDate = (v) => {
  const d = v ? new Date(v) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const iso = (v) => new Date(v).toISOString();
const berth = (id) => S.data?.berths.find((x) => x.id === id);
const can = (p) =>
  !!S.user?.superadmin ||
  !!S.user?.memberships
    .find((m) => m.port_id === S.portId)
    ?.permissions.includes(p);
const membership = () =>
  S.user?.memberships.find((m) => m.port_id === S.portId);
const colors = {
  Loading: "#2bd96b",
  Unloading: "#22baff",
  Waiting: "#ffbd29",
  Delayed: "#ff4d57",
  Berthed: "#bfdae9",
  Scheduled: "#7196b0",
  Completed: "#687580",
};
const statusColor = (s) =>
  [
    "Loading",
    "Available",
    "Approved",
    "Published",
    "Optimal",
    "Feasible",
    "Ready",
    "Completed",
    "Resolved",
  ].includes(s)
    ? "green"
    : ["Unloading", "Submitted", "Acknowledged"].includes(s)
      ? "blue"
      : [
            "Delayed",
            "High",
            "Rejected",
            "Infeasible",
            "Outage",
            "Closed",
          ].includes(s)
        ? "red"
        : [
              "Waiting",
              "Reserved",
              "Draft",
              "Medium",
              "Clarification requested",
            ].includes(s)
          ? "amber"
          : "";
const status = (s) =>
  `<span class="status ${statusColor(s)}"><span class="dot" style="width:4px;height:4px"></span>${esc(s)}</span>`;
const btn = (label, ic, action, cls = "") =>
  `<button class="btn ${cls}" data-action="${action}">${ic ? icon(ic) : ""}${label}</button>`;
const empty = (title, desc = "", ic = "inbox") =>
  `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
const field = (label, name, value = "", type = "text", attrs = "") =>
  `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
const select = (label, name, options, value = "", attrs = "") =>
  `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" ${attrs}>${options
    .map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`;
    })
    .join("")}</select></div>`;
const textArea = (label, name, value = "", attrs = "") =>
  `<div class="field full"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea></div>`;
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) {
    let msg;
    try {
      msg = (await r.json()).detail;
    } catch {
      msg = "Request failed";
    }
    if (r.status === 401 && S.user) {
      S.user = null;
      renderLogin();
    }
    throw new Error(
      typeof msg === "object"
        ? msg.errors?.join(" · ") || JSON.stringify(msg)
        : msg,
    );
  }
  return r.status === 204 ? null : r.json();
}
const path = (s) => `/ports/${S.portId}${s}`;
function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  el.dataset.i18n = "";
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 6000);
}
function icons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.7, "aria-hidden": "true", focusable: "false" } });
}
function modal(title, body, wide = false) {
  let dialog = $("#overlay dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "modal-title");
    dialog.setAttribute("closedby", "any");
    dialog.addEventListener("close", () => { if (!dialog.open) dialog.remove(); });
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = e => { const r = dialog.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", e => { pressedOutside = outside(e); });
      dialog.addEventListener("pointerup", e => { if (pressedOutside && outside(e)) dialog.close(); });
    }
    $("#overlay").append(dialog);
  }
  dialog.className = "modal" + (wide ? " wide" : "");
  dialog.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2></div><button type="button" class="icon-btn" data-close aria-label="Close dialog">${icon("x")}</button></div><div class="modal-body">${body}</div>`;
  activateModalLists(dialog);
  translateUI(dialog);
  dialog.querySelector("[data-close]").onclick = closeModal;
  const candidate = selector => [...dialog.querySelectorAll(selector)].find(el => !el.closest("[hidden]") && !el.disabled);
  const initial = candidate('button[id^="cancel-"], .form-actions button[type="button"]:not(.danger):not(.primary)') || candidate('input:not([type="hidden"]),select,textarea') || dialog.querySelector("[data-close]");
  initial.setAttribute("autofocus", "");
  icons();
  if (!dialog.open) dialog.showModal();
  else initial.focus();
}
function closeModal() {
  $("#overlay dialog")?.close();
}
const formData = (form) => Object.fromEntries(new FormData(form));
function handleForm(id, fn) {
  const form = $(id);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const submit = $("button[type=submit]", form);
    if (submit) submit.disabled = true;
    try {
      await fn(formData(form), form);
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (submit) submit.disabled = false;
    }
  };
}
async function refresh(render = true) {
  S.data = await api(path("/snapshot"));
  if (S.data.port.source_feed && !S.date)
    S.date = new Date(S.data.port.source_feed.report_date + "T00:00:00");
  if (S.data.port.demo_clock && !S.date)
    S.date = new Date(S.data.port.demo_clock);
  if (render) renderApp();
}
async function nav(page, fromSidebar = false) {
  try {
    await saveGeoBeforeNavigation();
  } catch (e) {
    toast(e.message, true);
    return;
  }
  if (page === "configuration" && fromSidebar) {
    S.configTab = "general";
    S.geoPlacement = null;
  }
  S.page = page;
  S.search = "";
  localStorage.setItem("portside-page", page);
  renderApp();
  window.scrollTo({ top: 0, left: 0 });
}
function aisHasNoPositions(ais = S.data.ais) {
  return (
    ais.provider === "marinetraffic-client" &&
    ais.positions.length === 0
  );
}
function aisStateLabel(ais = S.data.ais) {
  if (ais.provider === "workbook-demo") return "Working Excel demo";
  if (ais.mode === "historical") return "Excel snapshot · 28 Nov 2023";
  if (
    aisHasNoPositions(ais) &&
    !(ais.provider === "marinetraffic-client")
  )
    return "No AIS positions";
  return (
    {
      live: "Live AIS",
      partial: "Partial AIS coverage",
      stale: "Stale AIS",
      connecting: "Connecting AIS",
      waiting: "Awaiting AIS",
      offline: "Offline AIS",
      demo: "Demo environment",
    }[ais.mode] || "AIS unavailable"
  );
}
function aisMapSummary() {
  const ais = S.data.ais;
  return ais.provider === "workbook-demo"
    ? "Imported plan · No coordinates"
    : ais.mode === "historical"
      ? "Historical report · No coordinates"
      : aisStateLabel(ais);
}
function header() {
  const m = membership();
  const unread = S.data.notifications.filter(
    (n) => !n.read_by.includes(S.user.id),
  ).length;
  const links = [
    ["overview", "layout-dashboard", "Overview"],
    ["planning", "calendar-range", "Berth planning"],
    ["center", "bell-ring", "Workflow center"],
    ["assistant", "brain-circuit", "Operational assistant"],
    ["configuration", "sliders-horizontal", "Configuration"],
  ];
  return `<a class="skip-link" href="#workspace-heading">Skip to workspace</a><aside class="app-sidebar"><div class="sidebar-caption">WORKSPACE</div><nav class="nav-bar" aria-label="Primary">${links.map(([id, ic, label]) => `<button class="nav-item ${S.page === id ? "active" : ""}" data-nav="${id}" aria-label="${label}" ${S.page === id ? 'aria-current="page"' : ""}>${icon(ic)}<span class="nav-label">${label}</span>${id === "center" && S.data.stats.open_alerts ? `<span class="nav-count">${S.data.stats.open_alerts}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-footer"><div class="sidebar-port-code">${esc(S.data.port.code)}</div><span>${esc(S.data.port.name)}</span><small>${esc(S.data.port.timezone)}</small><div class="sidebar-mode"><span class="dot"></span>${aisStateLabel()}</div></div></aside><header><div class="topbar"><a class="brand" href="#" data-action="overview" aria-label="Portside overview"><span class="brand-icon">${icon("anchor")}</span><span><span class="brand-name">${esc(S.data.port.brand || "Portside")}</span><span class="brand-tag">Operations console</span></span></a><div class="port-switch"><span class="port-symbol">${icon("map-pin")}</span><div><div class="eyebrow">Selected port</div><select id="port-select" aria-label="Selected port">${S.ports.map((p) => `<option value="${p.id}" ${p.id === S.portId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div><div class="top-spacer"></div><div class="clock" id="clock"></div><div class="divider"></div><button class="icon-btn" data-action="notifications" aria-label="Notifications">${icon("bell")}${unread ? '<span class="notification-dot"></span>' : ""}</button><div class="divider"></div><button class="user-button" data-action="profile"><span class="avatar">${S.user.name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join(
      "",
    )}</span><span class="user-meta"><span class="user-name">${esc(S.user.name)}</span><span class="user-dept">${esc(m?.department || "Super Administrator")}</span></span>${icon("chevron-down")}</button></div></header>`;
}
function updateClock() {
  const c = $("#clock");
  if (!c || !S.data) return;
  const d = new Date(
    S.data.port.demo_clock ||
      S.data.port.source_feed?.reference_time ||
      Date.now(),
  );
  c.innerHTML = `<strong>${new Intl.DateTimeFormat(getLocale(), { timeZone: S.data.port.timezone, day: "2-digit", month: "short", year: "numeric" }).format(d)}</strong><br>${time(d)} <span style="color:#a2afb7">${esc(S.data.port.timezone)}</span>`;
  const portClock = $("[data-port-clock]");
  const now = new Date();
  const minute = String(Math.floor(+now / 60000));
  if (portClock && portClock.dataset.minute !== minute) {
    portClock.dataset.minute = minute;
    const timeZone = S.data.port.timezone;
    const locale = getLocale();
    const currentTime = new Intl.DateTimeFormat(locale, {timeZone, hour: "numeric", minute: "2-digit"}).format(now);
    const currentDate = new Intl.DateTimeFormat(locale, {timeZone, weekday: "long", month: "short", day: "numeric"}).format(now);
    const reading = portClock.querySelector("time");
    reading.dateTime = now.toISOString();
    reading.textContent = currentTime;
    const dateLabel = portClock.querySelector(".metric-foot");
    dateLabel.textContent = currentDate;
    dateLabel.title = timeZone;
  }
}
function pageHeading(title, subtitle, actions = "", pill = true) {
  return `<div class="page-heading"><div><div class="title-line"><h1 id="workspace-heading" tabindex="-1">${title}</h1>${pill ? `<span class="demo-pill ${S.data.ais.mode === "live" ? "live" : ""}"><span class="dot" style="width:5px;height:5px"></span>${aisStateLabel()}</span>` : ""}</div><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function cardHead(title, ic, meta = "", action = "", count = "") {
  return `<div class="card-head"><div class="card-title">${icon(ic)}<h2>${title}</h2>${count !== "" ? `<span class="count-pill">${count}</span>` : ""}</div>${action ? `<button class="card-link" data-action="${action}">${meta}${icon("arrow-up-right")}</button>` : `<span class="card-meta">${meta}</span>`}</div>`;
}
function delayChart(k) {
  const entries = Object.entries(k.delay_causes).filter(([, hours]) => Number.isFinite(hours) && hours > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, hours]) => sum + hours, 0);
  const palette = [
    "#087FB8", "#F5A623", "#168F91", "#627FAE", "#429F78", "#C57B49",
    "#8676B4", "#36A9CB", "#C57C87", "#929D59", "#477C9C", "#8B8581",
  ];
  let offset = 0;
  const parts = entries.map(([name, hours], i) => {
    const share = hours / total * 100;
    const part = {name, hours, share, offset, color: palette[i % palette.length],
      angle: (offset + share / 2) * Math.PI / 50 - Math.PI / 2};
    offset += share;
    return part;
  });
  const slices = parts.map(({share, offset, color}) =>
    `<circle cx="60" cy="60" r="48" pathLength="100" fill="none" stroke="${color}" stroke-width="19" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`
  ).join("");
  const percentages = parts.filter(({share}) => share >= 8).map(({share, angle}) =>
    `<text class="delay-slice-label" x="${60 + 48 * Math.cos(angle)}" y="${60 + 48 * Math.sin(angle)}" text-anchor="middle" dominant-baseline="central">${fmt(share)}%</text>`
  ).join("");
  const legend = parts.map(({name, hours, share, color}) =>
    `<li><span class="delay-key-dot" style="--delay-color:${color}" aria-hidden="true"></span><span dir="auto">${esc(name)}</span> <b dir="ltr">${fmt(hours, 1)} h</b><span class="delay-share"> · ${fmt(share, 1)}%</span></li>`
  ).join("");
  const unavailable = !entries.length && S.data.port.source_feed;
  return `<div class="delay-summary"><div class="delay-chart-layout"><div class="delay-donut"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" fill="none" stroke="var(--ui-border, var(--line))" stroke-width="19"/>${slices}${percentages}</svg><div class="delay-donut-center"><span>Total delay</span><strong dir="ltr">${unavailable ? "—" : `${fmt(k.delay_hours, 1)} <small>h</small>`}</strong></div></div>${entries.length ? `<ul class="delay-key" aria-label="Delay by department">${legend}</ul>` : `<span class="subtle">${unavailable ? "Delay durations are not supplied by the report." : "No delays recorded"}</span>`}</div></div>`;
}
function overviewKpiCards(layout, editing = false) {
  const k = S.data.stats;
  const metrics = [
    ["Active vessel calls", k.active, "", "In port & at anchorage", "ship", k.active > 0 ? "info" : "neutral"],
    [
      "Upcoming arrivals",
      k.upcoming,
      "",
      S.data.port.source_feed
        ? "Exact ETAs within the next 48 hours"
        : "Within the next 48 hours",
      "calendar-clock",
      k.upcoming > 0 ? "info" : "neutral",
    ],
    [
      "Berth utilization",
      k.utilization,
      "%",
      S.data.port.source_feed
        ? `${k.alongside} reported alongside · capacity unverified`
        : "Current berth occupancy",
      "container",
      k.utilization >= 100 ? "warning" : k.utilization > 0 ? "info" : "neutral",
    ],
    [
      "Avg. waiting time",
      k.waiting,
      "h",
      S.data.port.source_feed
        ? `${k.waiting_samples} reported arrival-to-docking intervals`
        : `${k.completed} completed calls · 30 days`,
      "hourglass",
      k.waiting === 0 ? "positive" : k.waiting > 0 ? "warning" : "neutral",
    ],
    [
      "Avg. turnaround",
      k.turnaround,
      "h",
      S.data.port.source_feed
        ? `${k.turnaround_samples} reported arrival-to-departure intervals`
        : "Arrival to departure · 30 days",
      "timer",
      k.turnaround != null ? "info" : "neutral",
    ],
    [
      "Schedule adherence",
      k.adherence,
      "%",
      S.data.port.source_feed
        ? "Approved baseline not supplied"
        : "Within 1 hour of planned start",
      "clipboard-check",
      k.adherence === 100 ? "positive" : k.adherence === 0 ? "danger" : k.adherence > 0 ? "warning" : "neutral",
    ],
    [
      "Operational delays",
      k.delay_hours,
      "h",
      S.data.port.source_feed
        ? "Delay durations not reported"
        : `${Object.keys(k.delay_causes).length} delay categories`,
      "clock-alert",
      k.delay_hours === 0 ? "positive" : k.delay_hours > 0 ? "warning" : "neutral",
    ],
    [
      S.data.port.source_feed ? "Source review items" : "Planning conflicts",
      S.data.port.source_feed ? k.source_issues : k.conflicts.length,
      "",
      S.data.port.source_feed
        ? "Review source differences and missing data"
        : k.conflicts.length ? "Require your attention" : "No hard constraint violations",
      "triangle-alert",
      S.data.port.source_feed
        ? k.source_issues > 0 ? "warning" : k.source_issues === 0 ? "positive" : "neutral"
        : k.conflicts.length ? "danger" : "positive",
    ],
  ];
  const configured = k.dashboard_kpis;
  return layout.map(({id, width, height = 1}) => {
    const i = DEFAULT_KPI_IDS.indexOf(id);
    const [label, baseValue, unit, foot, glyph, defaultTone] = metrics[i] || ["", null, "", "", "chart-column", "info"];
    const definition = configured?.definitions[id];
    const formula = definition?.formula;
    const value = formula ? configured.values[id] : baseValue;
    const name = definition && (!S.data.port.source_feed || i !== 7 || formula) ? definition.name : label;
    const tone = kpiTone(definition || {}, value, defaultTone);
    const detail = definition?.thresholds && Number.isFinite(value)
      ? {positive: "Within target", warning: "Amber threshold reached", danger: "Red threshold reached"}[tone]
      : formula ? "Calculated KPI" : foot;
    const tag = editing ? "article" : "button";
    return `<${tag} class="metric" ${editing ? `tabindex="0" aria-label="${esc(name)}" aria-describedby="kpi-editor-help"` : 'type="button"'} data-metric="${i}" data-kpi-id="${esc(id)}" data-tone="${tone}" ${i === 0 && !definition?.thresholds ? "data-kpi-brand" : ""} data-kpi-width="${width}" data-kpi-height="${height}" style="--widget-columns:${width};--widget-rows:${height}" title="${esc(detail)}"><div class="metric-top"><span class="metric-label">${esc(name)}</span><span class="metric-icon" aria-hidden="true">${icon(glyph)}</span></div><div class="metric-value">${fmt(value, formula ? 2 : value % 1 ? 1 : 0)}<span class="metric-unit">${Number.isFinite(value) ? esc(definition?.unit ?? unit) : ""}</span></div>${i === 2 && !formula && Number.isFinite(value) ? `<div class="mini-meter"><span style="width:${Math.min(value, 100)}%"></span></div>` : ""}<div class="metric-foot">${esc(detail)}</div></${tag}>`;
  }).join("");
}
function cargoThroughput(records) {
  const products = activeThroughputProducts(records);
  const total = products.reduce((sum, product) => sum + Number(product.quantity), 0);
  const title = S.data.port.source_feed ? "Cargo handled by 07:00" : "Cargo throughput";
  const headline = `<strong class="cargo-total">${fmt(total / 1000, 1)} <small>kt total</small></strong>`;
  const rows = products.map(product => {
    const {name, quantity, direction, change} = product;
    const share = Number(quantity) / total * 100;
    const configured = S.data.port.product_icons?.[name]?.color;
    const color = /^#[0-9a-f]{6}$/i.test(configured || "") ? configured : "var(--marine-600)";
    return `<li class="cargo-row">
      <span class="cargo-identity">
        <span class="cargo-glyph" aria-hidden="true">${renderProductIcon(name)}</span>
        <span class="cargo-name"><b dir="auto">${esc(name)}</b><small>${esc(direction)}</small></span>
      </span>
      <span class="cargo-share" dir="ltr">
        <span class="cargo-bar" aria-hidden="true"><span style="width:${share}%;background:${color}"></span></span>
        <span>${fmt(share, 1)}%</span>
      </span>
      <span class="cargo-amount"><b dir="ltr">${fmt(quantity / 1000, 1)} <small>kt</small></b>
        ${change == null ? "" : `<small dir="ltr" title="Compared with prior 30 days">${change > 0 ? "+" : ""}${fmt(change)}%</small>`}
      </span>
    </li>`;
  }).join("");
  return `<section class="card cargo-throughput" data-overview-widget="widget_cargo">
    ${cardHead(title, "chart-no-axes-combined", headline)}
    ${rows ? `<ul class="cargo-comparison" tabindex="0" aria-label="Cargo volume and share of total">${rows}</ul>` : empty("No cargo handled in this period", "Products appear when import or export throughput is recorded.")}
  </section>`;
}
function overview() {
  const { stats: k, calls, berths, alerts } = S.data;
  const ops = calls.filter((c) => ["Loading", "Unloading", "Delayed"].includes(c.status));
  const configured = k.dashboard_kpis;
  const layout = configured ? currentKpiLayout() : DEFAULT_KPI_IDS.map(id => ({id, width: 1}));
  const cards = overviewKpiCards(layout.filter(card => !card.kpis && !Object.hasOwn(configured?.widget_catalog || {}, card.id)));

  const recent = [...calls].sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 12);
  const extraWidgets = `<div hidden><section class="card" data-overview-widget="widget_calls">${cardHead("Vessel calls", "ship", "View all", "vessels")}<div class="table-scroll"><table><thead><tr><th scope="col">Vessel</th><th scope="col">Berth</th><th scope="col">Status</th><th scope="col">Planned start</th></tr></thead><tbody>${recent.map(call => `<tr class="clickable" data-vessel="${esc(call.id)}"><td>${esc(call.name)}</td><td>${esc(berth(call.berth_id)?.code || "—")}</td><td>${status(call.status)}</td><td>${date(call.start)}</td></tr>`).join("") || `<tr><td colspan="4">${empty("No vessel calls")}</td></tr>`}</tbody></table></div></section><section class="card" data-overview-widget="widget_weather" aria-label="Weather">${cardHead("Weather", "cloud-sun")}<div class="weather-widget" data-weather-widget aria-live="polite">Loading port weather…</div></section><section class="metric port-clock-card" data-overview-widget="widget_clock"><div data-port-clock><div class="metric-top"><span class="metric-label">Port clock</span><span class="metric-icon" aria-hidden="true">${icon("clock-3")}</span></div><time class="metric-value" dir="auto"></time><div class="metric-foot"></div></div></section></div>`;
  return (
    pageHeading(
      "Port overview",
      S.data.port.source_feed
        ? "Historical report · 28 Nov 2023 · Daily volumes by 07:00 · Open source data to review records."
        : `Current vessel calls, berth occupancy and operational exceptions.`,
      `${btn(S.data.port.source_feed ? "Source data" : "Last 30 days", S.data.port.source_feed ? "file-spreadsheet" : "calendar-days", S.data.port.source_feed ? "source-feed" : "period", "hide-mobile")}${btn("Export report", "download", "export-overview")}${configured && !window.PORTSIDE_PREVIEW_DATA ? btn("Edit dashboard", "layout-dashboard", "edit-dashboard") : ""}`,
    ) +
    `${extraWidgets}<div class="dashboard-kpi-area"><div id="dashboard-editor" hidden></div><div class="metrics">${cards || '<p class="kpi-empty subtle">No KPIs selected. Use Edit dashboard to add cards.</p>'}</div></div><div class="dashboard-middle"><section class="card map-card" data-overview-widget="widget_map">${cardHead("Port view", "map", aisMapSummary(), "", "")}<div class="port-map-wrap" id="map-container"><div id="port-map" class="port-map" aria-label="Interactive port map"></div><div class="map-top-left"><button class="map-control active" data-action="basemap">${icon("layers-2")}<span id="basemap-label">Satellite</span>${icon("chevron-down")}</button><button class="map-control" data-action="layers">${icon("list-filter")}Layers</button><div class="map-search"><input id="map-vessel-search" placeholder="Find a vessel…" aria-label="Find a vessel on the map"><div class="map-search-results" id="map-search-results"></div></div></div><aside id="port-weather" class="map-weather" aria-label="Port weather" aria-live="polite">Loading port weather…</aside><div class="map-right-controls"><button class="map-control" data-action="map-fullscreen" aria-label="Fullscreen map">${icon("expand")}</button><button class="map-control" data-action="map-recenter" aria-label="Recenter port">${icon("locate-fixed")}</button><button class="map-control" data-action="refresh" aria-label="Refresh positions">${icon("refresh-cw")}</button></div><div class="map-legend"><h4>VESSEL STATUS</h4>${(S.data.ais.provider === "marinetraffic-client") ? `<div class="legend-row"><span class="legend-color" style="background:#bfdae9"></span><span id="ais-observed-legend">${S.data.ais.historical_test ? "Historical/test AIS vessel" : "Observed AIS vessel"}</span></div>` : ""}${["Loading", "Unloading", "Waiting", "Delayed", "Berthed"].map((n) => `<div class="legend-row"><span class="legend-color" style="background:${colors[n]}"></span>${n === "Waiting" ? "Waiting / anchorage" : n}</div>`).join("")}<div class="legend-row" style="border-top:1px solid #8aa5af33;padding-top:8px;margin-top:10px"><span style="width:12px;border-top:3px solid #eb8d24"></span>Configured berths</div></div><div id="ais-empty-state" class="port-map-empty-state" ${aisHasNoPositions() || S.data.port.source_feed ? "" : "hidden"}><span class="ais-empty-icon">${icon("radio")}</span><div><strong>${S.data.port.source_feed ? "Vessel positions are not in these workbooks" : "No vessel positions received"}</strong><p>${S.data.port.source_feed ? "Use the berth plan and vessel lineup to explore the historical operation." : (S.data.ais.provider === "marinetraffic-client") ? esc(S.data.ais.message) : "No vessel positions have been received for this port area."}</p>${S.data.port.source_feed ? '<button type="button" class="btn small" data-action="source-feed">Open source data</button>' : '<button type="button" class="btn small" id="ais-open-settings">Tracking settings</button>'}</div></div></div><div class="map-footer"><span>${icon("map-pin")}${esc(S.data.port.name)} · ${S.data.berths.length} berths</span><span>${icon("refresh-cw")}${S.data.port.source_feed ? "Source date 28 Nov 2023" : "Updated " + time(new Date())}</span></div></section><div class="right-stack"><section class="card operations-card" data-overview-widget="widget_operations">${cardHead("Ongoing operations", "ship", "View all", "vessels", ops.length)}<div class="table-scroll"><table><thead><tr><th scope=\"col\">Vessel / product</th><th scope=\"col\">Berth</th><th scope=\"col\">Progress</th><th scope=\"col\">Est. finish</th></tr></thead><tbody>${
      ops
        .map(
          (c) =>
            `<tr class="clickable" data-vessel="${c.id}"><td class="vessel-cell"><span class="mini-ship">${icon("ship")}</span>${esc(c.name)}<small style="margin-left:30px">${esc(c.product)} · ${fmt(c.quantity / 1000, 1)} kt</small></td><td class="berth-code">${esc(berth(c.berth_id)?.code || "—")}</td><td>${progress(c.progress)}</td><td style="color:#718896">${time(c.end)}</td></tr>`,
        )
        .join("") ||
      `<tr><td colspan="4">${empty("No ongoing operations")}</td></tr>`
    }</tbody></table></div></section><section class="card berths-card" data-overview-widget="widget_berths">${cardHead("Berth status", "anchor", "Open planning", "planning")}<div class="table-scroll"><table><thead><tr><th scope=\"col\">Berth</th><th scope=\"col\">Status</th><th scope=\"col\">Vessel</th><th scope=\"col\">Progress</th></tr></thead><tbody>${
      berths
        .map((b) => {
          const c = calls.find(
            (c) =>
              c.berth_id === b.id &&
              ["Loading", "Unloading", "Delayed", "Berthed"].includes(c.status),
          );
          const reserved = calls.some(
            (c) =>
              c.berth_id === b.id &&
              ["Scheduled", "Waiting"].includes(c.status),
          );
          return `<tr class="clickable" data-berth="${b.id}"><td class="berth-code">${esc(b.code)}</td><td>${status(c?.status || (S.data.port.source_feed ? "Not reported" : b.status === "Available" && reserved ? "Reserved" : b.status))}</td><td>${c ? `<span style="font-size:calc(9px * var(--ui-font-scale, 1));color:#597282">${esc(c.name)}</span>` : '<span class="available-text">No vessel berthed</span>'}</td><td>${c ? progress(c.progress) : '<span class="available-text">—</span>'}</td></tr>`;
        })
        .join("") ||
      `<tr><td colspan="4">${empty("No berths configured", "Draw your first berth in Configuration.")}</td></tr>`
    }</tbody></table></div></section></div></div><div class="dashboard-bottom">${cargoThroughput(k.products)}<section class="card" data-overview-widget="widget_delays">${cardHead("Operational delays", "timer", "By responsible department")}${delayChart(k)}</section><section class="card alerts-card" data-overview-widget="widget_alerts">${cardHead(S.data.port.source_feed ? "Source review" : "Alerts & planning risks", "bell-ring", "View all", "alerts", S.data.port.source_feed ? k.source_issues : k.open_alerts)}<div class="alerts-list">${
      alerts
        .filter((a) => !["Resolved", "Closed"].includes(a.status))
        .map((a) => alertRow(a))
        .join("") ||
      (S.data.port.source_feed
        ? empty(
            "Review imported records",
            `${k.source_issues} notes cover approximate ETAs, conflicting assignments and source remarks.`,
            "file-warning",
          )
        : empty(
            "All clear",
            "No unresolved operational alerts.",
            "circle-check",
          ))
    }</div></section></div>`
  );
}
function progress(value) {
  return `<div class="table-progress"><div class="progress-track"><span style="width:${value}%"></span></div><span style="color:#6f8894">${fmt(value)}%</span></div>`;
}
function alertRow(a) {
  return `<div class="alert-item" role="button" tabindex="0" data-alert="${a.id}"><span class="alert-symbol ${a.severity === "High" ? "red" : ""}">${icon("triangle-alert")}</span><div class="alert-copy"><h4>${esc(a.title)}</h4><p>${esc(a.description)}</p></div><span class="alert-severity ${a.severity === "High" ? "high" : ""}">${esc(a.severity)}</span></div>`;
}
async function saveGeoBeforeNavigation() {
  if (S.geoEditor?.dirty()) await S.geoEditor.save(true);
  S.geoEditor = null;
}
function cleanupMaps() {
  S.vesselDisplay?.destroy();
  S.vesselDisplay = null;
  if (S.map) {
    S.map.remove();
    S.map = null;
  }
  if (S.configMap) {
    S.configMap.remove();
    S.configMap = null;
  }
}
function renderApp() {
  if (!S.user || !S.data) return;
  if (S.page === "center" && S.tab === "intelligence") {
    S.page = "assistant";
    S.tab = "alerts";
  }
  if (S.tab === "imports") {
    if (S.page === "center") {
      S.page = "configuration";
      S.configTab = "imports";
    }
    S.tab = "alerts";
  }
  const mapView =
    S.page === "overview" && S.map && S.mapPortId === S.portId && S.mapBoundaryKey === portMapBoundaryKey(S.data.port)
      ? { center: S.map.getCenter(), zoom: S.map.getZoom() }
      : null;
  cleanupMaps();
  $("#app").innerHTML =
    header() +
    `<main>${S.page === "overview" ? overview() : S.page === "planning" ? renderPlanning() : S.page === "center" ? renderCenter() : S.page === "assistant" ? pageHeading("Operational assistant", "Analysis, trends, forecasts and planning scenarios.", `${can("scenarios.create") ? btn("Scenario intelligence", "sparkles", "scenario") : ""}${can("config.view") ? btn("Document intelligence", "files", "assistant-documents") : ""}`) + renderAssistant() : renderConfig()}</main>`;
  document.body.classList.toggle("historical-mode", !!S.data.port.source_feed);
  applyPreferences();
  prepareScreen(S.page);
  icons();
  updateClock();
  bindGlobal();
  if (S.page === "overview") {
    initMap();
    if (mapView) S.map.setView(mapView.center, mapView.zoom);
    bindOverview();
  } else if (S.page === "planning") bindPlanning();
  else if (S.page === "center") bindCenter();
  else if (S.page === "assistant") bindAssistant();
  else bindConfig();
  activateScreen();
  mountAssistantChat();
  translateUI(document.querySelector("#app"));
  document.title = `${$("main h1")?.textContent.trim() || "Port operations"} | Portside`;
}
function bindGlobal() {
  $$("[data-nav]").forEach((b) => (b.onclick = () => nav(b.dataset.nav, true)));
  $("#port-select").onchange = async (e) => {
    const id = e.target.value;
    S.portId = id;
    localStorage.setItem("portside-port", id);
    S.scenario = null;
    S.pending = {};
    S.undo = [];
    S.redo = [];
    S.date = null;
    S.page = "overview";
    closeModal();
    try {
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  };
  $$("[data-action]").forEach((b) => {
    if (!b.onclick) b.onclick = () => action(b.dataset.action);
  });
  bindRecords(document);
}
function bindRecords(root) {
  $$("[data-remove-record]", root).forEach(b => b.onclick = e => {
    e.stopPropagation();
    const kind = b.dataset.removeKind;
    const item = S.data[kind].find(x => x.id === b.dataset.removeRecord);
    confirmRemoval(path(`/${kind}/${item.id}?revision=${item.revision}`), item.name || item.title || item.description, kind === "delays" ? "Removing this delay record does not reset vessel or equipment status. Audit history is retained." : "Removal is permanent. Linked records must be resolved first; audit history is retained.");
  });
  for (const [attribute, open] of [["vessel", vesselModal], ["alert", alertModal], ["berth", berthModal], ["product", productModal]]) {
    $$(`[data-${attribute}]`, root).forEach(el => {
      const activate = () => open(el.dataset[attribute]);
      if (el.tagName === "TR") {
        const cell = el.cells[0];
        let button = cell.querySelector(".record-link");
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "record-link";
          button.append(...cell.childNodes);
          cell.append(button);
        }
        button.onclick = e => { e.stopPropagation(); activate(); };
        el.onclick = e => {
          if (e.target.closest("button,a,input,select,textarea")) return;
          button.focus();
          activate();
        };
      } else el.onclick = activate;
    });
  }
}
async function action(a) {
  try {
    if (a === "overview" || a === "planning") return nav(a);
    if (a === "refresh") {
      await refresh();
      toast("Port data refreshed");
    }
    if (a === "source-feed") return sourceFeedModal();
    if (a === "vessels") return vesselList();
    if (a === "alerts") {
      S.tab = "alerts";
      nav("center");
    }
    if (a === "notifications") {
      S.tab = "notifications";
      nav("center");
    }
    if (a === "profile") profileModal();
    if (a === "export-overview") exportModal();
    if (a === "period")
      modal(
        "Dashboard reporting period",
        `<div class="notice">${icon("calendar-days")}Cargo throughput and historical vessel KPIs use the last 30 days. Occupancy and active calls reflect current operational records.</div><p class="config-description">For a custom date range, use the report filters in Workflow center.</p>${btn("Open reports", "file-chart-column", "open-reports", "primary")}`,
      );
    if (a === "open-reports") {
      closeModal();
      S.tab = "reports";
      nav("center");
    }
    if (a === "map-recenter") {
      const view=portMapView(S.data.port);
      S.map.setView(view.center,view.zoom);
    }
    if (a === "map-fullscreen") {
      const wrap = $("#map-container");
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrap.requestFullscreen();
      setTimeout(() => S.map.invalidateSize(), 100);
    }
    if (a === "basemap") {
      S.basemap = S.basemap === "satellite" ? "map" : "satellite";
      initMap();
    }
    if (a === "layers") layersMenu();
    if (a === "new-call") vesselForm();
    if (a === "delay") delayForm();
    if (a === "scenario") scenarioForm();
    if (a === "assistant-documents") {
      S.configTab = "imports";
      await nav("configuration");
    }
    if (a === "history") historyModal();
  } catch (err) {
    toast(err.message, true);
  }
}
function bindOverview() {
  if ($("#ais-open-settings"))
    $("#ais-open-settings").onclick = () => {
      S.configTab = "integrations";
      nav("configuration");
    };
  mountWeather();
  const openKpi = button => {
    const item = S.data.stats.dashboard_kpis?.definitions[button.dataset.kpiId];
    if (!item?.formula) return metricModal(Number(button.dataset.metric));
    const value = S.data.stats.dashboard_kpis.values[button.dataset.kpiId];
    modal(item.name, `<dl class="form-body"><dt>Formula</dt><dd><code>${esc(item.formula)}</code></dd><dt>Value</dt><dd>${value == null ? "Unavailable" : `${fmt(value, 2)} ${esc(item.unit)}`}</dd></dl>`);
  };
  bindDashboardEditor(overviewKpiCards, openKpi);
  $("#map-vessel-search").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $("#map-search-results").innerHTML = q
      ? S.data.ais.positions
          .filter((c) => c.position && c.name.toLowerCase().includes(q))
          .map((c) => `<button data-find="${c.id}">${esc(c.name)}</button>`)
          .join("")
      : "";
    $$("[data-find]").forEach(
      (b) =>
        (b.onclick = () => {
          const c = S.data.ais.positions.find((x) => x.id === b.dataset.find);
          S.map.setView([...c.position].reverse(), 17, { animate: document.documentElement.dataset.motion !== "reduced" });
          S.data.calls.some((call) => call.id === c.id)
            ? vesselModal(c.id)
            : aisVesselModal(c);
          $("#map-search-results").innerHTML = "";
        }),
    );
  };
}
function mapBase(map) {
  return attachBasemap(map, S.basemap, {
    onChange: (kind) => {
      S.basemap = kind;
      const label = $("#basemap-label");
      if (label) label.textContent = kind === "satellite" ? "Satellite" : "Map";
    },
  });
}
function initMap() {
  if (!$("#port-map")) return;
  if (S.map) S.map.remove();
  const p = S.data.port;
  const view=portMapView(p);
  const map = (S.map = L.map("port-map", {
    zoomControl: false,
    zoomAnimation: document.documentElement.dataset.motion !== "reduced",
    fadeAnimation: document.documentElement.dataset.motion !== "reduced",
    markerZoomAnimation: document.documentElement.dataset.motion !== "reduced",
    preferCanvas: true,
    zoomSnap: 0.1,
  }).setView(view.center,view.zoom));
  S.mapPortId = S.portId;
  S.mapBoundaryKey=portMapBoundaryKey(p);
  mapBase(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control
    .scale({ position: "bottomright", imperial: false, maxWidth: 100 })
    .addTo(map);
  $("#basemap-label").textContent =
    S.basemap === "satellite" ? "Satellite" : "Map";
  if (p.boundary && S.layers.boundary)
    L.geoJSON(p.boundary, {
      style: {
        color: "#88c7c5",
        weight: 1,
        dashArray: "6 6",
        fillOpacity: 0.025,
      },
    }).addTo(map);
  if (S.layers.boundary)
    S.data.zones.forEach((z) => {
      if (z.geometry)
        L.geoJSON(z.geometry, {
          style: {
            color: "#b6aad3",
            weight: 1,
            dashArray: "4 4",
            fillOpacity: 0.07,
          },
        })
          .addTo(map)
          .bindTooltip(esc(z.name));
    });
  const berthLabels = [];
  if (S.layers.berths)
    S.data.berths.forEach((b) => {
      if (!b.geometry) return;
      const layer = L.geoJSON(b.geometry, {
        style: { color: "#eb8d24", weight: 6, opacity: 1 },
      }).addTo(map);
      layer.bindTooltip(esc(b.code), {
        permanent: map.getZoom() >= 15,
        direction: "right",
        className: "berth-label",
        offset: [8, 0],
      });
      berthLabels.push(layer);
      layer.on("click", () => berthModal(b.id));
    });
  const placeBerthLabels = () => {
    const placed = [];
    const visible = map.getZoom() >= 15;
    const bounds = map.getContainer().getBoundingClientRect();
    berthLabels.forEach((layer) => {
      const tooltip = layer.getTooltip();
      tooltip.options.permanent = visible;
      if (!visible) { layer.closeTooltip(); return; }
      layer.openTooltip();
      const element = tooltip.getElement();
      if (!element) return;
      const anchor = map.latLngToContainerPoint(tooltip.getLatLng());
      if (anchor.x < 0 || anchor.y < 0 || anchor.x > bounds.width || anchor.y > bounds.height) {
        layer.closeTooltip();
        return;
      }
      // Try nearby positions first, then additional rows for dense berth groups.
      const step = Math.ceil(element.getBoundingClientRect().height) + 7;
      for (let row = 0; row <= berthLabels.length + 1; row++) {
        const shifts = row === 0 ? [0] : [-row * step, row * step];
        let found = false;
        for (const shift of shifts) {
          for (const direction of ["right", "left"]) {
            tooltip.options.direction = direction;
            tooltip.options.offset = L.point(direction === "right" ? 8 : -8, shift);
            tooltip.update();
            const rect = element.getBoundingClientRect();
            const overlaps = placed.some((other) => rect.left < other.right + 6 && rect.right + 6 > other.left && rect.top < other.bottom + 6 && rect.bottom + 6 > other.top);
            if (!overlaps && rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom) {
              placed.push(rect);
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
        // At extreme density, keep this berth available on hover instead.
        if (row === berthLabels.length + 1) {
          tooltip.options.permanent = false;
          layer.closeTooltip();
        }
      }
    });
  };
  map.on("zoomend moveend resize", placeBerthLabels);
  placeBerthLabels();
  if (S.layers.equipment)
    S.data.equipment.forEach((e) => {
      if (e.geometry?.type !== "Point") return;
      L.marker([...e.geometry.coordinates].reverse(), {
        icon: L.divIcon({
          className: "equipment-marker",
          html: `<div style="color:${e.status === "Available" ? "#e3c578" : "#e88775"};filter:drop-shadow(0 1px 2px #092732)"><svg width="21" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21h18M8 21V7l7-4 7 3-1 3-7-2-3 2M15 7v8M13 15h4M6 21l2-7h3l2 7"/></svg></div>`,
          iconSize: [21, 24],
        }),
      })
        .addTo(map)
        .on("click", () => equipmentModal(e.id))
        .bindTooltip(esc(e.name));
    });
  refreshVesselMarkers();
  setTimeout(() => map.invalidateSize(), 50);
}
function refreshVesselMarkers() {
  S.vesselDisplay?.destroy();
  S.vesselDisplay = null;
  if (S.map && S.layers.vessels)
    S.vesselDisplay = mountVessels(S.map, {
      positions: S.data.ais.positions,
      calls: S.data.calls,
      colors,
      esc,
      onSelect: (call, position) =>
        call ? vesselModal(call.id) : aisVesselModal(position),
    });
}
function aisVesselModal(position) {
  const presentation = aisObservationPresentation(position);
  modal(
    presentation.point ? "AIS observation details" : "AIS vessel details",
    `<div class="detail-banner"><div class="detail-icon">${icon(presentation.icon)}</div><div><h2>${esc(position.name)}</h2><p>${esc(presentation.label)} · ${esc(position.source)}</p></div></div><dl class="detail-grid">${[
      ["MMSI", position.mmsi || "Not reported"],
      ["IMO", position.imo || "Not reported"],
      ["Navigation status", position.navigation_label || "Not reported"],
      [
        "Speed",
        position.speed == null
          ? "Not reported"
          : fmt(position.speed, 1) + " kn",
      ],
      [
        "Heading",
        position.heading == null ? "Not reported" : fmt(position.heading) + "°",
      ],
      ...(position.historical_test ||
      (position.provider === "marinetraffic-client")
        ? [
            [
              "Course",
              position.course == null
                ? "Not reported"
                : fmt(position.course) + "°",
            ],
            [
              "Freshness",
              !position.freshness?.kind || position.freshness.kind === "unknown"
                ? "Unknown position time"
                : position.freshness.kind,
            ],
          ]
        : []),
      [
        presentation.point ? "Reported length" : "Vessel length",
        position.loa ? fmt(position.loa) + " m" : "Not reported",
      ],
      ["Destination", position.destination || "Not reported"],
      ...((position.provider === "marinetraffic-client")
        ? [
            [presentation.point ? "Provider observation ID" : "Provider vessel ID", position.ship_id || "Not reported"],
            ["Flag", position.flag || "Not reported"],
            ["Provider type", position.ship_type ?? "Not reported"],
            [
              "Beam",
              position.beam == null
                ? "Not reported"
                : fmt(position.beam, 1) + " m",
            ],
            [
              "Deadweight",
              position.dwt == null ? "Not reported" : fmt(position.dwt) + " t",
            ],
            ...(position.speed == null && position.raw_fields?.SPEED != null
              ? [
                  [
                    "Raw speed",
                    String(position.raw_fields.SPEED) + " · units unconfirmed",
                  ],
                ]
              : []),
          ]
        : []),
      [
        "Position time",
        position.position_at
          ? date(position.position_at)
          : "Unknown · relative age has no reference clock",
      ],
      [
        "Position",
        position.position.map((v) => Number(v).toFixed(5)).join(", "),
      ],
      [
        "Port boundary",
        position.inside == null
          ? "Unknown · no configured boundary"
          : position.inside
            ? "Inside port"
            : "Outside port / approaches",
      ],
    ]
      .map(
        ([label, value]) =>
          `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`,
      )
      .join(
        "",
      )}</dl><div class="notice">${position.historical_test ? "Historical/test observation. This data is not live tracking. " : "AIS observation only. "}${presentation.point ? "This report does not identify a vessel and is shown as a point marker. " : ""}This observation is not linked to a planned call.</div>`,
  );
}
let aisRefreshing = false;
async function refreshAIS() {
  if (S.data?.port.source_feed) return;
  if (
    aisRefreshing ||
    !S.user ||
    S.page !== "overview" ||
    !S.map ||
    document.visibilityState !== "visible" ||
    $("#overlay").innerHTML
  )
    return;
  const portId = S.portId;
  aisRefreshing = true;
  try {
    const ais = await api(path("/ais"));
    if (portId !== S.portId || S.page !== "overview" || !S.map) return;
    S.data.ais = ais;
    const empty = $("#ais-empty-state");
    if (empty) empty.hidden = !aisHasNoPositions(ais);
    if (empty && (ais.provider === "marinetraffic-client"))
      empty.querySelector("p").textContent = ais.message;
    refreshVesselMarkers();
    const legend = $("#ais-observed-legend");
    if (legend)
      legend.textContent = ais.historical_test
        ? "Historical/test AIS vessel"
        : "Observed AIS vessel";
    const meta = $(".map-card .card-meta");
    if (meta) meta.textContent = aisMapSummary();
    const caption = $("#ais-map-caption");
    if (caption) {
      caption.textContent = [
        "workbook-demo",
        "marinetraffic-client",
      ].includes(ais.provider)
        ? ais.message
        : "Demonstration positions · Illustrative geometry";
      caption.parentElement.title = ais.message;
    }
    const pill = $(".demo-pill");
    if (pill) {
      pill.innerHTML = `<span class="dot" style="width:5px;height:5px"></span>${esc(aisStateLabel())}`;
      pill.classList.toggle("live", ais.mode === "live");
    }
    const sidebar = $(".sidebar-mode");
    if (sidebar)
      sidebar.innerHTML = `<span class="dot"></span>${esc(aisStateLabel())}`;
  } finally {
    aisRefreshing = false;
  }
}
setInterval(() => refreshAIS().catch(() => {}), 10000);
function layersMenu() {
  if ($(".layer-menu")) return $(".layer-menu").remove();
  const el = document.createElement("div");
  el.className = "layer-menu";
  el.innerHTML = Object.entries(S.layers)
    .map(
      ([k, v]) =>
        `<label><input type="checkbox" data-layer="${k}" ${v ? "checked" : ""}>${k.charAt(0).toUpperCase() + k.slice(1)}</label>`,
    )
    .join("");
  $("#map-container").append(el);
  $$("[data-layer]", el).forEach(
    (i) =>
      (i.onchange = () => {
        S.layers[i.dataset.layer] = i.checked;
        initMap();
      }),
  );
  setTimeout(
    () =>
      document.addEventListener(
        "click",
        function dismiss(e) {
          if (!el.contains(e.target)) {
            el.remove();
            document.removeEventListener("click", dismiss);
          }
        },
        { once: false },
      ),
    0,
  );
}
function vesselModal(id) {
  const c = S.data.calls.find((x) => x.id === id);
  if (!c) return sourcePlanModal(id);
  const eq = S.data.equipment.find((e) => e.id === c.equipment_id);
  const position = S.data.ais.positions.find((p) => p.id === c.id);
  const alerts = S.data.alerts.filter(
    (a) => a.call_id === id && !["Closed", "Resolved"].includes(a.status),
  );
  modal(
    "Vessel call details",
    `<div class="detail-banner"><div class="detail-icon">${icon("ship")}</div><div><h2>${esc(c.name)}</h2><p>IMO ${esc(c.imo || "—")} · MMSI ${esc(c.mmsi || "—")}</p></div><div style="margin-left:auto">${status(c.status)}</div></div><dl class="detail-grid">${[
      ["Assigned berth", berth(c.berth_id)?.name || "Unassigned"],
      ["Cargo flow", c.direction || "—"],
      ["Product", c.product],
      ["Grade", c.grade || "—"],
      ["Sub-grade", c.subgrade || "Not applicable"],
      [
        "Planned duration",
        fmt((new Date(c.end) - new Date(c.start)) / 3600000, 2) + " h",
      ],
      ["Quantity", `${fmt(c.quantity)} t · ${c.direction}`],
      ["Vessel length", `${c.loa} m`],
      ["Draft", `${c.draft} m`],
      ["Equipment", eq?.name || "Unassigned"],
      ["ETA", date(c.eta)],
      ["Planned start", date(c.start)],
      ["Planned completion", date(c.end)],
      ["Cargo readiness", c.ready ? "Confirmed" : "Not ready"],
      ["Handled quantity", `${fmt((c.quantity * c.progress) / 100)} t`],
      ["Remaining quantity", `${fmt(c.quantity * (1 - c.progress / 100))} t`],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
      .join(
        "",
      )}</dl><div style="display:flex;justify-content:space-between;font-size:calc(10px * var(--ui-font-scale, 1));color:#7f929d"><span>Operational progress</span><strong>${c.progress}%</strong></div><div class="full-progress"><span style="width:${c.progress}%"></span></div>${position ? `<p class="config-description">Position ${position.position.map((v) => Number(v).toFixed(5)).join(", ")} · ${esc(position.source)} · ${date(position.position_at)}${position.stale ? " · STALE" : ""}</p>` : ""}${S.data.delays.filter(d => d.call_id === id).map(d => `<div class="list-card"><div class="list-copy"><h3>${esc(d.cause || "Operational delay")} · ${fmt(d.hours)} h</h3><p>${esc(d.description)}</p></div>${can("config.edit") ? `<button class="btn small danger" data-remove-record="${d.id}" data-remove-kind="delays">Remove delay</button>` : ""}</div>`).join("")}${alerts.map((a) => `<div class="notice warning">${icon("triangle-alert")}${esc(a.title)}: ${esc(a.description)}</div>`).join("")}<div class="detail-actions">${btn("Locate in planning", "calendar-range", "locate-call", "primary")}${can("planning.draft") ? btn("Propose change", "git-pull-request", "edit-call") : ""}${can("readiness.update") ? btn(c.ready ? "Mark cargo not ready" : "Confirm cargo ready", "package-check", "ready-call") : ""}${can("operations.update") ? btn("Update actuals", "clipboard-pen", "actuals-call") : ""}${can("delays.create") ? btn("Declare delay", "clock-alert", "delay-call") : ""}${can("config.edit") ? btn("Remove vessel call", "trash-2", "remove-call", "danger") : ""}</div>`,
  );
  if (c.source_snapshot) {
    const reference = document.createElement("button");
    reference.className = "btn small";
    reference.textContent = "Excel reference & demo assumptions";
    reference.onclick = () =>
      modal(
        "Original Excel record",
        sourceCallDetails(c.source_snapshot) +
          `<div class="notice">${esc(c.demo_assumptions?.join(" ") || "No additional assumptions.")}</div>`,
      );
    $(".detail-actions").prepend(reference);
  }
  $("[data-action=locate-call]").onclick = () => {
    S.date = new Date(c.start);
    closeModal();
    nav("planning");
    setTimeout(() => {
      $(`[data-call="${id}"]`)?.scrollIntoView({
        behavior: document.documentElement.dataset.motion === "reduced" ? "instant" : "smooth",
        block: "center",
        inline: "center",
      });
    }, 100);
  };
  if ($("[data-action=edit-call]"))
    $("[data-action=edit-call]").onclick = () => proposalForm(c);
  if ($("[data-action=ready-call]"))
    $("[data-action=ready-call]").onclick = async () => {
      try {
        await api(path(`/calls/${id}/readiness`), "POST", {
          ready: !c.ready,
          revision: c.revision,
        });
        await refresh();
        vesselModal(id);
        toast("Cargo readiness saved");
      } catch (e) {
        toast(e.message, true);
      }
    };
  if ($("[data-action=actuals-call]"))
    $("[data-action=actuals-call]").onclick = () => actualsModal(c);
  bindRecords($("#overlay"));
  if ($("[data-action=remove-call]")) $("[data-action=remove-call]").onclick = () => confirmRemoval(path(`/calls/${c.id}?revision=${c.revision}`), c.name, "Linked alerts, delays and workflows must be resolved first. Published history is retained.");
  if ($("[data-action=delay-call]"))
    $("[data-action=delay-call]").onclick = () => delayForm(c.id);
  icons();
}
function actualsModal(c) {
  modal(
    "Update operational actuals",
    `<form id="actuals-form"><p class="config-description">Actual operation updates are recorded separately from the approved schedule. Times below use your browser's local timezone.</p><div class="form-grid">${select("Operational status", "status", ["Scheduled", "Waiting", "Berthed", "Loading", "Unloading", "Delayed", "Completed", "Cancelled"], c.status)}${field("Progress, %", "progress", c.progress, "number", 'min="0" max="100" required')}${["actual_arrival", "actual_start", "actual_end", "actual_departure"].map((k) => field(k.replace("actual_", "Actual ").replace("_", " "), k, c[k] ? inputDate(c[k]) : "", "datetime-local")).join("")}</div><div class="form-actions"><button type="submit" class="btn primary">${icon("save")}Save actuals</button></div></form>`,
  );
  handleForm("#actuals-form", async (d) => {
    d.progress = Number(d.progress);
    d.revision = c.revision;
    for (const k of [
      "actual_arrival",
      "actual_start",
      "actual_end",
      "actual_departure",
    ])
      d[k] = d[k] ? iso(d[k]) : null;
    await api(path(`/calls/${c.id}/actuals`), "POST", d);
    closeModal();
    await refresh();
    toast("Operational actuals saved");
  });
}
function vesselList(filter = () => true, title = "Vessel calls") {
  const rows = S.data.calls.filter(filter);
  modal(
    title,
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px"><p class="config-description" style="margin:0">${rows.length} stored vessel calls in ${esc(S.data.port.code)}</p>${can("calls.create") ? btn("New nomination", "plus", "modal-new-call", "primary") : ""}</div><div class="table-scroll"><table><thead><tr><th scope=\"col\">Vessel</th><th scope=\"col\">Cargo</th><th scope=\"col\">Quantity</th><th scope=\"col\">Berth</th><th scope=\"col\">ETA</th><th scope=\"col\">Status</th><th scope=\"col\">Actions</th></tr></thead><tbody>${rows.map((c) => `<tr class="clickable" data-vessel="${c.id}"><td class="vessel-cell">${esc(c.name)}</td><td>${esc(c.product)}</td><td>${fmt(c.quantity)} t</td><td>${esc(berth(c.berth_id)?.code || "—")}</td><td>${date(c.eta)}</td><td>${status(c.status)}</td><td>${can("config.edit") ? `<button class="btn small danger" data-remove-record="${c.id}" data-remove-kind="calls">Remove</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`,
    true,
  );
  bindRecords($("#overlay"));
  if ($("[data-action=modal-new-call]"))
    $("[data-action=modal-new-call]").onclick = () => vesselForm();
  icons();
}
function berthModal(id) {
  const b = berth(id);
  if (!b) return;
  const assigned = S.data.calls.filter(
    (c) => c.berth_id === id && c.status !== "Completed",
  );
  modal(
    b.name,
    `<div class="detail-banner"><div class="detail-icon">${icon("anchor")}</div><div><h2>${esc(b.code)}</h2><p>${esc(b.terminal)}</p></div>${status(b.status)}</div><dl class="detail-grid">${[
      ["Length", b.length + " m"],
      ["Max. vessel length", b.max_loa + " m"],
      ["Max. draft", b.max_draft + " m"],
      ["Safety buffer", b.buffer_hours + " h"],
      ["Cargo compatibility", b.cargo.join(", ")],
      [
        "Equipment",
        S.data.equipment
          .filter((e) => e.berths.includes(id))
          .map((e) => e.name)
          .join(", ") || "None",
      ],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
      .join(
        "",
      )}</dl><h3 class="detail-section-title">Assigned vessel calls</h3>${assigned.map((c) => `<div class="list-card" style="padding:12px 0;cursor:pointer" data-vessel="${c.id}"><div class="list-copy"><h3>${esc(c.name)}</h3><p>${date(c.start)} → ${date(c.end)}</p></div>${status(c.status)}</div>`).join("") || empty("No assigned calls")}<div class="form-actions">${btn("View berth planning", "calendar-range", "berth-planning", "primary")}${S.map ? btn("Highlight on map", "map-pin", "berth-locate") : ""}</div>`,
  );
  bindRecords($("#overlay"));
  $("[data-action=berth-planning]").onclick = () => {
    closeModal();
    nav("planning");
  };
  if ($("[data-action=berth-locate]"))
    $("[data-action=berth-locate]").onclick = () => {
      closeModal();
      const g = L.geoJSON(b.geometry);
      S.map.fitBounds(g.getBounds(), { maxZoom: 18, padding: [50, 50] });
    };
  icons();
}
function equipmentModal(id) {
  const e = S.data.equipment.find((x) => x.id === id);
  modal(
    "Equipment details",
    `<div class="detail-banner"><div class="detail-icon">${icon("construction")}</div><div><h2>${esc(e.name)}</h2><p>${esc(e.type)}</p></div>${status(e.status)}</div><dl class="detail-grid"><div><dt>Capacity</dt><dd>${fmt(e.capacity)} t/h</dd></div><div><dt>Served berths</dt><dd>${e.berths.map((id) => berth(id)?.code).join(", ")}</dd></div></dl>${can("equipment.update") ? btn(e.status === "Available" ? "Declare unavailable" : "Restore availability", "wrench", "toggle-eq", "primary") : ""}`,
  );
  if ($("[data-action=toggle-eq]"))
    $("[data-action=toggle-eq]").onclick = async () => {
      try {
        await api(path(`/equipment/${e.id}`), "PUT", {
          revision: e.revision,
          status: e.status === "Available" ? "Outage" : "Available",
        });
        closeModal();
        await refresh();
        toast("Equipment availability updated");
      } catch (err) {
        toast(err.message, true);
      }
    };
  icons();
}
function productModal(name) {
  vesselList((c) => c.product === name, `${name} · Cargo records`);
}
function metricModal(i) {
  if ([0, 1].includes(i))
    return vesselList(
      (c) =>
        i === 0
          ? ["Loading", "Unloading", "Delayed", "Waiting", "Berthed"].includes(
              c.status,
            )
          : ["Scheduled", "Waiting"].includes(c.status),
      i === 0 ? "Active vessel calls" : "Upcoming vessel calls",
    );
  if (i === 2) {
    modal(
      "Berth utilization",
      `<div class="notice">${icon("info")}Current occupied berths ÷ configured berths. A berth is occupied when a vessel has a validated Loading, Unloading, Delayed or Berthed status.</div>${S.data.berths.map((b) => `<div class="list-card" data-berth="${b.id}"><div class="list-copy"><h3>${esc(b.code)} · ${esc(b.name)}</h3><p>${b.length} m · ${b.max_draft} m draft</p></div>${status(S.data.calls.find((c) => c.berth_id === b.id && ["Loading", "Unloading", "Delayed", "Berthed"].includes(c.status))?.status || b.status)}</div>`).join("")}`,
    );
    bindRecords($("#overlay"));
    return;
  }
  if (i === 6) {
    S.tab = "reports";
    nav("center");
    return;
  }
  if (i === 7) {
    modal(
      "Planning constraint checks",
      `<div class="notice">${icon("shield-check")}Detected from current stored calls, berth configuration, cargo readiness and equipment records.</div>${S.data.stats.conflicts.map((c) => `<div class="list-card" data-vessel="${c.call_id}"><div class="list-copy"><h3>${esc(c.name)}</h3>${c.errors.map((e) => `<p>• ${esc(e)}</p>`).join("")}</div></div>`).join("") || empty("No hard constraint violations", "All current allocations pass the implemented checks.", "shield-check")}`,
    );
    bindRecords($("#overlay"));
    return;
  }
  vesselList(
    (c) => c.status === "Completed",
    i === 3
      ? "Waiting time · Completed calls"
      : i === 4
        ? "Turnaround · Completed calls"
        : "Schedule adherence · Completed calls",
  );
}
function exportModal() {
  modal(
    "Export port operations",
    `<p class="config-description">Export stored vessel calls for the selected port. Custom date, berth and cargo filters are available in Workflow center.</p><div class="detail-actions">${["csv", "xlsx", "pdf"].map((f) => `<a class="btn ${f === "xlsx" ? "primary" : ""}" href="/api${path("/reports/export")}?format=${f}" download>${icon("download")}${f.toUpperCase()}</a>`).join("")}</div>`,
  );
}
function profileModal() {
  modal(
    "Your workspace",
    `<div class="detail-banner"><span class="avatar">${S.user.name
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(
        "",
      )}</span><div><h2>${esc(S.user.name)}</h2><p>${esc(S.user.email)}</p></div></div><div class="notice">${icon("shield-check")}${esc(membership()?.role || "Super Administrator")} · ${esc(membership()?.department || "Administration")}</div>${btn("Sign out", "log-out", "logout", "danger")}`,
  );
  $("[data-action=logout]").onclick = async () => {
    await api("/auth/logout", "POST", {});
    S.user = null;
    S.data = null;
    closeModal();
    cleanupMaps();
    renderLogin();
  };
  icons();
}
function renderLogin() {
  document.querySelector("#assistant-chat")?.remove();
  S.assistantChat = null;
  $("#app").innerHTML =
    `<div class="login-screen"><aside class="login-aside"><div class="brand"><span class="brand-icon">${icon("anchor")}</span><span><span class="brand-name">Portside</span><div class="brand-tag">Port operations & planning</div></span></div><div class="login-copy"><h1>Port operations<br>& berth planning.</h1><p>Vessel schedules, berth allocation and operational coordination.</p></div><footer>Portside · Operations console</footer></aside><section class="login-main"><form class="login-form" id="login-form"><h2>Operator sign in</h2><p>Sign in to your operations workspace.</p>${field("Email address", "email", "", "email", 'required autocomplete="username" spellcheck="false"')}${field("Password", "password", "", "password", 'required autocomplete="current-password"')}<div class="login-error" id="login-error" role="alert"></div><button type="submit" class="btn primary">Sign in ${icon("arrow-right")}</button></form></section></div>`;
  icons();
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("button[type=submit]", e.target);
    b.disabled = true;
    $("#login-error").textContent = "";
    try {
      S.user = await api("/auth/login", "POST", formData(e.target));
      await loadWorkspace();
    } catch (err) {
      $("#login-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
async function loadWorkspace() {
  S.ports = await api("/ports");
  if (!S.ports.some((p) => p.id === S.portId)) S.portId = S.ports[0]?.id;
  if (!S.portId) {
    modal(
      "No assigned ports",
      empty("No port access", "Ask your administrator to assign a port."),
    );
    return;
  }
  S.data = await api(path("/snapshot"));
  if (S.data.port.demo_clock) S.date = new Date(S.data.port.demo_clock);
  if (S.data.port.source_feed) {
    S.date = new Date(S.data.port.source_feed.report_date + "T00:00:00");
    S.page = "overview";
  }
  renderApp();
}
window.P = {
  saveGeoBeforeNavigation,
  fitTimeline,
  S,
  $,
  $$,
  esc,
  icon,
  fmt,
  date,
  time,
  inputDate,
  iso,
  berth,
  can,
  membership,
  aisStateLabel,
  colors,
  statusColor,
  status,
  btn,
  empty,
  field,
  select,
  textArea,
  api,
  path,
  toast,
  icons,
  modal,
  closeModal,
  formData,
  handleForm,
  refresh,
  nav,
  pageHeading,
  cardHead,
  progress,
  alertRow,
  bindRecords,
  mapBase,
  vesselModal,
  vesselList,
  berthModal,
  equipmentModal,
  renderApp,
  exportModal,
};
document.addEventListener("keydown", e => {
  if (e.defaultPrevented || !e.target.matches('[role="button"]:not(button):not(a[href])')) return;
  if (e.key === "Enter") { e.preventDefault(); e.target.click(); }
  if (e.key === " ") e.preventDefault();
});
document.addEventListener("keyup", e => {
  if (!e.defaultPrevented && e.key === " " && e.target.matches('[role="button"]:not(button):not(a[href])')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("#overlay [data-action]");
  if (b && !b.onclick) action(b.dataset.action);
});
setInterval(updateClock, 1000);
// Poll only when no dialog, drag, or configuration editor is active, preserving unsaved edits.
setInterval(async () => {
  if (
    S.user &&
    S.data &&
    !$("#overlay").innerHTML &&
    ["overview", "center"].includes(S.page) &&
    document.visibilityState === "visible"
  ) {
    try {
      await refresh();
    } catch {}
  }
}, 60000);
try {
  S.user = await api("/auth/me");
  await loadWorkspace();
} catch {
  renderLogin();
}
