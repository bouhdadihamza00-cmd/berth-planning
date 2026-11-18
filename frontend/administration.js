const P = () => window.P;
export const permissionLabels = {
  "dashboard.view": "View port overview",
  "dashboard.export": "Export dashboard data",
  "calls.view": "View vessel calls",
  "calls.create": "Nominate vessels",
  "calls.edit": "Edit vessel details",
  "calls.cancel": "Cancel vessel calls",
  "planning.view": "View berth planning",
  "planning.draft": "Create schedule drafts",
  "planning.submit": "Submit schedule changes",
  "planning.publish": "Publish approved plans",
  "operations.view": "View operational records",
  "operations.update": "Update progress and actual times",
  "readiness.view": "View cargo readiness",
  "readiness.update": "Confirm cargo availability",
  "equipment.view": "View equipment",
  "equipment.update": "Update equipment availability",
  "delays.view": "View operational delays",
  "delays.create": "Report delays and breakdowns",
  "alerts.view": "View alerts",
  "alerts.edit": "Manage and resolve alerts",
  "approvals.view": "View approval requests",
  "approvals.approve": "Approve or reject schedule changes",
  "reports.view": "View reports",
  "reports.export": "Download reports",
  "scenarios.view": "View planning scenarios",
  "scenarios.create": "Run planning scenarios",
  "config.view": "View port configuration",
  "config.edit": "Manage port configuration",
  "users.view": "View port users",
  "users.edit": "Manage users and access",
};
export function renderDepartments() {
  const { S, cardHead, icon, esc, btn } = P();
  return `<section class="card">${cardHead("Departments", "building-2", "Operational teams and approval owners")}<div class="toolbar"><div class="spacer"></div>${btn("Add department", "plus", "department-add", "primary")}</div><div class="table-scroll"><table><thead><tr><th scope=\"col\">Department</th><th scope=\"col\">Approval routing</th><th scope=\"col\">Actions</th></tr></thead><tbody>${S.data.port.departments.map((n) => `<tr><td class="vessel-cell">${esc(n)}</td><td>${S.data.port.workflow.departments.includes(n) ? "Required reviewer" : "Not in the current approval route"}</td><td><button class="btn small" data-department-rename="${esc(n)}">Rename</button><button class="btn small danger" data-department-remove="${esc(n)}">Remove</button></td></tr>`).join("")}</tbody></table></div></section>`;
}
export function bindDepartments() {
  const {
    $,
    $$,
    S,
    modal,
    field,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
  } = P();
  function edit(action, name = "") {
    modal(
      action === "add"
        ? "Add department"
        : action === "rename"
          ? "Rename department"
          : "Remove department",
      `<form id="department-form">${action === "remove" ? `<p class="config-description">Remove ${P().esc(name)} from this port? Departments with members or approval responsibilities must be reassigned first.</p>` : field("Department name", "value", name, "text", 'required maxlength="80"')}<div class="form-actions"><button class="btn ${action === "remove" ? "danger" : "primary"}" type="submit">${action === "remove" ? "Remove department" : "Save department"}</button></div></form>`,
    );
    handleForm("#department-form", async (d) => {
      await api(path("/configuration/departments"), "POST", {
        action,
        name: action === "add" ? d.value : name,
        new_name: action === "rename" ? d.value : undefined,
      });
      S.user = await api("/auth/me");
      closeModal();
      await refresh();
      toast("Department configuration updated");
    });
  }
  $("[data-action=department-add]").onclick = () => edit("add");
  $$("[data-department-rename]").forEach(
    (b) => (b.onclick = () => edit("rename", b.dataset.departmentRename)),
  );
  $$("[data-department-remove]").forEach(
    (b) => (b.onclick = () => edit("remove", b.dataset.departmentRemove)),
  );
}
function range(label, name, value, min, max, step = 1, unit = "") {
  const { esc } = P();
  return `<label class="field rule-slider"><span>${esc(label)} <output>${esc(value)}${unit}</output></span><input type="range" aria-label="${esc(label)}" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
}
export function renderRules() {
  const { S, cardHead, select, icon, esc } = P(),
    p = S.data.port;
  const rules = p.rules || {},
    selected =
      S.data.berths.find((b) => b.id === S.ruleBerthId) || S.data.berths[0];
  const list = rules.custom_rules || [];
  return `<section class="card rules-workbench">${cardHead("Planning rules", "shield-check", "Cargo access and berth safety")}<div class="rule-explanation">${icon("info")}<span>Physical vessel limits, equipment capacity, cargo readiness and overlapping bookings are always checked. Cargo access rules add restrictions; a Deny rule takes priority over Allow rules.</span></div><form id="rules-form" class="rules-form"><div class="form-grid">${range("Default operation duration", "default_duration_hours", rules.default_duration_hours || 24, 0.25, 720, 0.25, " h")}${range("New berth safety gap", "buffer_hours", rules.buffer_hours ?? 1, 0, 168, 0.25, " h")}${select(
    "Drag and resize precision",
    "snap_minutes",
    [
      [5, "5 minutes"],
      [10, "10 minutes"],
      [15, "15 minutes"],
      [30, "30 minutes"],
      [60, "1 hour"],
    ],
    rules.snap_minutes || 15,
  )}</div><h3>Berth safety limits</h3>${selected ? `<label class="field"><span>Select berth</span><select id="rule-berth-select">${S.data.berths.map((b) => `<option value="${esc(b.id)}" ${b.id === selected.id ? "selected" : ""}>${esc(b.code)} · ${esc(b.name)}</option>`).join("")}</select></label><div id="selected-berth-rules" class="form-grid">${range("Maximum vessel length", "max_loa", selected.max_loa, 1, selected.length || 500, 1, " m")}${range("Maximum vessel draft", "max_draft", selected.max_draft, 0.1, 30, 0.1, " m")}${range("Safety gap", "berth_buffer", selected.buffer_hours ?? 1, 0, 168, 0.25, " h")}${select("Availability", "berth_status", ["Available", "Maintenance", "Closed"], selected.status)}<button type="button" class="btn small" id="rule-berth-details">${icon("anchor")}Cargo & equipment</button></div>` : "<p>Create a berth in Geographic configuration to set its safety limits.</p>"}<div class="form-actions"><span class="subtle">Changes are applied when you save.</span><button class="btn primary" type="submit">${icon("save")}Save safety settings</button></div></form><div class="toolbar"><h3>Cargo access rules</h3><div class="spacer"></div><div class="search-box">${icon("search")}<input id="rule-search" placeholder="Find rule, cargo or berth…" aria-label="Search cargo access rules"></div><button type="button" class="btn primary" id="rule-add">${icon("plus")}Add rule</button></div><div class="table-scroll"><table><thead><tr><th scope=\"col\">Rule</th><th scope=\"col\">When cargo matches</th><th scope=\"col\">Permitted / restricted berths</th><th scope=\"col\">Actions</th></tr></thead><tbody>${list.map((r) => `<tr data-access-rule="${esc(r.id)}" data-search="${esc([r.name, r.direction, r.product, r.grade, r.subgrade, ...(r.berth_ids || []).map((id) => S.data.berths.find((b) => b.id === id)?.code || id)].join(" ").toLowerCase())}"><td><b>${esc(r.name)}</b><br><span class="subtle">${r.enabled === false ? "Disabled" : r.effect === "allow" ? "Allow only selected berths" : "Deny selected berths"}</span></td><td>${esc([r.direction, r.product, r.grade, r.subgrade].filter(Boolean).join(" · ") || "Any cargo")}</td><td>${esc((r.berth_ids || []).map((id) => S.data.berths.find((b) => b.id === id)?.code || id).join(", "))}</td><td><button type="button" class="btn small" data-access-edit="${esc(r.id)}">Edit</button><button type="button" class="btn small danger" data-access-remove="${esc(r.id)}">Delete</button></td></tr>`).join("") || '<tr><td colspan="4">No additional cargo access rules. Physical berth compatibility still applies.</td></tr>'}</tbody></table><p id="rules-no-results" hidden>No rules match this search.</p></div><p class="catalog-source">Allow rules limit matching cargo to the union of their selected berths. Cargo without a matching Allow rule may use any physically compatible berth. Matching Deny rules always block their selected berths.</p></section>`;
}
export function bindRules(berthForm) {
  const {
    S,
    $,
    $$,
    handleForm,
    api,
    path,
    refresh,
    toast,
    modal,
    field,
    select,
    closeModal,
    esc,
  } = P();
  const p = S.data.port;
  let selected =
    S.data.berths.find((b) => b.id === S.ruleBerthId) || S.data.berths[0];
  const edits = {};
  function remember() {
    if (!selected) return;
    const f = $("#rules-form").elements;
    edits[selected.id] = {
      id: selected.id,
      revision: selected.revision,
      max_loa: Number(f.max_loa.value),
      max_draft: Number(f.max_draft.value),
      buffer_hours: Number(f.berth_buffer.value),
      status: f.berth_status.value,
    };
  }
  function sliders() {
    $$("#rules-form input[type=range]").forEach(
      (input) =>
        (input.oninput = () => {
          const output = input.closest("label").querySelector("output");
          output.textContent =
            input.value +
            (input.name.includes("draft") || input.name === "max_loa"
              ? " m"
              : " h");
        }),
    );
  }
  sliders();
  if ($("#rule-berth-select"))
    $("#rule-berth-select").onchange = (e) => {
      remember();
      selected = S.data.berths.find((b) => b.id === e.target.value);
      S.ruleBerthId = selected.id;
      const b = edits[selected.id] || selected,
        f = $("#rules-form").elements;
      for (const [name, key] of [
        ["max_loa", "max_loa"],
        ["max_draft", "max_draft"],
        ["berth_buffer", "buffer_hours"],
        ["berth_status", "status"],
      ])
        f[name].value = b[key];
      f.max_loa.max = selected.length || 500;
      $$("#rules-form input[type=range]").forEach((input) =>
        input.dispatchEvent(new Event("input")),
      );
    };
  if ($("#rule-berth-details"))
    $("#rule-berth-details").onclick = () => berthForm(selected);
  handleForm("#rules-form", async (d) => {
    remember();
    await api(path("/configuration/rules"), "POST", {
      port_revision: p.revision,
      rules: {
        ...p.rules,
        default_duration_hours: Number(d.default_duration_hours),
        buffer_hours: Number(d.buffer_hours),
        snap_minutes: Number(d.snap_minutes),
      },
      berths: Object.values(edits),
    });
    await refresh();
    toast("Planning safety settings saved");
  });
  $("#rule-search").oninput = (e) => {
    let found = 0;
    const query = e.target.value.trim().toLowerCase();
    $$("[data-access-rule]").forEach((row) => {
      row.hidden = !row.dataset.search.includes(query);
      if (!row.hidden) found++;
    });
    $("#rules-no-results").hidden = found > 0;
  };
  async function saveRules(items) {
    await api(path("/configuration/rules"), "POST", {
      port_revision: p.revision,
      rules: { ...p.rules, custom_rules: items },
      berths: [],
    });
    closeModal();
    await refresh();
    toast("Cargo access rules saved");
  }
  function builder(existing) {
    const r = existing || {
      id: "RULE-" + Date.now().toString(36),
      name: "",
      effect: "deny",
      enabled: true,
      berth_ids: [],
    };
    const catalog = p.cargo_catalog || [];
    const choice = (label, key) =>
      `<label class="field"><span>${label}</span><select name="${key}"><option value="">Any ${label.toLowerCase()}</option>${[
        ...new Set(catalog.map((c) => c[key]).filter(Boolean)),
      ]
        .sort()
        .map(
          (v) =>
            `<option value="${esc(v)}" ${r[key] === v ? "selected" : ""}>${esc(v)}</option>`,
        )
        .join("")}</select></label>`;
    modal(
      existing ? "Edit cargo access rule" : "Add cargo access rule",
      `<form id="access-rule-form"><div class="form-grid">${field("Rule name", "name", r.name, "text", 'required maxlength="160"')}${select(
        "Effect",
        "effect",
        [
          ["allow", "Allow matching cargo only at selected berths"],
          ["deny", "Deny matching cargo at selected berths"],
        ],
        r.effect,
      )}${select(
        "Rule status",
        "enabled",
        [
          ["true", "Enabled"],
          ["false", "Disabled"],
        ],
        r.enabled === false ? "false" : "true",
      )}${select(
        "Cargo flow",
        "direction",
        [
          ["", "Any flow"],
          ["Export", "Export"],
          ["Import", "Import"],
        ],
        r.direction || "",
      )}${choice("Product", "product")}${choice("Grade", "grade")}${choice("Sub-grade", "subgrade")}</div><fieldset><legend>Select berths</legend>${S.data.berths.map((b) => `<label class="check"><input type="checkbox" name="berth_ids" value="${esc(b.id)}" ${r.berth_ids.includes(b.id) ? "checked" : ""}>${esc(b.code)} · ${esc(b.name)}</label>`).join("")}</fieldset><p class="config-description">Blank cargo fields match any value. A Deny rule takes priority. Allow rules cannot override physical safety limits.</p><div class="form-actions"><button type="submit" class="btn primary">Save cargo rule</button></div></form>`,
    );
    handleForm("#access-rule-form", async (d, form) => {
      const ids = new FormData(form).getAll("berth_ids");
      if (!ids.length) throw new Error("Select at least one berth");
      const item = {
        id: r.id,
        name: d.name.trim(),
        effect: d.effect,
        enabled: d.enabled === "true",
        direction: d.direction,
        product: d.product,
        grade: d.grade,
        subgrade: d.subgrade,
        berth_ids: ids,
      };
      await saveRules([
        ...(p.rules.custom_rules || []).filter((x) => x.id !== r.id),
        item,
      ]);
    });
  }
  $("#rule-add").onclick = () => builder();
  $$("[data-access-edit]").forEach(
    (b) =>
      (b.onclick = () =>
        builder(
          (p.rules.custom_rules || []).find(
            (r) => r.id === b.dataset.accessEdit,
          ),
        )),
  );
  $$("[data-access-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        const rule = p.rules.custom_rules.find(
          (r) => r.id === b.dataset.accessRemove,
        );
        modal(
          "Delete cargo access rule",
          `<form id="delete-rule-form"><p>Delete ${esc(rule.name)}?</p><div class="form-actions"><button class="btn danger" type="submit">Delete rule</button></div></form>`,
        );
        handleForm("#delete-rule-form", () =>
          saveRules(p.rules.custom_rules.filter((r) => r.id !== rule.id)),
        );
      }),
  );
}
