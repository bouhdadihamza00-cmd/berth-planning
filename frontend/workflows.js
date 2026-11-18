import { confirmRemoval } from "./removal.js?v=5";
import { renderReports, bindReports } from "./reporting.js?v=7";
const P = () => window.P;
export function notificationCategory(n) {
  const title = (n.title || "").toLowerCase();
  if (/document setup|document import/.test(title)) return "Document imports";
  if (/^plan change|approval/.test(title)) return "Approvals";
  if (/delay/.test(title)) return "Delays";
  if (/vessel|nomination/.test(title)) return "Vessel calls";
  if (/cargo|readiness/.test(title)) return "Cargo readiness";
  if (/configuration/.test(title)) return "Configuration";
  return "General";
}
function remainingSteps(draft) {
  return (draft.workflow.steps || []).filter((step) => {
    const approved = new Set(
      draft.decisions
        .filter((d) => d.action === "approve" && d.step_id === step.id)
        .map((d) => d.user_id),
    );
    return step.decision === "all"
      ? !step.user_ids.every((id) => approved.has(id))
      : !step.user_ids.some((id) => approved.has(id));
  });
}
function canReviewDraft(draft) {
  const { S, can, membership } = P();
  if (
    !can("approvals.approve") ||
    (draft.workflow.segregation && draft.author_id === S.user.id)
  )
    return false;
  if (draft.workflow.steps?.length) {
    let steps = remainingSteps(draft);
    if (draft.workflow.mode === "sequential") steps = steps.slice(0, 1);
    return steps.some(
      (step) =>
        step.user_ids.includes(S.user.id) &&
        !draft.decisions.some(
          (d) =>
            d.action === "approve" &&
            d.step_id === step.id &&
            d.user_id === S.user.id,
        ),
    );
  }
  const department = membership()?.department || "Administration";
  const approved = draft.decisions
    .filter((d) => d.action === "approve")
    .map((d) => d.department);
  const remaining = (draft.workflow.departments || []).filter(
    (d) => !approved.includes(d),
  );
  return (
    draft.workflow.mode === "sequential" ? remaining.slice(0, 1) : remaining
  ).includes(department);
}
function approvalProgress(draft) {
  if (!draft.workflow.steps?.length) return "";
  const pending = remainingSteps(draft);
  return `<small class="ticket-meta">${draft.workflow.steps.length - pending.length}/${draft.workflow.steps.length} steps complete${draft.status === "Submitted" && pending.length ? ` · ${P().esc(pending[0].name)}` : ""}</small>`;
}
export function renderCenter() {
  const { S, pageHeading, btn, icon, esc, date, status, fmt, empty, cardHead } =
    P();
  const tabs = [
    ["alerts", "triangle-alert", "Alerts", S.data.stats.open_alerts],
    [
      "notifications",
      "bell",
      "Notifications",
      S.data.notifications.filter((n) => !n.read_by.includes(S.user.id)).length,
    ],
    [
      "approvals",
      "git-pull-request",
      "Approvals",
      S.data.drafts.filter((d) => d.status === "Submitted").length,
    ],
    ["reports", "file-chart-column", "Reports", ""],
  ];
  let content = "";
  if (S.tab === "alerts") {
    const alerts = S.data.alerts.filter(
      (a) => !S.alertFilter || a.status === S.alertFilter,
    );
    content = `<section class="card workflow-alerts">${cardHead("Operational alerts", "triangle-alert", "Exceptions requiring attention")}<div class="toolbar"><div class="search-box">${icon("search")}<input id="alert-search" placeholder="Search alerts…" aria-label="Search alerts" value="${esc(S.alertSearch || "")}"></div><select id="alert-filter" aria-label="Alert status">${[
      ["", "All statuses"],
      ["Open", "Open"],
      ["Acknowledged", "Acknowledged"],
      ["Resolved", "Resolved"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${v === S.alertFilter ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select><div class="spacer"></div><span class="subtle" style="font-size:calc(10px * var(--ui-font-scale, 1))">${alerts.length} alerts in this port</span></div><div class="table-scroll"><table><thead><tr><th>Alert</th><th>Severity</th><th>Vessel</th><th>Department</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
      alerts
        .filter(
          (a) =>
            !S.alertSearch ||
            `${a.title} ${a.description}`
              .toLowerCase()
              .includes(S.alertSearch.toLowerCase()),
        )
        .map(
          (a) =>
            `<tr class="clickable" data-alert="${a.id}"><td><div class="vessel-cell">${esc(a.title)}</div><small class="subtle" style="display:block;margin-top:5px;max-width:350px;overflow:hidden;text-overflow:ellipsis">${esc(a.description)}</small></td><td>${status(a.severity)}</td><td>${esc(S.data.calls.find((c) => c.id === a.call_id)?.name || "Port-wide")}</td><td>${esc(a.department || "Operations")}</td><td>${date(a.created_at)}</td><td>${status(a.status)}</td><td>${P().can("config.edit") ? `<button class="btn small danger" data-remove-record="${a.id}" data-remove-kind="alerts">Remove</button>` : ""}</td></tr>`,
        )
        .join("") ||
      `<tr><td colspan="7">${empty("No alerts to display", "Your current filters have no matching alerts.", "circle-check")}</td></tr>`
    }</tbody></table></div></section>`;
  }
  if (S.tab === "notifications") {
    const categories = [
      "Approvals",
      "Delays",
      "Vessel calls",
      "Cargo readiness",
      "Configuration",
      "Document imports",
      "General",
    ];
    const notifications = [...S.data.notifications].reverse().filter((n) => {
      const unread = !n.read_by.includes(S.user.id);
      return (
        (!S.notificationCategory ||
          notificationCategory(n) === S.notificationCategory) &&
        (!S.notificationRead ||
          (S.notificationRead === "unread" ? unread : !unread)) &&
        (!S.notificationSearch ||
          `${n.title} ${n.description}`
            .toLowerCase()
            .includes(S.notificationSearch.toLowerCase()))
      );
    });
    content = `<section class="card notifications-card">${cardHead("Workspace notifications", "bell", "Mark all as read", "mark-read")}<div class="toolbar notification-filters"><div class="search-box">${icon("search")}<input type="search" id="notification-search" placeholder="Search notifications…" aria-label="Search notifications" value="${esc(S.notificationSearch || "")}"></div><select id="notification-category" aria-label="Notification category"><option value="">All categories (${S.data.notifications.length})</option>${categories.map((category) => `<option value="${category}" ${S.notificationCategory === category ? "selected" : ""}>${category} (${S.data.notifications.filter((n) => notificationCategory(n) === category).length})</option>`).join("")}</select><select id="notification-read" aria-label="Notification read status">${[
      ["", "All notifications"],
      ["unread", "Unread"],
      ["read", "Read"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${(S.notificationRead || "") === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select><button class="btn small" id="notification-reset">Reset</button><span class="subtle">${notifications.length} of ${S.data.notifications.length}</span></div><div class="notification-category-key" aria-label="Notification category colors">${categories.map((category) => `<span class="notification-category-label" data-category="${category}">${category}</span>`).join("")}</div><div id="notification-list">${notifications.map((n) => `<div class="list-card notification-item ${n.read_by.includes(S.user.id) ? "is-read" : "is-unread"}" role="button" tabindex="0" data-notification="${esc(n.id)}" aria-label="${esc(n.title)}"><span class="port-symbol">${icon(n.read_by.includes(S.user.id) ? "mail-open" : "mail")}</span><div class="list-copy"><h3>${esc(n.title)} ${!n.read_by.includes(S.user.id) ? '<span class="badge-count">Unread</span>' : ""}</h3><span class="notification-category-label" data-category="${esc(notificationCategory(n))}">${esc(notificationCategory(n))}</span><p>${esc(n.description)}</p></div><small class="subtle">${date(n.created_at)}<br><button class="btn small" data-dismiss-notification="${esc(n.id)}">Remove</button></small></div>`).join("") || empty(S.data.notifications.length ? "No matching notifications" : "No notifications yet", S.data.notifications.length ? "Adjust the category, read status or search filters." : "")}</div></section>`;
  }
  if (S.tab === "approvals") {
    const tickets = [...S.data.drafts]
      .sort(
        (a, b) =>
          (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) ||
          String(b.id).localeCompare(String(a.id)),
      )
      .filter(
        (d) =>
          (!S.approvalStatus || d.status === S.approvalStatus) &&
          (!S.approvalSearch ||
            `${d.id} ${d.proposed?.name || d.before?.name} ${d.author} ${d.reason}`
              .toLowerCase()
              .includes(S.approvalSearch.toLowerCase())),
      );
    content = `<div class="notice">${icon("shield-check")}Approval route: ${(S.data.port.workflow.steps?.map((x) => x.name) || S.data.port.workflow.departments).map(esc).join(" → ") || "No reviewers configured"} · ${esc(S.data.port.workflow.mode || "parallel")} review. ${S.data.port.workflow.segregation ? "Authors cannot approve their own changes." : ""}</div><section class="card approval-tickets">${cardHead("Approval tickets", "git-pull-request", "Newest first")}<div class="toolbar"><div class="search-box">${icon("search")}<input type="search" id="approval-search" placeholder="Search ticket, vessel, requester…" aria-label="Search approval tickets" value="${esc(S.approvalSearch || "")}"></div><select id="approval-status" aria-label="Approval ticket status"><option value="">All statuses</option>${["Draft", "Submitted", "Clarification requested", "Approved", "Published", "Rejected", "Cancelled"].map((value) => `<option ${S.approvalStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select><span class="subtle">${tickets.length} tickets · Newest first</span></div><div class="table-scroll"><table><thead><tr><th>Ticket / request</th><th>Status</th><th>Requester / created</th><th>Schedule change</th><th>Validation</th><th>Actions</th></tr></thead><tbody>${tickets.map((d) => `<tr data-ticket="${esc(d.id)}"><td><button class="ticket-reference" data-draft-detail="${esc(d.id)}" title="${esc(d.id)}">#${esc(d.id.slice(0, 8).toUpperCase())}</button><strong class="ticket-vessel">${esc(d.proposed?.name || d.before?.name || "New nomination")}</strong><span class="ticket-reason">${esc(d.reason)}</span></td><td>${status(d.status)}${approvalProgress(d)}</td><td><strong>${esc(d.author)}</strong><small class="ticket-meta">${date(d.created_at)}</small></td><td><div class="ticket-schedule"><span class="ticket-meta">${d.operation === "create" ? "New nomination" : `Published · ${esc(P().berth(d.before.berth_id)?.code || "—")}`}</span><span>${date(d.before.start)} → ${date(d.before.end)}</span><span class="ticket-proposed">Proposed · ${esc(P().berth(d.proposed.berth_id)?.code || "—")}</span><span>${date(d.proposed.start)} → ${date(d.proposed.end)}</span></div></td><td>${d.validation.errors.length ? `<span class="ticket-validation-error">${d.validation.errors.length} issue${d.validation.errors.length === 1 ? "" : "s"}</span><small class="ticket-meta">${d.validation.errors.map(esc).join("<br>")}</small>` : `<span class="ticket-validation-clear">${icon("shield-check")}Clear</span>`}</td><td><div class="approval-actions">${["Draft", "Clarification requested"].includes(d.status) && P().can("planning.submit") ? `<button class="btn small primary" data-draft-action="submit" data-id="${d.id}">Submit for approval</button>` : ""}${d.status === "Submitted" && canReviewDraft(d) ? `<button class="btn small primary" data-draft-action="approve" data-id="${d.id}">Approve</button><button class="btn small danger" data-draft-action="reject" data-id="${d.id}">Reject</button><button class="btn small" data-draft-action="clarify" data-id="${d.id}">Request clarification</button>` : ""}${d.status === "Approved" && P().can("planning.publish") ? `<button class="btn small primary" data-draft-action="publish" data-id="${d.id}">${icon("upload")}Publish approved change</button>` : ""}<button class="btn small" data-draft-detail="${d.id}">Review details</button>${d.author_id === S.user.id || S.user.superadmin ? `${["Draft", "Submitted", "Clarification requested", "Approved"].includes(d.status) ? `<button class="btn small" data-draft-action="terminate" data-id="${d.id}">${icon("circle-stop")}Terminate</button>` : ""}<button class="btn small danger" data-draft-action="delete" data-id="${d.id}">${icon("trash-2")}Delete</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6">${empty("No approval tickets", "Adjust your filters or save a proposal from Berth planning.")}</td></tr>`}</tbody></table></div></section>`;
  }
  if (S.tab === "reports") content = renderReports();
  return (
    pageHeading(
      "Workflow center",
      "Operational alerts, schedule approvals and reports.",
      `${P().can("delays.create") ? btn("Declare operational delay", "plus", "delay", "primary") : ""}`,
    ) +
    `<div class="section-tabs workflow-tabs" role="group" aria-label="Workflow sections">${tabs.map(([id, ic, title, count]) => `<button class="${S.tab === id ? "active" : ""}" aria-pressed="${S.tab === id}" data-center-tab="${id}"><span class="workflow-tab-icon">${icon(ic)}</span><span class="workflow-tab-copy"><strong>${title}</strong><small>${{alerts:"Operational exceptions",notifications:"Updates & activity",approvals:"Review & publish",reports:"Insights & exports"}[id]}</small></span>${count !== "" ? `<span class="workflow-tab-count">${count}</span>` : ""}</button>`).join("")}</div>` +
    content
  );
}
export function bindCenter() {
  document.querySelectorAll("[data-dismiss-notification]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const n = P().S.data.notifications.find(n => n.id === b.dataset.dismissNotification);
    confirmRemoval(P().path(`/notifications/${n.id}/inbox`), n.title, "This removes the notification from your inbox only.");
  });
  const {
    S,
    $,
    $$,
    renderApp,
    api,
    path,
    refresh,
    toast,
    modal,
    handleForm,
    closeModal,
    icon,
    esc,
    status,
    date,
  } = P();
  $$("[data-center-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        S.tab = b.dataset.centerTab;
        renderApp();
      }),
  );
  if ($("#alert-filter"))
    $("#alert-filter").onchange = (e) => {
      S.alertFilter = e.target.value;
      renderApp();
    };
  if ($("#alert-search"))
    $("#alert-search").oninput = (e) => {
      S.alertSearch = e.target.value;
      const pos = e.target.selectionStart;
      renderApp();
      $("#alert-search").focus();
      $("#alert-search").setSelectionRange(pos, pos);
    };
  if ($("#approval-status"))
    $("#approval-status").onchange = (e) => {
      S.approvalStatus = e.target.value;
      renderApp();
    };
  if ($("#approval-search"))
    $("#approval-search").oninput = (e) => {
      S.approvalSearch = e.target.value;
      renderApp();
      $("#approval-search").focus();
    };
  for (const [id, key] of [
    ["notification-category", "notificationCategory"],
    ["notification-read", "notificationRead"],
  ]) {
    if ($(`#${id}`))
      $(`#${id}`).onchange = (e) => {
        S[key] = e.target.value;
        renderApp();
      };
  }
  if ($("#notification-search"))
    $("#notification-search").oninput = (e) => {
      S.notificationSearch = e.target.value;
      renderApp();
      $("#notification-search").focus();
    };
  $$("[data-notification]").forEach(item => {
    const open = async () => {
      const n=S.data.notifications.find(n=>n.id===item.dataset.notification);
      if (!n) return;
      try {
        const updated=await api(path(`/notifications/${n.id}/read`),"POST",{});
        Object.assign(n,updated);
        renderApp();
        const call=S.data.calls.find(c=>c.id===n.entity);
        const draft=S.data.drafts.find(d=>d.id===n.entity);
        const alert=S.data.alerts.find(a=>a.id===n.entity);
        modal(n.title, `<div class="notice">${icon("bell")}${esc(notificationCategory(n))} · ${date(n.created_at)}</div><p class="notification-full-description">${esc(n.description)}</p>${call ? `<dl class="detail-grid"><div><dt>Vessel</dt><dd>${esc(call.name)}</dd></div><div><dt>Status</dt><dd>${esc(call.status)}</dd></div><div><dt>Berth</dt><dd>${esc(P().berth(call.berth_id)?.name || "Unassigned")}</dd></div></dl>` : draft ? `<dl class="detail-grid"><div><dt>Workflow</dt><dd>#${esc(draft.id.slice(0,8).toUpperCase())}</dd></div><div><dt>Status</dt><dd>${esc(draft.status)}</dd></div><div><dt>Requester</dt><dd>${esc(draft.author)}</dd></div></dl>` : ""}${call || draft || alert ? '<div class="form-actions"><button class="btn primary" id="notification-open-related">Open related details</button></div>' : n.entity ? '<p class="subtle">The linked record may have been removed or is unavailable in this view.</p>' : ""}`);
        if ($("#notification-open-related")) $("#notification-open-related").onclick=()=> {
          if(call) P().vesselModal(call.id);
          else if(alert) alertModal(alert.id);
          else {closeModal();S.tab="approvals";renderApp();document.querySelector(`[data-draft-detail="${draft.id}"]`)?.click();}
        };
      } catch(error) {toast(error.message,true);}
    };
    item.onclick=open;

  });
  if ($("#notification-reset"))
    $("#notification-reset").onclick = () => {
      S.notificationCategory = "";
      S.notificationRead = "";
      S.notificationSearch = "";
      renderApp();
    };
  if ($("[data-action=mark-read]"))
    $("[data-action=mark-read]").onclick = async () => {
      await api(path("/notifications/read"), "POST", {});
      await refresh();
      toast("Notifications marked as read");
    };
  $$("[data-draft-action]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = S.data.drafts.find((x) => x.id === b.dataset.id);
        const action = b.dataset.draftAction;
        if (["terminate", "delete"].includes(action)) {
          const deleting=action === "delete";
          modal(deleting ? "Delete workflow" : "Terminate workflow", `<form id="workflow-remove-form"><p class="config-description">${deleting ? "Remove this workflow from the approval list? Its audit history and any published vessel changes remain saved." : "Stop this workflow and cancel its pending approvals? The current published plan remains unchanged."}</p><div class="notice">#${esc(d.id.slice(0,8).toUpperCase())} · ${esc(d.proposed?.name || d.before?.name)} · ${esc(d.status)}</div><div class="form-actions"><button type="submit" class="btn danger">${deleting ? "Delete workflow" : "Terminate workflow"}</button></div></form>`);
          handleForm("#workflow-remove-form", async () => {
            if (deleting) await api(path(`/planning/drafts/${d.id}?revision=${d.revision}`), "DELETE");
            else await api(path(`/planning/drafts/${d.id}/terminate`), "POST", {revision:d.revision});
            closeModal();
            await refresh();
            toast(deleting ? "Workflow deleted" : "Workflow terminated");
          });
          return;
        }
        let steps = (d.workflow.steps || []).filter((step) => {
          const approvals = d.decisions
            .filter((x) => x.action === "approve" && x.step_id === step.id)
            .map((x) => x.user_id);
          return step.decision === "all"
            ? !step.user_ids.every((id) => approvals.includes(id))
            : !step.user_ids.some((id) => approvals.includes(id));
        });
        if (d.workflow.mode === "sequential") steps = steps.slice(0, 1);
        steps = steps.filter((step) => step.user_ids.includes(S.user.id));
        modal(
          action === "publish"
            ? "Publish approved change"
            : `${action[0].toUpperCase() + action.slice(1)} schedule proposal`,
          `<form id="decision-form"><div class="notice">${icon("git-pull-request")}${esc(d.before.name)} · ${esc(d.reason)}</div>${action === "publish" ? `<p class="config-description">The server will recheck all constraints and the vessel revision, then preserve a historical snapshot and publish the approved values.</p>` : ""}${
            ["approve", "reject", "clarify"].includes(action) && steps.length
              ? P().select(
                  "Approval step",
                  "step_id",
                  steps.map((step) => [step.id, step.name]),
                )
              : ""
          }${P().textArea("Review comment", "comment", "", 'placeholder="Add context for the requesting department…"')}<div class="form-actions"><button class="btn ${action === "reject" ? "danger" : "primary"}" type="submit">${action === "publish" ? "Publish approved change" : action[0].toUpperCase() + action.slice(1)}</button></div></form>`,
        );
        handleForm("#decision-form", async (data) => {
          await api(path(`/planning/drafts/${d.id}/${action}`), "POST", {
            revision: d.revision,
            comment: data.comment,
            step_id: data.step_id,
          });
          closeModal();
          await refresh();
          toast("Schedule proposal updated");
        });
      }),
  );
  $$("[data-draft-detail]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = S.data.drafts.find((x) => x.id === b.dataset.draftDetail);
        modal(
          "Schedule proposal details",
          `<h3>${esc(d.before.name)}</h3><p class="config-description" style="margin-top:8px">${esc(d.reason)}</p><div class="notice">${icon("users")}${esc(d.author)} · ${date(d.created_at)} · ${esc(d.status)}</div><dl class="detail-grid">${[
            ["Old berth", P().berth(d.before.berth_id)?.code],
            ["New berth", P().berth(d.proposed.berth_id)?.code],
            [
              "Start shift",
              (
                (new Date(d.proposed.start) - new Date(d.before.start)) /
                3600000
              ).toFixed(2) + " h",
            ],
            ["Existing start", date(d.before.start)],
            ["Proposed start", date(d.proposed.start)],
            ["Proposed end", date(d.proposed.end)],
            ["Cargo quantity", P().fmt(d.proposed.quantity) + " t"],
            [
              "Review route",
              (
                d.workflow.steps?.map((x) => x.name) || d.workflow.departments
              ).join(" → "),
            ],
            ["Author revision", d.before.revision],
          ]
            .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
            .join(
              "",
            )}</dl><div class="notice ${d.validation.errors.length ? "error" : "success"}">${icon("shield-check")}${d.validation.errors.map(esc).join("<br>") || "Stored validation passed. Publication always reruns checks."}</div><h3 class="detail-section-title">Review history</h3>${d.decisions.map((x) => `<div class="history-row"><div class="history-dot"></div><div>${esc(x.author)} · ${esc(x.action)}<p>${esc(x.step_name || x.department)} · ${esc(x.comment || "No comment")}</p></div><time>${date(x.created_at)}</time></div>`).join("") || '<p class="subtle">No decisions recorded.</p>'}`,
          true,
        );
      }),
  );
  if (S.tab === "reports") bindReports();
}
export function delayForm(callId = "") {
  const {
    S,
    modal,
    select,
    field,
    textArea,
    icon,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
  } = P();
  modal(
    "Declare an operational delay",
    `<form id="delay-form"><div class="notice warning">${icon("clock-alert")}Reporting a delay creates an operational alert and updates delay analytics. It does not change the approved schedule.</div><div class="form-grid">${select(
      "Affected vessel",
      "call_id",
      S.data.calls
        .filter((c) => !["Completed", "Cancelled"].includes(c.status))
        .map((c) => [c.id, c.name]),
      callId,
    )}${select("Cause", "cause", ["Production", "Supply Chain", "Operations", "Quality Control", "Maintenance / Equipment", "Vessel / Marine", "External / Weather"])}${field("Duration, hours", "hours", 2, "number", 'required min="0.25" step="0.25"')}${select("Responsible department", "department", S.data.port.departments, P().membership()?.department || "Operations")}${select("Equipment breakdown, optional", "equipment_id", [["", "No equipment outage"], ...S.data.equipment.map((e) => [e.id, e.name])])}${field("Recovery forecast", "recovery_at", "", "datetime-local")}${textArea("Description", "description", "", 'required placeholder="Describe the interruption, impact and recovery actions…"')}</div><div class="form-actions"><button class="btn primary" type="submit">${icon("save")}Record delay & notify</button></div></form>`,
  );
  handleForm("#delay-form", async (d) => {
    d.hours = Number(d.hours);
    d.status = "Open";
    d.start = new Date(Date.now() - d.hours * 3600000).toISOString();
    d.recovery_at = d.recovery_at
      ? new Date(d.recovery_at).toISOString()
      : null;
    await api(path("/delays"), "POST", d);
    closeModal();
    await refresh();
    toast(
      "Delay recorded. Analytics, equipment availability and alerts updated.",
    );
  });
}
export function alertModal(id) {
  const {
    S,
    modal,
    esc,
    icon,
    date,
    status,
    select,
    textArea,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
    btn,
  } = P();
  const a = S.data.alerts.find((x) => x.id === id);
  if (!a) return;
  modal(
    "Operational alert",
    `<div class="detail-banner"><div class="detail-icon" style="background:#fff6eb;color:#c19a50">${icon("triangle-alert")}</div><div><h2 style="font-size:calc(16px * var(--ui-font-scale, 1))">${esc(a.title)}</h2><p>${esc(a.department || "Operations")} · ${date(a.created_at)}</p></div>${status(a.severity)}</div><p class="config-description">${esc(a.description)}</p>${a.call_id ? `<div class="notice">${icon("ship")}${esc(S.data.calls.find((c) => c.id === a.call_id)?.name || "Unknown vessel")}<button class="btn small ghost" id="alert-vessel" style="margin-left:auto">View vessel ${icon("arrow-right")}</button></div>` : ""}<div class="detail-section-title">Status ${status(a.status)}</div>${(a.comments || []).map((c) => `<div class="history-row"><div class="history-dot"></div><div>${esc(c.author)}<p>${esc(c.text)}</p></div><time>${date(c.created_at)}</time></div>`).join("")}${P().can("alerts.edit") ? `<form id="alert-form"><div class="form-grid">${select("Update status", "status", ["Open", "Acknowledged", "Resolved", "Closed"], a.status)}${select("Assign to department", "department", S.data.port.departments, a.department)}${textArea("Add comment", "comment", "", 'placeholder="Add investigation details or resolution notes…"')}</div><div class="form-actions"><button class="btn primary" type="submit">${icon("save")}Save alert update</button></div></form>` : ""}`,
  );
  if (P().$("#alert-vessel"))
    P().$("#alert-vessel").onclick = () => P().vesselModal(a.call_id);
  if (P().$("#alert-form"))
    handleForm("#alert-form", async (d) => {
      const comments = [...(a.comments || [])];
      if (d.comment)
        comments.push({
          author: S.user.name,
          text: d.comment,
          created_at: new Date().toISOString(),
        });
      await api(path("/alerts/" + a.id), "PUT", {
        ...a,
        status: d.status,
        department: d.department,
        comments,
      });
      closeModal();
      await refresh();
      toast("Alert updated");
    });
}
