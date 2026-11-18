import { renderAssetConstraints, bindAssetConstraints } from "./asset-constraints.js?v=4";
const P = () => window.P;
const safe = (v) => P().esc(v);
const categories = [
  ["approvals", "git-pull-request", "Approval workflows", "Build review stages, assign departments or people, and set approval policies."],
  ["physical", "anchor", "Physical constraints", "Vessel length, draft, berth availability and safety gaps."],
  ["equipment", "construction", "Equipment constraints", "Handling capacity, service availability and served berths."],
  ["cargo", "package", "Cargo access rules", "Control which berths can handle specific products, grades and cargo flows."],
  ["planning", "calendar-range", "Planning defaults", "Default durations, safety buffers and scheduling precision."],
  ["validation", "shield-check", "Mandatory validation", "Review the checks enforced before approval and publication."],
];
const categoryFor = (id) => id.startsWith("berth:") ? "physical" : id.startsWith("equipment:") ? "equipment" : id.startsWith("cargo:") ? "cargo" : ["workflow", "automation"].includes(id) ? "approvals" : id === "defaults" ? "planning" : "validation";
const back = () => `<button type="button" class="btn small" id="rules-back">← ${safe(categories.find(([id]) => id === P().S.ruleCategory)?.[2] || "Rule categories")}</button>`;
const save = (label = "Save rule") =>
  `<div class="form-actions"><button type="submit" class="btn primary" ${P().can("config.edit") ? "" : "disabled"}>${label}</button></div>`;
function workflowTemplates() {
  const p = P().S.data.port;
  return p.workflow_templates || [{ id: "default", name: p.workflow.name || "Schedule approval", mode: p.workflow.mode || "sequential", segregation: p.workflow.segregation !== false, steps: p.workflow.steps || (p.workflow.departments || []).map((department, i) => ({ id: "step-" + i, name: department + " review", department, user_ids: [], decision: "any" })) }];
}
function workflowList() {
  const { S, cardHead, can, icon } = P();
  const active = S.data.port.workflow.template_id || "default";
  return `<button class="btn small" id="rule-categories-back">← Rule categories</button><section class="card rule-list-page">${cardHead("Approval workflows", "git-pull-request")}<div class="toolbar"><div class="spacer"></div>${can("config.edit") ? `<button class="btn primary" id="add-workflow">${icon("plus")}Add workflow</button>` : ""}<button class="btn small" data-rule-page="automation">Approval policy</button></div><div class="workflow-template-list">${workflowTemplates().map(t => `<article class="workflow-template"><div class="workflow-template-head"><div><h3>${safe(t.name)}</h3><p>${t.steps.length} steps · ${t.mode === "parallel" ? "Parallel" : "Sequential"} review ${t.id === active ? '· <strong>Active for new proposals</strong>' : ""}</p></div><div class="workflow-template-actions"><button class="btn small" data-workflow-edit="${safe(t.id)}">${can("config.edit") ? "Configure" : "View"}</button>${can("config.edit") ? `${t.id !== active ? `<button class="btn small" data-workflow-activate="${safe(t.id)}">Set active</button>` : ""}<button class="btn small danger" data-workflow-remove="${safe(t.id)}" ${t.id === active ? 'disabled title="Activate another workflow before removing this one"' : ""}>Remove</button>` : ""}</div></div><div class="rule-route"><span class="workflow-endpoint">Start</span>${t.steps.map((step, i) => `<span class="rule-route-step"><b>${i + 1}</b><span>${safe(step.name)}<small>${safe(step.department || (step.user_ids || []).map(id => S.workflowReviewers?.find(u => u.id === id)?.name || "Assigned approver").join(", "))} · ${step.decision === "all" ? "All" : "Any one"}</small></span></span>`).join("")}<span class="workflow-endpoint">Finish</span></div></article>`).join("")}</div></section>`;
}
export function renderRuleWorkbench() {
  const { S, cardHead, field, select } = P(),
    p = S.data.port,
    r = p.rules || {},
    editor = S.ruleEditor;
  if (!editor) {
    const rows = [
      [
        "workflow",
        "Schedule approval workflow",
        "Approval route",
        `${p.workflow.steps?.length || p.workflow.departments?.length || 0} steps · ${p.workflow.mode || "parallel"}`,
      ],
      [
        "automation",
        "Automatic approval policy",
        "Approval automation",
        p.workflow.approval_mode || "manual",
      ],
      [
        "defaults",
        "Planning defaults",
        "Scheduling",
        `${r.default_duration_hours || 24} h duration · ${r.snap_minutes || 15} min precision`,
      ],
      [
        "constraints",
        "Readiness, conflicts & booking validation",
        "Mandatory checks",
        "Cargo readiness · berth overlaps · equipment double-booking",
      ],
      ...S.data.equipment.map((e) => [
        "equipment:" + e.id,
        e.name + " · capacity & service",
        "Equipment constraints",
        e.capacity + " t/h · " + e.status,
      ]),
      ...S.data.berths.map((b) => [
        "berth:" + b.id,
        `${b.code} · vessel limits & safety`,
        "Physical constraints",
        `${b.max_loa} m LOA · ${b.max_draft} m draft · ${b.buffer_hours} h gap`,
      ]),
      ...(r.custom_rules || []).map((x) => [
        "cargo:" + x.id,
        x.name,
        "Cargo access",
        x.enabled === false
          ? "Disabled"
          : x.effect === "deny"
            ? "Deny selected berths"
            : "Allow selected berths",
      ]),
    ];
    const category = categories.find(([id]) => id === S.ruleCategory);
    if (!category) return `<section class="card rule-hub">${cardHead("Rules & workflows", "shield-check")}<div class="rule-hub-body"><div class="rule-hub-intro"><span class="rule-kicker">PORT GOVERNANCE</span><h2>Choose what you want to configure</h2><p>Manage approvals and operational limits for ${safe(p.name)}.</p></div><div class="rule-category-grid">${categories.map(([id, ic, title, description]) => `<button type="button" class="rule-category-card" data-rule-category="${id}"><span class="rule-category-icon">${P().icon(ic)}</span><strong>${title}</strong><p>${description}</p><span class="rule-category-footer">${["physical", "equipment"].includes(id) ? (r.asset_constraints || []).filter(x => x.kind === (id === "physical" ? "berths" : "equipment")).length : rows.filter(([key]) => categoryFor(key) === id).length} ${id === "physical" || id === "equipment" ? "constraints" : id === "cargo" ? "access rules" : rows.filter(([key]) => categoryFor(key) === id).length === 1 ? "setting" : "settings"}${P().icon("arrow-right")}</span></button>`).join("")}</div></div></section>`;
    if (category[0] === "approvals") return workflowList();
    if (["physical", "equipment"].includes(category[0])) return renderAssetConstraints(category[0] === "physical" ? "berths" : "equipment");
    const selectedRows = rows.filter(([id]) => categoryFor(id) === category[0]);
    const route = p.workflow.steps || (p.workflow.departments || []).map(name => ({ name: name + " review", decision: "any" }));
    return `<button type="button" class="btn small" id="rule-categories-back">← Rule categories</button><section class="card rule-list-page">${cardHead(category[2], category[1])}<div class="rule-category-intro"><p>${category[3]}</p>${category[0] === "approvals" ? `<div class="rule-route" aria-label="Current approval route"><span class="rule-route-mode">${p.workflow.mode === "sequential" ? "Sequential review" : "Parallel review"}</span>${route.map((step, i) => `<span class="rule-route-step"><b>${i + 1}</b><span>${safe(step.name)}<small>${step.decision === "all" ? "All reviewers" : "Any one reviewer"}</small></span></span>`).join("") || '<span>No approval steps configured</span>'}</div>` : ""}</div><div class="toolbar"><div class="search-box">${P().icon("search")}<input type="search" id="all-rules-search" placeholder="Search this category…" aria-label="Search ${category[2]}"></div><div class="spacer"></div>${category[0] === "cargo" && P().can("config.edit") ? '<button class="btn primary" id="new-cargo-rule">Add cargo access rule</button>' : ""}</div><div class="table-scroll"><table><thead><tr><th>${category[0] === "physical" || category[0] === "equipment" ? "Infrastructure" : "Setting"}</th><th>Current configuration</th><th>Actions</th></tr></thead><tbody>${selectedRows.map(([id, name, type, summary]) => `<tr data-rule-search="${safe((name + " " + summary).toLowerCase())}"><td><strong>${safe(name)}</strong></td><td>${safe(summary)}</td><td><button class="btn small" data-rule-page="${safe(id)}">${id === "constraints" ? "View checks" : P().can("config.edit") ? "Configure" : "View"}</button>${P().can("config.edit") && id.startsWith("cargo:") ? `<button class="btn small danger" data-rule-remove="${safe(id)}">Remove</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="3"><div class="empty-state"><h3>No ${category[0] === "cargo" ? "cargo access rules" : "infrastructure"} configured</h3><p>${category[0] === "cargo" ? "Add a cargo access rule to define berth restrictions." : "Add berths or equipment under Ports to configure their constraints here."}</p></div></td></tr>`}</tbody></table><p class="rule-search-empty" id="rule-search-empty" hidden>No settings match your search.</p></div></section>`;
  }
  const header = (title) =>
    `${back()}<section class="card rule-edit-page">${cardHead(title, "shield-check")}<form id="rule-page-form" class="form-body${editor === "workflow" ? " workflow-editor" : ""}">`;
  if (editor === "workflow") {
    const template = workflowTemplates().find(t => t.id === S.workflowEditingId) || workflowTemplates()[0];
    const steps = S.workflowDraft || template.steps;
    return (
      header(S.workflowEditingId === "new" ? "New workflow" : "Configure workflow") +
      `<div class="workflow-editor-controls">${field("Workflow name", "workflow_name", S.workflowName ?? template.name, "text", 'required maxlength="120"')}<label class="field">Number of steps<input id="workflow-step-count" type="number" min="1" max="50" value="${steps.length}" required></label></div><details class="workflow-options"><summary>Review options</summary><div class="form-grid">${select("Step order", "mode", [["sequential", "Sequential · in numbered order"], ["parallel", "Parallel · at the same time"]], S.workflowMode || template.mode)}<label class="check-row"><input type="checkbox" name="segregation" ${(S.workflowSegregation ?? template.segregation) ? "checked" : ""}>Authors cannot approve their own changes</label></div></details><div class="workflow-canvas"><span class="workflow-endpoint">Start</span><div id="workflow-steps">${steps.map((step, i) => stepRow(step, i)).join("")}</div><span class="workflow-endpoint">Finish</span></div><button type="button" class="btn" id="workflow-add-step">Add step</button>${save("Save workflow")}</form></section>`
    );
  }
  if (editor === "constraints")
    return `${back()}<section class="card rule-edit-page">${cardHead("Mandatory planning validation", "shield-check")}<div class="form-body"><p>Every proposal is checked for cargo readiness, vessel dimensions, cargo compatibility, berth availability, safety buffers, overlapping berth allocations and equipment double-booking before approval or publication.</p><p>These checks are always enforced. Edit the relevant berth, equipment or cargo rule to change its configured limits.</p></div></section>`;
  if (editor.startsWith("equipment:")) {
    const e = S.data.equipment.find((x) => x.id === editor.slice(10));
    if (!e) {
      S.ruleEditor = null;
      return renderRuleWorkbench();
    }
    return (
      header(e.name + " · capacity & service") +
      `<div class="form-grid">${field("Handling capacity, t/h", "capacity", e.capacity, "number", 'min="0.01" step="any" required')}${select("Availability", "status", ["Available", "Maintenance", "Outage"], e.status)}</div><fieldset><legend>Served berths</legend>${S.data.berths.map((b) => `<label class="check-row"><input type="checkbox" name="served_berths" value="${safe(b.id)}" ${e.berths.includes(b.id) ? "checked" : ""}>${safe(b.code + " · " + b.name)}</label>`).join("")}</fieldset>${save()}</form></section>`
    );
  }
  if (editor === "automation")
    return (
      header("Automatic & semi-automatic approvals") +
      `<div class="form-grid">${select(
        "Approval policy",
        "approval_mode",
        [
          ["manual", "Manual review"],
          [
            "semi",
            "Semi-automatic · approve eligible changes; publish manually",
          ],
          ["automatic", "Automatic · approve and publish eligible changes"],
        ],
        p.workflow.approval_mode || "manual",
      )}${field("Maximum start movement, hours", "auto_max_shift_hours", p.workflow.auto_max_shift_hours ?? 2, "number", 'min="0" max="720" step="0.25" required')}${field("Maximum duration change, hours", "auto_max_duration_change_hours", p.workflow.auto_max_duration_change_hours ?? 2, "number", 'min="0" max="720" step="0.25" required')}<label class="check-row"><input type="checkbox" name="auto_allow_berth_change" ${p.workflow.auto_allow_berth_change ? "checked" : ""}>Allow eligible berth reassignment</label></div><p class="config-description">Automation requires all physical checks to pass without warnings. Cargo, quantity and equipment changes require review. The submitting user must have publication permission for automatic publication.</p>${save()}</form></section>`
    );
  if (editor === "defaults")
    return (
      header("Planning defaults") +
      `<div class="form-grid">${field("Default operation duration, hours", "default_duration_hours", r.default_duration_hours || 24, "number", 'min="0.25" max="720" step="0.25" required')}${field("New berth safety gap, hours", "buffer_hours", r.buffer_hours ?? 1, "number", 'min="0" max="168" step="0.25" required')}${select(
        "Drag and resize precision",
        "snap_minutes",
        [5, 10, 15, 30, 60].map((n) => [n, n + " minutes"]),
        r.snap_minutes || 15,
      )}</div>${save()}</form></section>`
    );
  if (editor.startsWith("berth:")) {
    const b = S.data.berths.find((x) => x.id === editor.slice(6));
    if (!b) {
      S.ruleEditor = null;
      return renderRuleWorkbench();
    }
    return (
      header(b.code + " · physical vessel rules") +
      `<div class="form-grid">${field("Maximum vessel length, m", "max_loa", b.max_loa, "number", `min="1" max="${b.length}" required`)}${field("Maximum draft, m", "max_draft", b.max_draft, "number", 'min="0.1" step="0.1" required')}${field("Safety gap, hours", "buffer_hours", b.buffer_hours, "number", 'min="0" max="168" step="0.25" required')}${select("Berth availability", "status", ["Available", "Maintenance", "Closed"], b.status)}</div>${save()}</form></section>`
    );
  }
  const existing = (r.custom_rules || []).find((x) => x.id === editor.slice(6));
  const c = existing || {
    id: "RULE-" + Date.now().toString(36),
    name: "",
    enabled: true,
    effect: "deny",
    berth_ids: [],
  };
  return (
    header(existing ? "Edit cargo access rule" : "New cargo access rule") +
    `<input type="hidden" name="id" value="${safe(c.id)}"><div class="form-grid">${field("Rule name", "name", c.name, "text", "required")}${select(
      "Effect",
      "effect",
      [
        ["deny", "Deny selected berths"],
        ["allow", "Allow only selected berths"],
      ],
      c.effect,
    )}${select(
      "Enabled",
      "enabled",
      [
        ["true", "Enabled"],
        ["false", "Disabled"],
      ],
      String(c.enabled !== false),
    )}${select(
      "Cargo flow",
      "direction",
      [
        ["", "Any"],
        ["Import", "Import"],
        ["Export", "Export"],
      ],
      c.direction || "",
    )}${["product", "grade", "subgrade"].map((k) => select(k[0].toUpperCase() + k.slice(1), k, [["", "Any"], ...[...new Set((p.cargo_catalog || []).map((x) => x[k]).filter(Boolean))].map((x) => [x, x])], c[k] || "")).join("")}</div><fieldset><legend>Selected berths</legend>${S.data.berths.map((b) => `<label class="check-row"><input type="checkbox" name="berth_ids" value="${safe(b.id)}" ${c.berth_ids.includes(b.id) ? "checked" : ""}>${safe(b.code + " · " + b.name)}</label>`).join("")}</fieldset>${existing && P().can("config.edit") ? `<button class="btn danger" type="button" id="delete-cargo-rule">Delete cargo rule</button>` : ""}${save()}</form></section>`
  );
}
function stepRow(step, i) {
  const { S, field, select } = P();
  return `<fieldset class="workflow-step" data-step="${safe(step.id)}"><legend>Step ${i + 1}</legend><div class="form-grid">${field("Step name", "step_name", step.name, "text", "required")}${select(
    "Decision",
    "decision",
    [
      ["any", "Any one reviewer"],
      ["all", "All assigned reviewers"],
    ],
    step.decision || "any",
  )}${select("Approvers", "department", [["", "Choose people below"], ...S.data.port.departments.map((d) => [d, d])], step.department || "")}</div><div class="step-reviewers" ${step.department ? "hidden" : ""}>${(S.workflowReviewers || []).map((u) => `<label class="check-row"><input type="checkbox" name="reviewer" value="${safe(u.id)}" ${(step.user_ids || []).includes(u.id) ? "checked" : ""}>${safe(u.name)} <small>· ${safe(u.department)}</small></label>`).join("") || '<p class="subtle">Loading eligible reviewers…</p>'}</div><div class="workflow-step-actions"><button type="button" class="btn small" data-step-up ${i === 0 ? "disabled" : ""}>Move earlier</button><button type="button" class="btn small" data-step-down ${i === (S.workflowDraft || workflowTemplates().find(t => t.id === S.workflowEditingId)?.steps || workflowTemplates()[0].steps).length - 1 ? "disabled" : ""}>Move later</button><button type="button" class="btn small danger" data-step-remove ${(S.workflowDraft || workflowTemplates().find(t => t.id === S.workflowEditingId)?.steps || workflowTemplates()[0].steps).length === 1 ? "disabled" : ""}>Remove step</button></div></fieldset>`;
}
export function bindRuleWorkbench() {
  const { S, $, $$, api, path, renderApp, handleForm, refresh, toast } = P(),
    p = S.data.port;
  const open = (id) => {
    if (id) S.ruleCategory = categoryFor(id);
    S.ruleEditor = id;
    S.workflowDraft = null;
    S.workflowName = null;
    S.workflowMode = null;
    S.workflowSegregation = null;
    renderApp();
  };
  const saveTemplates = async (templates, active = p.workflow.template_id || "default") => {
    await api(path(""), "PUT", { ...p, workflow_templates: templates, workflow: { ...p.workflow, template_id: active } });

  };
  if ($("#add-workflow")) $("#add-workflow").onclick = () => {
    S.workflowEditingId = "new";
    open("workflow");
    S.workflowDraft = [{ id: crypto.randomUUID(), name: "Step 1", department: "", user_ids: [], decision: "any" }];
    S.workflowName = "";
    S.workflowMode = "sequential";
    renderApp();
  };
  $$("[data-workflow-edit]").forEach(b => b.onclick = () => { S.workflowEditingId = b.dataset.workflowEdit; open("workflow"); });
  $$("[data-workflow-activate]").forEach(b => b.onclick = async () => {
    try { await saveTemplates(workflowTemplates(), b.dataset.workflowActivate); await refresh(); toast("Workflow activated for new proposals"); } catch(e) { toast(e.message, true); }
  });
  $$("[data-workflow-remove]").forEach(b => b.onclick = () => {
    const target = workflowTemplates().find(t => t.id === b.dataset.workflowRemove);
    P().modal("Remove workflow", `<form id="remove-workflow-form"><p>Remove <strong>${safe(target.name)}</strong>? Existing proposals retain their approval route.</p><div class="form-actions"><button type="button" class="btn" id="cancel-workflow-remove">Cancel</button><button type="submit" class="btn danger">Remove workflow</button></div></form>`);
    $("#cancel-workflow-remove").onclick = P().closeModal;
    handleForm("#remove-workflow-form", async () => { await saveTemplates(workflowTemplates().filter(t => t.id !== target.id)); P().closeModal(); await refresh(); toast("Workflow removed"); });
  });
  $$("[data-rule-category]").forEach(b => b.onclick = () => {
    S.ruleCategory = b.dataset.ruleCategory;
    open(null);
  });
  if ($("#rule-categories-back")) $("#rule-categories-back").onclick = () => {
    S.ruleCategory = null;
    open(null);
  };
  $$("#new-cargo-rule").forEach((b) => (b.onclick = () => open("cargo:new")));
  $$("[data-rule-page]").forEach(
    (b) => (b.onclick = () => open(b.dataset.rulePage)),
  );
  if ($("#rules-back")) $("#rules-back").onclick = () => open(null);
  if ($("#all-rules-search"))
    $("#all-rules-search").oninput = (e) => {
      const rows = $$("[data-rule-search]");
      rows.forEach(r => r.hidden = !r.dataset.ruleSearch.includes(e.target.value.toLowerCase()));
      $("#rule-search-empty").hidden = rows.some(r => !r.hidden) || !rows.length;
    };
  const removeCargoRule = (id) => {
    const rule = (p.rules.custom_rules || []).find(x => x.id === id);
    P().modal("Remove cargo rule", `<form id="remove-cargo-rule-form"><p>Remove ${safe(rule.name)}? This changes berth access for matching cargo.</p><div class="form-actions"><button type="button" class="btn" id="cancel-rule-remove">Cancel</button><button class="btn danger" type="submit">Remove rule</button></div></form>`);
    $("#cancel-rule-remove").onclick = P().closeModal;
    handleForm("#remove-cargo-rule-form", async () => {
      await api(path("/configuration/rules"), "POST", { port_revision: p.revision, rules: { ...p.rules, custom_rules: p.rules.custom_rules.filter(x => x.id !== id) }, berths: [] });
      P().closeModal(); S.ruleEditor = null; await refresh(); toast("Cargo rule removed");
    });
  };
  $$("[data-rule-remove]").forEach(b => b.onclick = () => {
    removeCargoRule(b.dataset.ruleRemove.slice(6));
  });
  if (!S.ruleEditor && ["physical", "equipment"].includes(S.ruleCategory)) bindAssetConstraints(S.ruleCategory === "physical" ? "berths" : "equipment");
  const editor = S.ruleEditor;
  if (!editor || editor === "constraints") return;
  if ($("#delete-cargo-rule")) $("#delete-cargo-rule").onclick = () => removeCargoRule(editor.slice(6));
  if (editor === "workflow") {
    if (!S.workflowReviewers || S.workflowReviewerPort !== S.portId) {
      const port = S.portId;
      api(path("/configuration/reviewers"))
        .then((rows) => {
          if (S.portId !== port) return;
          S.workflowReviewers = rows;
          S.workflowReviewerPort = port;
          if (S.configTab === "rules" && S.ruleEditor === "workflow") {
            remember();
            renderApp();
          }
        })
        .catch((e) => toast(e.message, true));
    }
    const readSteps = () =>
      $$(".workflow-step").map((el) => ({
        id: el.dataset.step,
        name: el.querySelector("[name=step_name]").value,
        decision: el.querySelector("[name=decision]").value,
        department: el.querySelector("[name=department]").value,
        user_ids: el.querySelector("[name=department]").value
          ? []
          : [...el.querySelectorAll("[name=reviewer]:checked")].map(
              (x) => x.value,
            ),
      }));
    const remember = () => {
      S.workflowDraft = readSteps();
      S.workflowName = $("[name=workflow_name]").value;
      S.workflowMode = $("[name=mode]").value;
      S.workflowSegregation = $("[name=segregation]").checked;
    };
    $("#workflow-step-count").onchange = e => {
      const count = Number(e.target.value);
      if (!Number.isInteger(count) || count < 1 || count > 50) { e.target.reportValidity(); return; }
      remember();
      S.workflowDraft = Array.from({length: count}, (_, i) => S.workflowDraft[i] || { id: crypto.randomUUID(), name: "Step " + (i + 1), department: "", user_ids: [], decision: "any" });
      renderApp();
    };
    $("#workflow-add-step").onclick = () => {
      remember();
      if (S.workflowDraft.length >= 50) return;
      S.workflowDraft.push({
        id: crypto.randomUUID(),
        name: "Step " + (S.workflowDraft.length + 1),
        department: "",
        user_ids: [],
        decision: "any",
      });
      renderApp();
    };
    $$(".workflow-step").forEach((el, i) => {
      el.querySelector("[name=department]").onchange = (e) => {
        el.querySelector(".step-reviewers").hidden = !!e.target.value;
      };
      for (const [selector, delta] of [
        ["[data-step-up]", -1],
        ["[data-step-down]", 1],
        ["[data-step-remove]", 0],
      ])
        el.querySelector(selector).onclick = () => {
          remember();
          if (delta) {
            const target = i + delta;
            if (target < 0 || target >= S.workflowDraft.length) return;
            [S.workflowDraft[i], S.workflowDraft[target]] = [
              S.workflowDraft[target],
              S.workflowDraft[i],
            ];
          } else { if (S.workflowDraft.length === 1) return; S.workflowDraft.splice(i, 1); }
          renderApp();
        };
    });
    handleForm("#rule-page-form", async (d) => {
      const steps = readSteps();
      if (!steps.length) throw new Error("Add at least one approval step");
      const template = {
        id: S.workflowEditingId === "new" ? crypto.randomUUID() : S.workflowEditingId || p.workflow.template_id || "default",
        name: d.workflow_name.trim(), steps, mode: d.mode, segregation: d.segregation === "on",
      };
      const templates = workflowTemplates();
      const updated = templates.some(t => t.id === template.id) ? templates.map(t => t.id === template.id ? template : t) : [...templates, template];
      await saveTemplates(updated);
      S.ruleEditor = null;
      S.workflowDraft = null;
      await refresh();
      toast("Approval workflow saved");
    });
    return;
  }
  handleForm("#rule-page-form", async (d, form) => {
    if (editor.startsWith("equipment:")) {
      const e = S.data.equipment.find((x) => x.id === editor.slice(10));
      await api(path("/equipment/" + e.id), "PUT", {
        ...e,
        capacity: Number(d.capacity),
        status: d.status,
        berths: new FormData(form).getAll("served_berths"),
      });
    } else if (editor === "automation")
      await api(path(""), "PUT", {
        ...p,
        workflow: {
          ...p.workflow,
          approval_mode: d.approval_mode,
          auto_max_shift_hours: Number(d.auto_max_shift_hours),
          auto_max_duration_change_hours: Number(
            d.auto_max_duration_change_hours,
          ),
          auto_allow_berth_change: d.auto_allow_berth_change === "on",
        },
      });
    else {
      let rules = { ...p.rules },
        berths = [];
      if (editor === "defaults")
        Object.assign(rules, {
          default_duration_hours: Number(d.default_duration_hours),
          buffer_hours: Number(d.buffer_hours),
          snap_minutes: Number(d.snap_minutes),
        });
      else if (editor.startsWith("berth:")) {
        const b = S.data.berths.find((x) => x.id === editor.slice(6));
        berths = [
          {
            id: b.id,
            revision: b.revision,
            max_loa: Number(d.max_loa),
            max_draft: Number(d.max_draft),
            buffer_hours: Number(d.buffer_hours),
            status: d.status,
          },
        ];
      } else {
        const ids = new FormData(form).getAll("berth_ids");
        if (!ids.length) throw new Error("Select at least one berth");
        rules.custom_rules = [
          ...(rules.custom_rules || []).filter((x) => x.id !== d.id),
          {
            id: d.id,
            name: d.name,
            effect: d.effect,
            enabled: d.enabled === "true",
            direction: d.direction,
            product: d.product,
            grade: d.grade,
            subgrade: d.subgrade,
            berth_ids: ids,
          },
        ];
      }
      await api(path("/configuration/rules"), "POST", {
        port_revision: p.revision,
        rules,
        berths,
      });
    }
    S.ruleEditor = null;
    await refresh();
    toast("Rule saved");
  });
}
