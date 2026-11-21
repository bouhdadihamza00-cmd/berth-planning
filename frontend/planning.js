import { getPreferences, getLocale } from "./preferences.js?v=8";
import { confirmRemoval } from "./removal.js?v=6";
import { buildTimeline, shiftAnchor } from "./timeline.js?v=6";
import {
  cargoFields,
  bindCargoFields,
  timingFields,
  bindTiming,
} from "./cargo.js?v=13";
const P = () => window.P;
const activeDraftFor = (callId) =>
  (P().S.data.drafts || []).find(
    (d) =>
      d.call_id === callId &&
      ["Draft", "Submitted", "Clarification requested"].includes(d.status),
  );
export function planningProposals(data, pending = {}) {
  const active = new Set(["Draft", "Submitted", "Approved", "Clarification requested"]);
  return [
    ...data.drafts.filter(d => active.has(d.status) && d.proposed && d.operation !== "create").map(d => ({ ...d.proposed, id: d.call_id, proposalKey: d.id, proposalStatus: d.status })),
    ...Object.entries(pending).map(([id, c]) => ({ ...c, id, proposalKey: `pending-${id}`, proposalStatus: "Unsaved change" })),
  ];
}
export function shiftForecastForEarlierStart(current, next) {
  if (!current?.start || !next?.start || current.actual_arrival) return next;
  const shift = new Date(next.start).getTime() - new Date(current.start).getTime();
  if (!Number.isFinite(shift) || shift >= 0) return next;
  const startsBefore = (value) => Boolean(value) && new Date(next.start).getTime() < new Date(value).getTime();
  if (!startsBefore(current.eta) && !startsBefore(current.ready_at)) return next;
  const shifted = { ...next };
  const moved = (value) => new Date(new Date(value).getTime() + shift).toISOString();
  if (startsBefore(current.eta)) shifted.eta = moved(current.eta);
  if (startsBefore(current.ready_at)) shifted.ready_at = moved(current.ready_at);
  return shifted;
}
export function overlapsScheduleComparison(card, cards) {
  return cards.some(other =>
    Boolean(card.call.proposalKey) !== Boolean(other.call.proposalKey) &&
    card.left < other.right &&
    other.left < card.right
  );
}
export function renderPlanning() {
  const {
    S,
    esc,
    icon,
    fmt,
    can,
    btn,
    status,
    berth,
    empty,
    pageHeading,
    cardHead,
  } = P();
  const calls = S.data.port.source_feed
    ? S.data.source_plans
    : S.data.calls.filter(
        (c) => !["Completed", "Cancelled"].includes(c.status),
      );
  const selectedScale = S.timelineScale || "week";
  const pending = Object.keys(S.pending || {}).length;
  const submitted = S.data.drafts.filter(
    (d) => d.status === "Submitted",
  ).length;
  const conflicts = S.data.stats.conflicts.length;
  return (
    pageHeading(
      "Berth planning",
      S.data.port.source_feed
        ? "Historical Excel plan · Half-day slots · Source estimates, separate from actual operation times."
        : "Berth allocation, vessel schedules and proposed changes.",
      `${S.data.port.excel_source ? btn("Excel reference", "file-spreadsheet", "source-feed", "hide-mobile") : ""}${S.data.port.source_feed ? btn("Source data", "file-spreadsheet", "source-feed", "hide-mobile") : btn("Plan history", "history", "history", "hide-mobile")}${can("scenarios.create") ? btn("Scenario intelligence", "sparkles", "scenario") : ""}${can("calls.create") ? btn("New vessel call", "plus", "new-call", "primary") : ""}`,
    ) +
    `<div class="planning-summary">${[
      [
        "anchor",
        S.data.berths.length,
        S.data.port.source_feed ? "Source berth labels" : "Configured berths",
      ],
      [
        "ship",
        calls.length,
        S.data.port.source_feed
          ? "Source plan entries"
          : "Active & scheduled calls",
      ],
      [
        "git-pull-request",
        S.data.port.source_feed ? 3 : submitted,
        S.data.port.source_feed ? "Source workbooks" : "Awaiting approval",
      ],
      [
        "shield-check",
        S.data.port.source_feed ? "—" : conflicts,
        S.data.port.source_feed
          ? "Capacity limits not supplied"
          : conflicts
            ? "Constraint violations"
            : "All constraints clear",
      ],
    ]
      .map(
        ([ic, n, l]) =>
          `<div class="summary-card ${ic === "shield-check" && conflicts && !S.data.port.source_feed ? "has-conflicts" : ""}"><div class="summary-icon">${icon(ic)}</div><div><b>${n}</b><span>${l}</span></div></div>`,
      )
      .join(
        "",
      )}</div><section class="card planning-board"><div class="toolbar planning-toolbar"><div class="planning-filters"><div class="search-box">${icon("search")}<input id="planning-search" value="${esc(S.search)}" placeholder="Search vessel or cargo…" aria-label="Search planning"></div><select id="planning-status" aria-label="Filter by status"><option value="">All statuses</option>${["Loading", "Unloading", "Waiting", "Scheduled", "Delayed"].map((x) => `<option ${S.planStatus === x ? "selected" : ""}>${x}</option>`).join("")}</select><select id="planning-cargo" aria-label="Filter by cargo"><option value="">All cargo</option>${S.data.port.products.map((x) => `<option ${S.planCargo === x.name ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div><div class="planning-calendar"><button class="icon-btn" id="plan-prev" aria-label="Previous ${selectedScale}">${icon("chevron-left")}</button><button class="btn small" id="plan-today">${S.data.port.demo_clock ? "Demo date" : S.data.port.source_feed ? "Report date" : "Today"}</button><button class="icon-btn" id="plan-next" aria-label="Next ${selectedScale}">${icon("chevron-right")}</button><input type="date" id="plan-date" value="${new Date(S.date || S.data.port.demo_clock || Date.now()).toLocaleDateString("en-CA")}" aria-label="Planning start date"><div class="segmented timeline-scales" role="group" aria-label="Timeline scale">${["day", "week", "month", "year"].map((mode) => `<button type="button" data-scale="${mode}" aria-pressed="${selectedScale === mode}" class="${selectedScale === mode ? "active" : ""}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join("")}</div><button class="icon-btn" id="plan-fullscreen" aria-label="Fullscreen timeline">${icon("expand")}</button></div></div><div class="toolbar planning-editbar"><span class="planning-help">${icon("mouse-pointer-2")} ${can("planning.draft") ? `Drag vessels to move · Drag edges to resize · ${S.data.port.rules.snap_minutes || 15}-min snap` : "Read-only berth schedule"}</span><div class="spacer"></div><button class="icon-btn" id="plan-undo" aria-label="Undo uncommitted edit" ${!S.undo.length ? "disabled" : ""}>${icon("undo-2")}</button><button class="icon-btn" id="plan-redo" aria-label="Redo uncommitted edit" ${!S.redo.length ? "disabled" : ""}>${icon("redo-2")}</button><span class="planning-plan-state ${pending ? "has-changes" : ""}">${S.data.port.source_feed ? "Historical source plan" : pending ? pending + " uncommitted change" + (pending > 1 ? "s" : "") : "Published schedule"}</span>${pending ? `<button class="btn small primary" id="save-pending">${icon("save")}Save ${pending} draft${pending > 1 ? "s" : ""}</button><button class="btn small" id="discard-pending">Discard edits</button>` : ""}</div><div class="gantt-wrap" id="gantt-wrap" tabindex="0" role="region" aria-label="Berth schedule. Scroll horizontally for dates and vertically for berths; drag empty space to pan."><div class="gantt" id="gantt"></div></div><div class="gantt-footer"><div class="gantt-legend">${[
      [P().colors.Loading, "Loading"],
      [P().colors.Unloading, "Unloading"],
      [P().colors.Waiting, "Waiting"],
      [P().colors.Delayed, "Delayed"],
      [P().colors.Scheduled, "Scheduled"],
      ["#8655d1", "Draft / proposal (dashed)"],
    ]
      .map(
        ([color, label]) =>
          `<span><span class="legend-color" style="background:${color}"></span>${label}</span>`,
      )
      .join(
        "",
      )}</div><span><span id="gantt-visible-range"></span> · Timezone: ${esc(S.data.port.timezone)} · ${S.data.port.source_feed ? "Source quantities in kt converted to tonnes" : `${S.data.versions.length} saved version${S.data.versions.length !== 1 ? "s" : ""}`}</span></div></section>${S.data.drafts.filter((d) => ["Draft", "Submitted", "Approved", "Clarification requested"].includes(d.status)).length ? `<div class="notice" style="margin-top:16px">${icon("git-pull-request")} ${S.data.drafts.filter((d) => ["Draft", "Submitted", "Approved", "Clarification requested"].includes(d.status)).length} schedule proposals are saved separately from the published plan. Review them in Workflow center.<button class="btn small ghost" id="go-approvals" style="margin-left:auto">Open approvals ${icon("arrow-right")}</button></div>` : ""}<div id="scenario-inline"></div>`
  );
}
function gantt() {
  const {
    S,
    $,
    $$,
    esc,
    icon,
    fmt,
    berth,
    statusColor,
    date,
    can,
    vesselModal,
  } = P();
  const host = $("#gantt");
  if (!host) return;
  const wrap = $("#gantt-wrap");
  const label = window.innerWidth < 600 ? 96 : 184;
  const mode = S.timelineScale || "week";
  const model = buildTimeline({
    mode,
    anchor:
      S.date ||
      S.data.port.demo_clock ||
      S.data.port.source_feed?.reference_time ||
      new Date(),
    timezone: S.data.port.timezone,
    locale: getLocale(),
    viewportWidth: wrap.clientWidth - label,
    records: S.data.port.source_feed
      ? S.data.source_plans
      : S.data.calls.filter(
          (c) => !["Completed", "Cancelled"].includes(c.status),
        ),
  });
  const { start, scale, width } = model;
  const duration = (model.end - start) / 3600000;
  const viewKey = `${S.portId}:${mode}:${+model.periodStart}`;
  if (S.ganttView?.key !== viewKey)
    S.ganttView = {
      key: viewKey,
      leftTime: +model.periodStart,
      top: S.ganttView?.top || 0,
    };
  const prefs = getPreferences();
  const rowPixels = Math.ceil(86 * Math.max(1, prefs.fontSize / 13) + (prefs.density === "comfortable" ? 12 : 0));
  host.style.setProperty("--hmi-row-height", `${rowPixels}px`);
  host.style.setProperty("--gantt-label-width", label + "px");
  S.timeline = { start: +start, width, duration, label, scale, model, rowPixels };
  host.style.gridTemplateColumns = `${label}px ${width}px`;
  host.style.width = `${label + width}px`;
  const ticks = model.minor.map(
    (t) =>
      `<span style="left:${t.left}px;width:${t.width}px">${t.label}</span>`,
  );
  const days = model.major
    .map(
      (t) =>
        `<span style="position:absolute;left:${t.left}px;width:${t.width}px"><b>${t.label}</b></span>`,
    )
    .join("");
  const grid = model.minor
    .map(
      (t) =>
        `<span aria-hidden="true" class="gantt-gridline" style="left:${t.left}px"></span>`,
    )
    .join("");
  const timelineBerths = [...S.data.berths];
  if (S.data.port.source_feed) {
    const visible = new Set(
      S.data.source_plans
        .filter(
          (p) =>
            new Date(p.end) > start &&
            new Date(p.start) < +start + duration * 3600000,
        )
        .map((p) => p.berth_code),
    );
    timelineBerths.sort(
      (a, b) =>
        Number(visible.has(b.code)) - Number(visible.has(a.code)) ||
        a.code.localeCompare(b.code, "en", { numeric: true }),
    );
  }
  const rowHeight = () => rowPixels;
  host.innerHTML =
    `<div class="gantt-label head">${icon("anchor")} Berths & terminals</div><div class="gantt-time-head"><div class="gantt-day">${days}</div><div class="gantt-hours">${ticks.join("")}</div></div>` +
    timelineBerths
      .map(
        (b) =>
          `<div class="gantt-label" data-berth-row="${b.id}" style="height:${rowHeight(b)}px"><span class="port-symbol" style="width:29px;height:29px">${icon("anchor")}</span><div><strong>${esc(b.code)} · ${esc(b.name)}</strong><small>${S.data.port.source_feed ? "Historical berth label" : `${b.max_loa} m LOA · ${b.max_draft} m draft`}</small></div></div><div class="gantt-row" data-row="${b.id}" style="background-image:none;height:${rowHeight(b)}px">${grid}${blocks(b, start, width)}${nowLine(start, width)}</div>`,
      )
      .join("");
  if (!S.data.berths.length)
    host.innerHTML += `<div style="padding:50px;grid-column:1/-1;color:#91a3ac">No berths configured. Draw berths in Configuration to start planning.</div>`;
  wrap.scrollLeft = ((S.ganttView.leftTime - +start) / 3600000) * scale;
  wrap.scrollTop = S.ganttView.top;
  P().icons();
  const hoverInfo = document.createElement("div");
  hoverInfo.className = "schedule-hover-info";
  hoverInfo.id = "schedule-hover-info";
  hoverInfo.setAttribute("role", "tooltip");
  hoverInfo.hidden = true;
  wrap.append(hoverInfo);
  const hideInfo = () => { hoverInfo.hidden = true; };
  const showInfo = (el, x, y) => {
    if (!el.matches(".schedule-compact,.schedule-minimal,.schedule-marker")) {
      hideInfo();
      return;
    }
    hoverInfo.replaceChildren();
    el.dataset.scheduleInfo.split("\n").forEach((line, i) => {
      const item = document.createElement(i === 0 ? "strong" : "div");
      item.textContent = line;
      hoverInfo.append(item);
    });
    hoverInfo.hidden = false;
    const rect = hoverInfo.getBoundingClientRect();
    hoverInfo.style.left = Math.max(8, Math.min(x + 16, innerWidth - rect.width - 8)) + "px";
    hoverInfo.style.top = Math.max(8, y + 18 + rect.height > innerHeight - 8 ? y - rect.height - 14 : y + 18) + "px";
  };
  wrap.addEventListener("scroll", hideInfo, { passive: true });
  $$(".gantt-block").forEach((el) => {
    el.dataset.scheduleInfo = el.title;
    el.removeAttribute("title");
    el.setAttribute("aria-describedby", hoverInfo.id);
    el.addEventListener("pointermove", (e) => {
      if (e.buttons || e.pointerType === "touch") { hideInfo(); return; }
      showInfo(el, e.clientX, e.clientY);
    });
    el.addEventListener("pointerleave", hideInfo);
    el.addEventListener("pointerdown", hideInfo);
    el.addEventListener("focus", () => {
      const rect = el.getBoundingClientRect();
      showInfo(el, rect.left, rect.bottom);
    });
    el.addEventListener("blur", hideInfo);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") hideInfo(); });
    el.addEventListener("click", (e) => {
      if (el.dataset.dragged === "1") {
        el.dataset.dragged = "0";
        return;
      }
      vesselModal(el.dataset.call);
    });
    el.addEventListener("keydown", (e) => {
      if (e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        keyboardAdjustSchedule(e, el);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        vesselModal(el.dataset.call);
      }
    });
    const pendingCard = el.dataset.proposal?.startsWith("pending-");
    if (can("planning.draft") && (!el.dataset.proposal || pendingCard))
      el.addEventListener("pointerdown", (e) => drag(e, el));
  });
  $$("[data-berth-row]").forEach(
    (el) => (el.onclick = () => P().berthModal(el.dataset.berthRow)),
  );
  drawProposalConnections(host);
  fitScheduleCards();
  updateVisibleRange();
}
// Keep the card's details in the visible portion of its true time interval.
function updateVisibleRange() {
  const { S, $ } = P();
  const wrap = $("#gantt-wrap"),
    target = $("#gantt-visible-range");
  if (!wrap || !target) return;
  const left =
    S.timeline.start + (wrap.scrollLeft / S.timeline.scale) * 3600000;
  const right =
    left + ((wrap.clientWidth - S.timeline.label) / S.timeline.scale) * 3600000;
  const format = new Intl.DateTimeFormat(getLocale(), {
    timeZone: S.data.port.timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  target.textContent = `${format.format(left)} – ${format.format(right - 3600000 / S.timeline.scale)}`;
  // Keep each period title inside its real calendar band while panning.
  [...document.querySelectorAll(".gantt-day > span > b")].forEach(
    (title, index) => {
      const band = S.timeline.model.major[index];
      title.style.left =
        Math.max(
          8,
          Math.min(
            wrap.scrollLeft - band.left + 8,
            band.width - title.offsetWidth - 8,
          ),
        ) + "px";
    },
  );
}
function fitScheduleCards() {
  const { S, $ } = P();
  const wrap = $("#gantt-wrap");
  if (!wrap) return;
  const viewport = wrap.getBoundingClientRect();
  const leftEdge = viewport.left + S.timeline.label;
  const rightEdge = viewport.left + wrap.clientWidth;
  const cards = [...wrap.querySelectorAll(".gantt-block")].map((card) => {
    const rect = card.getBoundingClientRect();
    return {
      card,
      width: Math.max(
        0,
        Math.min(
          620,
          Math.min(rect.right, rightEdge) - Math.max(rect.left, leftEdge) - 40,
        ),
      ),
    };
  });
  for (const { card, width } of cards) {
    card.querySelector(".schedule-content").style.width = width + "px";
    card.classList.toggle("schedule-compact", width < 280);
    card.classList.toggle("schedule-minimal", width < 130);
  }
}
function nowLine(start, width) {
  const left =
    ((new Date(
      P().S.data.port.demo_clock ||
        P().S.data.port.source_feed?.reference_time ||
        Date.now(),
    ) -
      start) /
      3600000) *
    P().S.timeline.scale;
  if (left < 0 || left > width) return "";
  return `<div class="now-line" style="left:${left}px"></div>`;
}
function blocks(b, start, width) {
  const { S, esc, fmt, icon } = P();
  const base = S.data.port.source_feed
    ? S.data.source_plans.map((p) => ({
        ...p,
        berth_id: "excel-berth-" + p.berth_code.toLowerCase(),
        product:
          S.data.calls.find((c) => c.id === p.call_id)?.product || p.product,
        status: "Scheduled",
        direction:
          S.data.calls.find((c) => c.id === p.call_id)?.direction || "Plan",
        progress: 0,
      }))
    : S.data.calls.filter(
        (c) => !["Completed", "Cancelled"].includes(c.status),
      );
  const cards = [];
  const proposals = planningProposals(S.data, S.pending);
  for (const c of [...base, ...proposals]) {
    if (
      c.berth_id !== b.id ||
      (S.search &&
        !`${c.name} ${c.product}`
          .toLowerCase()
          .includes(S.search.toLowerCase())) ||
      (S.planStatus && c.status !== S.planStatus) ||
      (S.planCargo && c.product !== S.planCargo)
    )
      continue;
    const left = Math.max(0, ((new Date(c.start) - start) / 3600000) * S.timeline.scale);
    const right = Math.min(width, ((new Date(c.end) - start) / 3600000) * S.timeline.scale);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      right <= left
    )
      continue;
    cards.push({ call: c, left, right });
  }
  const fullHeight = S.timeline.rowPixels - 14;
  let output = "";
  for (const card of cards) {
    const { call: c, left, right } = card;
    const w = right - left;
    const comparison = overlapsScheduleComparison(card, cards);
    const height = comparison ? fullHeight * 32 / 72 : fullHeight;
    const top = 7 + (comparison && c.proposalKey ? fullHeight - height : 0);
    const cls = c.proposalKey
      ? "draft"
      : c.status === "Unloading"
        ? "blue"
        : c.status === "Delayed"
          ? "red"
          : c.status === "Waiting"
            ? "amber"
            : c.status === "Scheduled"
              ? "neutral"
              : "";
    const state = S.data.port.source_feed
      ? "Source plan"
      : c.proposalKey
        ? c.proposalStatus
        : c.status;
    const duration = (new Date(c.end) - new Date(c.start)) / 3600000;
    const cargoIcon = /acid|ammonia|soda/i.test(c.product)
      ? "flask-conical"
      : /rock/i.test(c.product)
        ? "mountain"
        : "package";
    const compact =
      w < 40 ? " schedule-marker" : w < 270 ? " schedule-compact" : "";
    output += `<div class="gantt-block ${cls}${compact}${comparison ? " schedule-comparison" : ""}" data-call="${esc(c.id)}" ${c.proposalKey ? `data-proposal="${esc(c.proposalKey)}"` : 'data-published="true"'} role="button" tabindex="0" aria-label="${esc(c.name)} schedule" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Control+ArrowLeft Alt+Control+ArrowRight" style="left:${left}px;width:${Math.max(1, w)}px;height:${height}px;top:${top}px" title="${esc(c.name)}\n${esc(c.product)} · ${fmt(c.quantity)} t · ${esc(c.direction)}\nBerth ${esc(b.code)} · ${esc(state)}\n${P().date(c.start)} → ${P().date(c.end)}\nDuration ${fmt(duration, 1)} h${S.data.port.source_feed ? "" : ` · Progress ${c.progress}%`}"><div class="schedule-content"><div class="schedule-heading"><span class="schedule-vessel-icon">${icon("ship")}</span><strong>${esc(c.name)}</strong><span class="schedule-state">${esc(state)}</span></div><div class="schedule-cargo"><span>${icon(cargoIcon)}${esc(c.product)}</span><span class="schedule-quantity">${fmt(c.quantity / 1000, 1)} kt</span><span class="schedule-direction">${icon(c.direction === "Import" ? "arrow-down-left" : "arrow-up-right")}${esc(c.direction)}</span></div><div class="schedule-timing"><span class="schedule-window">${icon("clock-3")}${P().date(c.start)}<span class="schedule-arrow">→</span>${P().date(c.end)}</span><span class="schedule-duration">${icon("hourglass")}${fmt(duration, duration % 1 ? 1 : 0)} h</span><span class="schedule-progress" ${S.data.port.source_feed ? "hidden" : ""}><span class="schedule-progress-track"><i style="width:${c.progress}%"></i></span><b>${c.progress}%</b></span></div></div><span class="resize-handle resize-start" data-resize="start" aria-label="Drag to resize start">⋮</span><span class="resize-handle resize-end" data-resize="end" aria-label="Drag to resize completion">⋮</span></div>`;
  }
  return output;
}
export function proposalConnectorPath(a, b, origin) {
  const rightward = a.right <= b.left;
  const downward = a.bottom <= b.top;
  const horizontalGap = Math.max(b.left - a.right, a.left - b.right);
  const verticalGap = Math.max(b.top - a.bottom, a.top - b.bottom);
  const point = (x, y) => `${x - origin.left} ${y - origin.top}`;
  const meet = (aStart, aEnd, bStart, bEnd) => {
    const middle = (Math.max(aStart, bStart) + Math.min(aEnd, bEnd)) / 2;
    const inset = Math.min(12, (aEnd - aStart) / 2);
    return Math.max(aStart + inset, Math.min(middle, aEnd - inset));
  };
  if (horizontalGap >= 8 && horizontalGap >= verticalGap) {
    const x1 = rightward ? a.right : a.left;
    const x2 = rightward ? b.left : b.right;
    const y1 = meet(a.top, a.bottom, b.top, b.bottom);
    const y2 = meet(b.top, b.bottom, a.top, a.bottom);
    const middle = (x1 + x2) / 2;
    return `M ${point(x1, y1)} C ${point(middle, y1)} ${point(middle, y2)} ${point(x2, y2)}`;
  }
  if (verticalGap > 0) {
    const x1 = (a.left + a.right) / 2;
    const x2 = (b.left + b.right) / 2;
    const y1 = downward ? a.bottom : a.top;
    const y2 = downward ? b.top : b.bottom;
    if (x1 === x2) return `M ${point(x1, y1)} L ${point(x2, y2)}`;
    const middle = (y1 + y2) / 2;
    const radius = Math.min(5, verticalGap / 4, Math.abs(x2 - x1) / 2);
    const dx = Math.sign(x2 - x1) * radius;
    const dy = Math.sign(y2 - y1) * radius;
    return `M ${point(x1, y1)} L ${point(x1, middle - dy)} Q ${point(x1, middle)} ${point(x1 + dx, middle)} L ${point(x2 - dx, middle)} Q ${point(x2, middle)} ${point(x2, middle + dy)} L ${point(x2, y2)}`;
  }
  // Leave room for the arrowhead when two cards nearly touch side to side.
  const x1 = meet(a.left, a.right, b.left, b.right);
  const x2 = meet(b.left, b.right, a.left, a.right);
  const above = Math.min(a.top, b.top) - 12;
  return `M ${point(x1, a.top)} C ${point(x1, above)} ${point(x2, above)} ${point(x2, b.top)}`;
}
function drawProposalConnections(host) {
  const origin = host.getBoundingClientRect();
  const publishedCards = new Map([...host.querySelectorAll("[data-published]")].map(el => [el.dataset.call, el]));
  const paths = [];
  for (const proposed of host.querySelectorAll("[data-proposal]")) {
    const published = publishedCards.get(proposed.dataset.call);
    if (!published) continue;
    const path = proposalConnectorPath(published.getBoundingClientRect(), proposed.getBoundingClientRect(), origin);
    paths.push(`<path d="${path}" marker-end="url(#proposal-arrowhead)"/>`);
  }
  if (!paths.length) return;
  host.insertAdjacentHTML("beforeend", `<svg class="proposal-connections" width="${host.offsetWidth}" height="${host.offsetHeight}" aria-hidden="true"><defs><marker id="proposal-arrowhead" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8655d1" stroke="none"/></marker></defs><g fill="none" stroke="#8655d1" stroke-width="2" stroke-dasharray="5 4">${paths.join("")}</g></svg>`);
}
function ganttAnnounce(message) {
  let region = document.getElementById("gantt-live-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "gantt-live-region";
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = "";
  requestAnimationFrame(() => { if (region.isConnected) region.textContent = message; });
}
// Keyboard parity for pointer drag/resize. Alt+arrows move; add Shift to resize
// the start, or Control to resize the completion. Enter/Space still opens details.
function keyboardAdjustSchedule(e, el) {
  const { S, $$, toast } = P();
  const id = el.dataset.call;
  const isPending = el.dataset.proposal?.startsWith("pending-");
  const current = structuredClone(
    isPending
      ? S.pending?.[id] || S.data.calls.find((x) => x.id === id)
      : S.data.calls.find((x) => x.id === id),
  );
  if (!current) return;
  e.preventDefault();
  e.stopPropagation();
  const snapMs = ((S.data.port.rules.snap_minutes || 15) / 60) * 3600000;
  const next = { ...current };
  const resizeStart = e.shiftKey;
  const resizeEnd = e.ctrlKey || e.metaKey;
  let message = "";
  if (resizeStart || resizeEnd) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const dir = e.key === "ArrowLeft" ? -1 : 1;
    if (resizeStart) {
      const proposed = new Date(new Date(current.start).getTime() + dir * snapMs);
      if (proposed >= new Date(current.end))
        return ganttAnnounce("Start cannot reach or pass the completion time.");
      next.start = proposed.toISOString();
      message = `Start moved ${dir < 0 ? "earlier" : "later"} to ${P().date(next.start)}.`;
    } else {
      const proposed = new Date(new Date(current.end).getTime() + dir * snapMs);
      if (proposed <= new Date(current.start))
        return ganttAnnounce("Completion cannot reach or pass the start time.");
      next.end = proposed.toISOString();
      message = `Completion moved ${dir < 0 ? "earlier" : "later"} to ${P().date(next.end)}.`;
    }
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const rows = [...$$(".gantt-row")];
    const index = rows.findIndex((r) => r.dataset.row === current.berth_id);
    const target = rows[index + (e.key === "ArrowUp" ? -1 : 1)];
    if (!target) return ganttAnnounce("No adjacent berth in that direction.");
    next.berth_id = target.dataset.row;
    const eq = S.data.equipment.find(
      (eq) => eq.berths.includes(next.berth_id) && eq.status === "Available",
    );
    next.equipment_id = eq?.id || "";
    message = `Moved to berth ${target.dataset.row}.`;
  } else {
    const dir = e.key === "ArrowLeft" ? -1 : 1;
    next.start = new Date(new Date(current.start).getTime() + dir * snapMs).toISOString();
    next.end = new Date(new Date(current.end).getTime() + dir * snapMs).toISOString();
    message = `Schedule moved ${dir < 0 ? "earlier" : "later"} to ${P().date(next.start)}.`;
  }
  next.duration_hours = (new Date(next.end) - new Date(next.start)) / 3600000;
  Object.assign(next, shiftForecastForEarlierStart(current, next));
  S.undo.push(structuredClone(S.pending || {}));
  S.redo = [];
  S.pending = { ...S.pending, [id]: next };
  toast("Change staged locally. Save a draft to validate and request approval.");
  P().renderApp();
  ganttAnnounce(message);
  requestAnimationFrame(() => {
    const focused = P().$$(".gantt-block").find((b) => b.dataset.call === id);
    if (focused) {
      focused.focus({ preventScroll: true });
      focused.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}
function drag(e, el) {
  if (e.button !== 0) return;
  const { S, $, $$, toast } = P();
  const id = el.dataset.call;
  const isPendingCard = el.dataset.proposal?.startsWith("pending-");
  const current = structuredClone(
    isPendingCard
      ? S.pending?.[id] || S.data.calls.find((x) => x.id === id)
      : S.data.calls.find((x) => x.id === id),
  );
  const startX = e.clientX,
    startY = e.clientY,
    originalLeft = parseFloat(el.style.left),
    originalWidth = parseFloat(el.style.width);
  const resize = e.target.closest("[data-resize]")?.dataset.resize;
  let moved = false;
  el.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (
      Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5 &&
      !moved
    )
      return;
    moved = true;
    el.dataset.dragged = "1";
    el.style.zIndex = 100;
    el.style.opacity = ".8";
    if (resize === "start") {
      el.style.left = originalLeft + ev.clientX - startX + "px";
      el.style.width = Math.max(12, originalWidth - ev.clientX + startX) + "px";
    } else if (resize)
      el.style.width = Math.max(12, originalWidth + ev.clientX - startX) + "px";
    else {
      el.style.left = originalLeft + (ev.clientX - startX) + "px";
      el.style.transform = `translateY(${ev.clientY - startY}px)`;
    }
  };
  const up = (ev) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    if (!moved) return;
    const snap = (S.data.port.rules.snap_minutes || 15) / 60;
    const delta =
      Math.round((ev.clientX - startX) / S.timeline.scale / snap) * snap;
    const next = { ...current };
    if (resize === "start")
      next.start = new Date(
        Math.min(
          new Date(current.end).getTime() - 900000,
          new Date(current.start).getTime() + delta * 3600000,
        ),
      ).toISOString();
    else if (resize)
      next.end = new Date(
        Math.max(
          new Date(current.start).getTime() + 900000,
          new Date(current.end).getTime() + delta * 3600000,
        ),
      ).toISOString();
    else {
      next.start = new Date(
        new Date(current.start).getTime() + delta * 3600000,
      ).toISOString();
      next.end = new Date(
        new Date(current.end).getTime() + delta * 3600000,
      ).toISOString();
      const row = $$(".gantt-row").find((r) => {
        const rect = r.getBoundingClientRect();
        return ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      });
      if (row) next.berth_id = row.dataset.row;
      if (next.berth_id !== current.berth_id) {
        const eq = S.data.equipment.find(
          (eq) =>
            eq.berths.includes(next.berth_id) && eq.status === "Available",
        );
        next.equipment_id = eq?.id || "";
      }
    }
    next.duration_hours = (new Date(next.end) - new Date(next.start)) / 3600000;
    Object.assign(next, shiftForecastForEarlierStart(current, next));
    S.undo.push(structuredClone(S.pending || {}));
    S.redo = [];
    S.pending = { ...S.pending, [id]: next };
    P().renderApp();
    toast(
      "Change staged locally. Save a draft to validate and request approval.",
    );
  };
  const cancel = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    gantt();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
}
export function bindPlanning() {
  const {
    S,
    $,
    $$,
    renderApp,
    toast,
    icons,
    modal,
    handleForm,
    api,
    path,
    refresh,
    closeModal,
  } = P();
  gantt();
  const wrap = $("#gantt-wrap");
  wrap.addEventListener("scroll", () => {
    S.ganttView.leftTime =
      S.timeline.start + (wrap.scrollLeft / S.timeline.scale) * 3600000;
    S.ganttView.top = wrap.scrollTop;
    fitScheduleCards();
    updateVisibleRange();
  });
  // Keep native scrollbar and vessel interactions independent of empty-space panning.
  wrap.addEventListener("pointerdown", (e) => {
    if (
      e.button !== 0 ||
      !e.target.closest(".gantt-row, .gantt-time-head") ||
      e.target.closest(".gantt-block")
    )
      return;
    const origin = {
      x: e.clientX,
      y: e.clientY,
      left: wrap.scrollLeft,
      top: wrap.scrollTop,
    };
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add("panning");
    const move = (event) => {
      wrap.scrollLeft = origin.left - (event.clientX - origin.x);
      wrap.scrollTop = origin.top - (event.clientY - origin.y);
    };
    const end = () => {
      wrap.classList.remove("panning");
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", end);
      wrap.removeEventListener("pointercancel", end);
      wrap.removeEventListener("lostpointercapture", end);
    };
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
    wrap.addEventListener("lostpointercapture", end);
  });
  $("#planning-search").oninput = (e) => {
    S.search = e.target.value;
    gantt();
  };
  $("#planning-status").onchange = (e) => {
    S.planStatus = e.target.value;
    gantt();
  };
  $("#planning-cargo").onchange = (e) => {
    S.planCargo = e.target.value;
    gantt();
  };
  const focusDate = () => {
    const left =
      S.timeline.start + (wrap.scrollLeft / S.timeline.scale) * 3600000;
    const right =
      left +
      ((wrap.clientWidth - S.timeline.label) / S.timeline.scale) * 3600000;
    const selected = new Date(
      S.date ||
        S.data.port.demo_clock ||
        S.data.port.source_feed?.reference_time ||
        Date.now(),
    );
    const tolerance = 3600000 / S.timeline.scale;
    return +selected >= left - tolerance && +selected < right + tolerance
      ? selected
      : new Date((left + right) / 2);
  };
  $$("[data-scale]").forEach(
    (button) =>
      (button.onclick = () => {
        S.date = focusDate();
        S.timelineScale = button.dataset.scale;
        S.ganttView = null;
        localStorage.setItem("portside-gantt-scale", S.timelineScale);
        renderApp();
      }),
  );
  $("#plan-date").onchange = (e) => {
    if (!e.target.value) return;
    S.date = new Date(e.target.value + "T00:00:00");
    renderApp();
  };
  $("#plan-today").onclick = () => {
    S.date = S.data.port.demo_clock
      ? new Date(S.data.port.demo_clock)
      : S.data.port.source_feed
        ? new Date(S.data.port.source_feed.report_date + "T00:00:00")
        : null;
    S.ganttView = null;
    renderApp();
  };
  for (const [id, amount] of [
    ["plan-prev", -1],
    ["plan-next", 1],
  ])
    $("#" + id).onclick = () => {
      S.date = shiftAnchor(
        focusDate(),
        S.timelineScale || "week",
        amount,
        S.data.port.timezone,
      );
      S.ganttView = null;
      renderApp();
    };
  $("#plan-fullscreen").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $("#gantt-wrap").parentElement.requestFullscreen();
  };
  $("#plan-undo").onclick = () => {
    if (!S.undo.length) return;
    S.redo.push(structuredClone(S.pending || {}));
    S.pending = S.undo.pop();
    renderApp();
  };
  $("#plan-redo").onclick = () => {
    if (!S.redo.length) return;
    S.undo.push(structuredClone(S.pending || {}));
    S.pending = S.redo.pop();
    renderApp();
  };
  if ($("#discard-pending"))
    $("#discard-pending").onclick = () => {
      S.undo.push(structuredClone(S.pending));
      S.pending = {};
      renderApp();
    };
  if ($("#save-pending"))
    $("#save-pending").onclick = () => {
      const blocked = Object.keys(S.pending).find((id) => activeDraftFor(id));
      if (blocked) {
        const existing = activeDraftFor(blocked);
        P().toast(
          `This vessel call already has an active workflow (#${existing.id.slice(0, 8).toUpperCase()} · ${existing.status}). Approve, reject or delete it first.`,
          true,
        );
        return;
      }
      modal(
        "Save staged schedule drafts",
        `<form id="pending-form"><div class="notice">${P().icon("git-pull-request")}Each staged change is validated and saved as an isolated draft. The published plan remains in effect.</div>${P().textArea("Reason for the changes", "reason", "", 'required minlength="5" placeholder="Explain the operational reason…"')}<div class="form-actions"><button type="submit" class="btn primary">Save drafts</button></div></form>`,
      );
      handleForm("#pending-form", async (d) => {
        let saved = 0;
        for (const [id, next] of Object.entries(S.pending)) {
          const original = S.data.calls.find((x) => x.id === id);
          await api(path("/planning/drafts"), "POST", {
            call_id: id,
            base_revision: original.revision,
            reason: d.reason,
            changes: next,
          });
          delete S.pending[id];
          saved++;
        }
        S.undo = [];
        S.redo = [];
        closeModal();
        await refresh();
        toast(`${saved} drafts saved. Submit them from Workflow center.`);
      });
    };
  if ($("#go-approvals"))
    $("#go-approvals").onclick = () => {
      S.tab = "approvals";
      P().nav("center");
    };
}
export function vesselForm() {
  const {
    S,
    field,
    select,
    textArea,
    modal,
    icon,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
    iso,
  } = P();
  modal(
    "Nominate a vessel call",
    `<form id="vessel-form"><p class="config-description">Create a port call for coordination and berth allocation. Times are entered in your browser's local timezone.</p><div class="form-grid">${field("Vessel name", "name", "", "text", 'required placeholder="MV Atlantic Spirit"')}${field("IMO number", "imo", "", "text", 'pattern="[0-9]{7}" placeholder="7 digits"')}${field("MMSI", "mmsi", "", "text", 'pattern="[0-9]{9}" placeholder="9 digits"')}${cargoFields({}, true)}${field("Cargo quantity, t", "quantity", "", "number", 'min="1" required')}${field("Length overall, m", "loa", "", "number", 'min="1" required step="0.1"')}${field("Vessel draft, m", "draft", "", "number", 'min="0.1" step="0.1" required')}${select("Assigned berth", "berth_id", [["", "Select a berth"], ...S.data.berths.map((b) => [b.id, b.code + " · " + b.name])], "", "required")}${select("Required equipment", "equipment_id", [["", "Select equipment"], ...S.data.equipment.map((e) => [e.id, e.name])])}${field("ETA", "eta", "", "datetime-local", "required")}${timingFields({}, true)}${select(
      "Priority",
      "priority",
      [
        ["", "Select priority"],
        [1, "Routine"],
        [2, "Standard"],
        [3, "High"],
      ],
      "",
      "required",
    )}<div class="field full"><label class="check-row"><input type="checkbox" name="ready"> Cargo availability confirmed</label><small>An unconfirmed nomination can be saved. Cargo readiness is required before a schedule proposal can be published.</small></div></div><div class="form-actions"><button class="btn primary" type="submit">${icon("plus")}Create vessel call</button></div></form>`,
  );
  bindCargoFields(P().$("#vessel-form"), {}, true);
  bindTiming(P().$("#vessel-form"));
  handleForm("#vessel-form", async (d) => {
    d.duration_hours = Number(d.duration_hours);
    for (const k of ["quantity", "loa", "draft", "priority"])
      d[k] = Number(d[k]);
    for (const k of ["eta", "start", "end"]) d[k] = iso(d[k]);
    d.ready = d.ready === "on";
    d.progress = 0;
    d.rate = 1800;
    d.status = "Scheduled";
    await api(path("/calls"), "POST", d);
    closeModal();
    await refresh();
    toast("Vessel nomination saved. It is now available in berth planning.");
  });
}
export function proposalForm(call, initial = {}) {
  const {
    S,
    modal,
    field,
    select,
    textArea,
    icon,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
    inputDate,
    iso,
  } = P();
  const c = { ...call, ...initial };
  modal(
    "Propose a schedule change",
    `<form id="proposal-form"><div class="notice">${icon("git-pull-request")}A proposal is saved separately. Mandatory safety checks and the configured departmental approval route apply before publication.</div><h3 style="margin-bottom:18px">${P().esc(call.name)}</h3><div class="form-grid">${select(
      "Proposed berth",
      "berth_id",
      S.data.berths.map((b) => [b.id, b.code + " · " + b.name]),
      c.berth_id,
    )}${select(
      "Required equipment",
      "equipment_id",
      S.data.equipment.map((e) => [e.id, e.name]),
      c.equipment_id,
    )}${cargoFields(c)}${timingFields(c)}${field("Arrival forecast, ETA", "eta", inputDate(c.eta), "datetime-local", "required")}${c.ready_at ? `<input type="hidden" name="ready_at" value="${P().esc(c.ready_at)}">` : ""}${field("Cargo quantity, t", "quantity", c.quantity, "number", 'min="1" required')}${textArea("Modification reason", "reason", "", 'required minlength="5" placeholder="Why does this allocation need to change?"')}</div><div id="proposal-validation"></div><div class="form-actions"><button type="button" id="validate-proposal" class="btn">${icon("shield-check")}Check constraints</button><button type="submit" class="btn primary">${icon("save")}Save isolated draft</button></div></form>`,
  );
  const form = P().$("#proposal-form");
  bindCargoFields(form, c);
  bindTiming(form);
  const leadHours = (from, to) =>
    from && to ? (new Date(to).getTime() - new Date(from).getTime()) / 3600000 : 0;
  const etaLead = leadHours(c.eta, c.start);
  const readyLead = leadHours(c.ready_at, c.start);
  form.elements.start.addEventListener("change", () => {
    if (!form.elements.start.value || call.actual_arrival) return;
    const start = new Date(form.elements.start.value).getTime();
    const eta = form.elements.eta;
    if (eta.value && Number.isFinite(etaLead) && start < new Date(eta.value).getTime())
      eta.value = inputDate(start - etaLead * 3600000);
    const ready = form.elements.ready_at;
    if (ready?.value && Number.isFinite(readyLead) && start < new Date(ready.value).getTime())
      ready.value = inputDate(start - readyLead * 3600000);
  });
  const convert = (d) => ({
    ...d,
    duration_hours: Number(d.duration_hours),
    start: iso(d.start),
    end: iso(d.end),
    eta: iso(d.eta),
    ...(d.ready_at ? { ready_at: iso(d.ready_at) } : {}),
    quantity: Number(d.quantity),
  });
  P().$("#validate-proposal").onclick = async () => {
    try {
      const d = convert(P().formData(P().$("#proposal-form")));
      const result = await api(path("/planning/validate"), "POST", {
        ...call,
        ...d,
      });
      P().$("#proposal-validation").innerHTML =
        `<div class="notice ${result.errors.length ? "error" : "success"}" style="margin-top:16px">${icon(result.errors.length ? "triangle-alert" : "shield-check")}<div>${result.errors.length ? result.errors.map(P().esc).join("<br>") : "All implemented hard constraints pass."}${result.warnings.length ? "<br>" + result.warnings.map(P().esc).join("<br>") : ""}</div></div>`;
      P().icons();
    } catch (e) {
      toast(e.message, true);
    }
  };
  handleForm("#proposal-form", async (d) => {
    const existing = activeDraftFor(call.id);
    if (existing) {
      toast(
        `This vessel call already has an active workflow (#${existing.id.slice(0, 8).toUpperCase()} · ${existing.status}). Approve, reject or delete it first.`,
        true,
      );
      return;
    }
    const draft = await api(path("/planning/drafts"), "POST", {
      call_id: call.id,
      base_revision: call.revision,
      changes: convert(d),
      reason: d.reason,
    });
    closeModal();
    await refresh();
    toast(
      draft.validation.errors.length
        ? "Draft saved with constraint violations. Resolve them before submission."
        : "Draft saved. Submit it from the approval inbox.",
    );
  });
}
export function scenarioForm() {
  const {
    S,
    modal,
    field,
    select,
    icon,
    handleForm,
    api,
    path,
    toast,
    esc,
    fmt,
    date,
    status,
    btn,
  } = P();
  modal(
    "Scenario intelligence",
    `<form id="scenario-form"><div class="notice">${icon("sparkles")}Run an isolated OR-Tools CP-SAT scenario. The solver searches compatible berths and equipment, checks readiness, capacity, safety buffers and overlap. It does not publish changes.</div><div class="form-grid">${field("Scenario name", "name", "Berth availability scenario", "text", "required")}${select("Simulate berth closure", "closed_berth", [["", "No berth closure"], ...S.data.berths.map((b) => [b.id, b.code + " · " + b.name])])}${select("Simulate equipment outage", "outage_equipment", [["", "No equipment outage"], ...S.data.equipment.map((e) => [e.id, e.name])])}${select("Delay a vessel", "call_id", [["", "No vessel delay"], ...S.data.calls.filter((c) => !["Completed", "Cancelled"].includes(c.status)).map((c) => [c.id, c.name])])}${field("Additional arrival delay, h", "delay_hours", 0, "number", 'min="0" step="0.25" required')}${field("Handling rate factor", "rate_factor", 1, "number", 'min="0.1" max="2" step="0.1" required')}</div><div class="form-actions"><button class="btn primary" type="submit">${icon("play")}Run scenario</button></div></form><div id="scenario-output"></div>`,
    true,
  );
  handleForm("#scenario-form", async (d) => {
    d.delay_hours = Number(d.delay_hours);
    d.rate_factor = Number(d.rate_factor);
    const result = await api(path("/scenarios/run"), "POST", d);
    S.scenario = result;
    await P().refresh(false);
    P().$("#scenario-output").innerHTML =
      `<div class="scenario-result"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${esc(result.name)}</h3>${status(result.status)}</div>${result.calls.length ? `<div class="scenario-stats"><div><strong>${fmt(result.added_delay_hours, 1)} h</strong><span>Additional schedule delay</span></div><div><strong>${fmt(result.waiting_hours, 1)} h</strong><span>Total projected waiting</span></div><div><strong>${result.calls.length}</strong><span>Operations scheduled</span></div></div><div class="table-scroll"><table><thead><tr><th scope=\"col\">Vessel</th><th scope=\"col\">Proposed berth</th><th scope=\"col\">Proposed start</th><th scope=\"col\">Completion</th><th scope=\"col\"></th></tr></thead><tbody>${result.calls.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(P().berth(c.berth_id)?.code || "—")}</td><td>${date(c.start)}</td><td>${date(c.end)}</td><td>${P().can("planning.draft") ? `<button class="btn small" data-scenario-propose="${c.id}">Propose</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}${P().can("config.edit") ? `<button class="btn small danger" id="remove-scenario">Remove scenario</button>` : ""}<p class="config-description" style="margin:15px 0 0">${result.reasons.map(esc).join("<br>")}</p><small class="subtle">Scenario · Unpublished</small></div>`;
    document.querySelector("#remove-scenario")?.addEventListener("click", () => confirmRemoval(path(`/scenarios/${result.id}?revision=${result.revision}`), result.name, "This removes the hypothetical scenario. The published plan is unchanged."));
    P()
      .$$("[data-scenario-propose]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            proposalForm(
              S.data.calls.find((c) => c.id === b.dataset.scenarioPropose),
              result.calls.find((c) => c.id === b.dataset.scenarioPropose),
            )),
      );
    P().icons();
    toast("Scenario saved. Published schedule unchanged.");
  });
}
export function historyModal() {
  const { S, modal, esc, date, status, btn, bindRecords } = P();
  modal(
    "Schedule version history",
    `<div class="notice">${P().icon("history")}Each publication preserves a complete call and berth snapshot. Geometry edits do not rewrite historical versions.</div>${
      [...S.data.versions]
        .reverse()
        .map(
          (v) =>
            `<div class="list-card"><div class="list-copy"><h3>${esc(v.label)}</h3><p>${date(v.created_at)} · ${esc(v.author)} · ${v.calls.length} calls · ${v.berths.length} berths</p></div>${status(v.status)}<button class="btn small" data-version="${v.id}">Compare</button></div>`,
        )
        .join("") || P().empty("No published versions")
    }`,
    true,
  );
  P()
    .$$("[data-version]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const v = S.data.versions.find((x) => x.id === b.dataset.version);
          modal(
            "Compare " + v.label,
            `<div class="table-scroll"><table><thead><tr><th scope=\"col\">Vessel</th><th scope=\"col\">Historical berth</th><th scope=\"col\">Current berth</th><th scope=\"col\">Historical start</th><th scope=\"col\">Current start</th><th scope=\"col\">Change</th></tr></thead><tbody>${v.calls
              .map((c) => {
                const cur = S.data.calls.find((x) => x.id === c.id);
                const changed =
                  cur &&
                  (cur.berth_id !== c.berth_id ||
                    cur.start !== c.start ||
                    cur.end !== c.end);
                return `<tr><td>${esc(c.name)}</td><td>${esc(v.berths.find((x) => x.id === c.berth_id)?.code || "—")}</td><td>${esc(P().berth(cur?.berth_id)?.code || "—")}</td><td>${date(c.start)}</td><td>${date(cur?.start)}</td><td>${changed ? status("Changed") : "Unchanged"}</td></tr>`;
              })
              .join("")}</tbody></table></div>`,
            true,
          );
        }),
    );
}

export function fitTimeline() {
  if (document.querySelector("#gantt-wrap")) gantt();
}
