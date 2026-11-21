const P = () => window.P;
export const DEFAULT_KPI_IDS = ["active", "upcoming", "utilization", "waiting", "turnaround", "adherence", "delays", "conflicts"];

function catalog() {
  return P().S.data.stats.dashboard_kpis;
}

export function currentKpiLayout() {
  const data = catalog();
  return knownCards(data, data.personal_layout ?? data.layout);
}

function knownCards(data, layout) {
  return layout.flatMap(card => {
    if (card.kpis) {
      const kpis = card.kpis.filter(id => Object.hasOwn(data.definitions, id));
      return [{...card, kpis}];
    }
    return Object.hasOwn(data.definitions, card.id) || Object.hasOwn(data.widget_catalog || {}, card.id) ? [card] : [];
  });
}

export function kpiTone(definition, value, defaultTone) {
  if (!Number.isFinite(value)) return "neutral";
  if (definition.thresholds_enabled === false) return "info";
  const thresholds = definition.thresholds;
  if (!thresholds) return defaultTone;
  const { direction, warning, danger } = thresholds;
  if (direction === "higher") return value <= danger ? "danger" : value <= warning ? "warning" : "positive";
  return value >= danger ? "danger" : value >= warning ? "warning" : "positive";
}

async function saveCatalog(definitions, layout) {
  const { S, api, path, closeModal, refresh, toast } = P();
  const data = catalog();
  const cards = knownCards({...data, definitions}, layout);
  await api(path("/dashboard"), "PUT", {revision: S.data.port.revision, definitions, layout: cards, widgets: data.widgets});
  closeModal();
  await refresh();
  toast("Dashboard settings saved.");
}

export function renderKpiConfig() {
  const { esc, can, cardHead } = P();
  if (!can("config.view")) return "";
  const data = catalog();
  if (!data) return '<div class="notice">Dashboard configuration requires the updated server.</div>';
  const editable = can("config.edit") && !window.PORTSIDE_PREVIEW_DATA;
  const actions = editable
    ? '<div class="toolbar"><button class="btn primary" data-kpi-edit="">Add KPI</button><button class="btn" id="kpi-default-layout">Edit port layout</button></div>'
    : "";
  const rows = Object.entries(data.definitions).map(([id, definition]) =>
    `<tr><td><strong>${esc(definition.name)}</strong><br><code>${esc(id)}</code></td><td>${esc(definition.formula || definition.source || "Built-in calculation")}</td><td>${esc(definition.unit || "—")}</td><td>${definition.thresholds ? esc(`${definition.thresholds.direction === "higher" ? "Higher is better" : "Lower is better"} · Amber ${definition.thresholds.warning} · Red ${definition.thresholds.danger}`) : definition.thresholds_enabled === false ? "Informational" : "Automatic"}</td>${editable ? `<td><button class="btn small" data-kpi-edit="${esc(id)}" aria-label="Edit ${esc(definition.name)}">Edit</button></td>` : ""}</tr>`
  ).join("");
  return `<section class="card">${cardHead("Dashboard KPIs", "chart-column")}${actions}<div class="table-scroll"><table><thead><tr><th scope="col">KPI / formula name</th><th scope="col">Calculation</th><th scope="col">Unit</th><th scope="col">Colors</th>${editable ? '<th scope="col">Actions</th>' : ""}</tr></thead><tbody>${rows}</tbody></table></div><div class="form-body">${variableReference(data)}</div></section>`;
}

function variableReference(data) {
  const { esc } = P();
  return `<details><summary>Formula variables</summary><dl class="kpi-variables">${Object.entries(data.variables).map(([id, label]) => `<div><dt><code>${esc(id)}</code></dt><dd>${esc(label)}</dd></div>`).join("")}</dl></details>`;
}

function editKpi(id) {
  const { $, esc, modal, handleForm, field, select, toast } = P();
  const data = catalog();
  const item = data.definitions[id] || {};
  const builtIn = DEFAULT_KPI_IDS.includes(id);
  const thresholds = item.thresholds || {};
  const mode = thresholds.direction || (item.thresholds_enabled === false || !builtIn ? "info" : "auto");
  modal(id ? "Edit KPI" : "Add KPI", `<form id="kpi-form" aria-labelledby="modal-title"><div class="form-grid">
    ${id ? `<div class="field"><label>Formula name</label><code>${esc(id)}</code></div>` : field("Formula name", "id", "", "text", 'required maxlength="40" pattern="[a-z][a-z0-9_]{0,39}"')}
    ${field("Card label", "name", item.name || "", "text", 'required maxlength="80"')}
    ${field("Unit", "unit", item.unit || "", "text", 'maxlength="12"')}
    ${field("Formula", "formula", item.formula || "", "text", `maxlength="240" ${builtIn ? `placeholder="${esc(item.source || "Built-in calculation")}"` : 'required placeholder="e.g. cargo_tonnes_export_7d / completed_export_7d"'}`)}
    ${select("Color thresholds", "mode", [...(builtIn ? [["auto", "Built-in colors"]] : []), ["info", "Informational"], ["higher", "Higher is better"], ["lower", "Lower is better"]], mode)}
    ${field("Amber threshold", "warning", thresholds.warning ?? "", "number", 'step="any"')}
    ${field("Red threshold", "danger", thresholds.danger ?? "", "number", 'step="any"')}
    </div><p class="subtle">Use numbers, parentheses, +, -, *, /, variable names, or another KPI’s formula name. Thresholds apply at and beyond the entered limits.</p>${variableReference(data)}
    <div class="form-actions">${id && !builtIn ? '<button type="button" class="btn danger" id="delete-kpi">Delete KPI</button>' : ""}<button type="submit" class="btn primary">Save KPI</button></div></form>`);
  const form = $("#kpi-form");
  const update = () => {
    const enabled = ["higher", "lower"].includes(form.elements.mode.value);
    for (const key of ["warning", "danger"]) {
      form.elements[key].disabled = !enabled;
      form.elements[key].required = enabled;
    }
  };
  form.elements.mode.onchange = update;
  update();
  handleForm("#kpi-form", async input => {
    const key = id || input.id;
    if (!id && Object.hasOwn(data.definitions, key)) throw Error("That formula name is already in use.");
    const thresholds_enabled = input.mode !== "info";
    const thresholds = ["higher", "lower"].includes(input.mode)
      ? {direction: input.mode, warning: Number(input.warning), danger: Number(input.danger)}
      : null;
    await saveCatalog({...data.definitions, [key]: {name: input.name, unit: input.unit, formula: input.formula, thresholds, thresholds_enabled}}, data.layout);
  });
  const remove = $("#delete-kpi");
  if (remove) remove.onclick = async () => {
    if (!window.confirm(`Delete ${item.name} from this port’s KPI catalog?`)) return;
    const { [id]: removed, ...remaining } = data.definitions;
    try {
      await saveCatalog(remaining, data.layout.filter(card => card.id !== id));
    } catch (error) {
      toast(error.message, true);
    }
  };
}

export function bindKpiConfig() {
  const { $, $$, can } = P();
  if (!can("config.edit")) return;
  $$("[data-kpi-edit]").forEach(button => {
    button.onclick = () => editKpi(button.dataset.kpiEdit);
  });
  const layout = $("#kpi-default-layout");
  if (layout) layout.onclick = () => {
    const { S, nav } = P();
    S.dashboardLayoutDraft = {
      key: JSON.stringify([S.user.id, S.portId]),
      layout: withWidgets(catalog(), catalog().layout, catalog().widgets),
      shared: true,
      revision: S.data.port.revision,
    };
    return nav("overview");
  };
}

function withWidgets(data, layout, configured) {
  if (configured) return layout;
  return [...layout, ...Object.entries(data.widget_catalog || {}).filter(([, widget]) => !widget.optional)
    .map(([id, {width, height}]) => ({id, width, height}))];
}

export function bindDashboardEditor(renderCards, openKpi) {
  const { $, $$, S, esc, fmt, api, path, icons, icon, modal, closeModal, toast, field, select, handleForm } = P();
  const grid = $(".dashboard-kpi-area .metrics");
  const editor = $("#dashboard-editor");
  const trigger = $('[data-action="edit-dashboard"]');
  const data = catalog();
  const widgets = data?.widget_catalog || {};
  const board = grid.closest("main");
  const panels = new Map($$("[data-overview-widget]", board).map(node => {
    const anchor = document.createComment(node.dataset.overviewWidget);
    node.before(anchor);
    return [node.dataset.overviewWidget, {node, anchor}];
  }));
  const personalized = () => data.personal_layout != null ? data.personal_widgets : data.widgets;
  const available = {...data?.definitions, ...widgets};
  const key = JSON.stringify([S.user.id, S.portId]);
  let draft = S.dashboardLayoutDraft?.key === key ? S.dashboardLayoutDraft : null;
  let gesture, frame, mapFrame, saving = false, ignoreClick = false;
  const refreshMap = () => {
    if (mapFrame) return;
    mapFrame = requestAnimationFrame(() => {
      mapFrame = null;
      if (grid.isConnected && $("#port-map")?.offsetWidth) S.map?.invalidateSize({pan: false, debounceMoveend: true});
    });
  };
  const readLayout = () => [...grid.children].filter(card => card.dataset.kpiId)
    .map(card => ({id: card.dataset.kpiId, width: Number(card.dataset.kpiWidth),
      ...(card.dataset.kpiHeight !== "1" ? {height: Number(card.dataset.kpiHeight)} : {}),
      ...(card.dataset.kpiConfig ? JSON.parse(card.dataset.kpiConfig) : {})}));
  const cardName = card => card.dataset.kpiConfig ? "KPI card" :
    available[card.dataset.kpiId]?.name ?? card.querySelector(".metric-label")?.textContent;
  const announce = message => { editor.querySelector("[role=status]").textContent = message; };
  const update = () => {
    draft.layout = readLayout();
    draft.reset = false;
  };
  const place = (node, parent, before = null) => {
    if (parent.moveBefore) parent.moveBefore(node, before);
    else parent.insertBefore(node, before);
  };
  const restore = ({node, anchor}) => {
    if (node.previousSibling !== anchor) place(node, anchor.parentNode, anchor.nextSibling);
    node.querySelectorAll(".kpi-corner").forEach(button => button.remove());
    for (const child of node.children) child.inert = false;
    for (const attr of ["data-kpi-id", "data-kpi-width", "data-kpi-height", "tabindex", "aria-label", "aria-describedby"])
      node.removeAttribute(attr);
    node.style.removeProperty("--widget-columns");
    node.style.removeProperty("--widget-rows");
  };
  function addCard(card) {
    const panel = panels.get(card.id);
    if (panel) {
      panel.node.dataset.kpiId = card.id;
      resize(panel.node, card.width, card.height ?? widgets[card.id].height, 8);
      if (draft) {
        panel.node.tabIndex = 0;
        for (const child of panel.node.children) child.inert = true;
        panel.node.setAttribute("aria-label", cardName(panel.node));
        panel.node.setAttribute("aria-describedby", "kpi-editor-help");
      }
      place(panel.node, grid);
    } else if (card.kpis) {
      const metrics = card.metrics || [];
      const members = renderCards(card.kpis.map(id => ({id, width: 1})));
      const calculated = metrics.map((item, i) => {
        const value = data.card_values?.[item.formula];
        return `<div class="metric kpi-formula-metric"><span class="metric-label">${esc(item.name)}</span><strong class="metric-value">${fmt(value, 2)}<span class="metric-unit">${Number.isFinite(value) ? esc(item.unit) : ""}</span></strong>${draft ? `<button class="btn small" type="button" data-configure-card-kpi="${i}" aria-label="Edit ${esc(item.name)}">Edit</button>` : ""}</div>`;
      }).join("");
      const canAdd = draft || (!members && !calculated && trigger);
      const config = esc(JSON.stringify({kpis: card.kpis, metrics}));
      grid.insertAdjacentHTML("beforeend", `<section class="card kpi-group" data-kpi-id="${esc(card.id)}" data-kpi-config="${config}" data-kpi-width="${card.width}" data-kpi-height="${card.height}" style="--widget-columns:${card.width};--widget-rows:${card.height}" ${draft ? 'tabindex="0" aria-label="KPI card" aria-describedby="kpi-editor-help"' : ""}><div class="card-head"><div class="card-title"><h2>KPIs</h2></div></div><div class="kpi-group-content">${members}${calculated}${canAdd ? `<button type="button" class="btn kpi-group-add" data-configure-card-kpi="">${icon("plus")}Add KPI</button>` : ""}</div></section>`);
    } else grid.insertAdjacentHTML("beforeend", renderCards([card], Boolean(draft)));
    if (draft) {
      const node = grid.lastElementChild;
      const name = esc(cardName(node));
      node.insertAdjacentHTML("beforeend", `<button class="icon-btn kpi-corner kpi-corner-remove" type="button" data-kpi-tool="remove" aria-label="Remove ${name}" title="Remove widget">${icon("x")}</button><button class="icon-btn kpi-corner kpi-corner-resize" type="button" data-kpi-tool="resize" aria-label="Resize ${name}" title="Drag or use the arrow keys to resize">${icon("move-diagonal-2")}</button>`);
    }
  }
  const paint = () => {
    const widgetMode = Boolean(draft || personalized());
    board.classList.toggle("dashboard-widget-mode", widgetMode);
    for (const panel of panels.values()) restore(panel);
    grid.replaceChildren();
    const layout = draft ? draft.layout : currentKpiLayout();
    for (const card of layout) addCard(card);
    if (!layout.length) grid.innerHTML = '<p class="kpi-empty subtle">No widgets selected.</p>';
    icons();
    refreshMap();
  };
  function finishAdding(card, layout = draft.layout) {
    draft.layout = [...layout, card];
    draft.reset = false;
    closeModal();
    paint();
    const added = grid.lastElementChild;
    added.focus();
    announce(`${cardName(added)} added to the layout.`);
  }
  function configureCardKpi(cardId, index) {
    const card = draft.layout.find(item => item.id === cardId);
    const metrics = card?.metrics || [];
    const existing = index === "" ? null : metrics[Number(index)];
    const mode = Object.hasOwn(data.definitions, existing?.formula) ? "existing" :
      Object.hasOwn(data.variables, existing?.formula) ? "variable" : existing ? "formula" : "existing";
    const choices = (items, label) => [["", label], ...Object.entries(items).map(([key, item]) => [key, item.name ?? item])];
    modal(existing ? "Edit KPI" : "Add KPI", `<form id="widget-kpi-form" aria-labelledby="modal-title">
      <div class="form-grid">
        ${select("Calculation", "mode", [["existing", "Existing KPI"], ["variable", "Platform variable"], ["formula", "Formula"]], mode)}
        ${select("KPI", "existing", choices(data.definitions, "Choose a KPI"), existing?.formula)}
        ${select("Platform variable", "variable", choices(data.variables, "Choose a variable"), existing?.formula)}
        ${field("Formula", "formula", mode === "formula" ? existing.formula : "", "text", 'maxlength="240" placeholder="e.g. active_calls + upcoming_arrivals"')}
        ${field("Label", "name", existing?.name ?? "", "text", 'required maxlength="80"')}
        ${field("Unit", "unit", existing?.unit ?? "", "text", 'maxlength="12"')}
      </div><div id="widget-kpi-reference"><p class="subtle">Use numbers, +, -, *, /, parentheses, and named KPIs or variables.</p>${variableReference(data)}</div>
      <div class="form-actions">${existing ? '<button type="button" class="btn danger" id="widget-kpi-delete">Remove KPI</button>' : ""}<button type="submit" class="btn primary">Apply KPI</button></div>
    </form>`);
    const form = $("#widget-kpi-form");
    const inputs = form.elements;
    function setMode() {
      for (const name of ["existing", "variable", "formula"]) {
        const input = inputs.namedItem(name);
        input.disabled = name !== inputs.mode.value;
        input.required = !input.disabled;
        input.closest(".field").hidden = input.disabled;
      }
      $("#widget-kpi-reference").hidden = inputs.mode.value !== "formula";
    }
    form.onchange = event => {
      if (event.target === inputs.mode) setMode();
      const source = event.target.value;
      if (event.target === inputs.existing && Object.hasOwn(data.definitions, source)) {
        if (!inputs.name.value) inputs.name.value = data.definitions[source].name;
        if (!inputs.unit.value) inputs.unit.value = data.definitions[source].unit;
      }
      if (event.target === inputs.variable && Object.hasOwn(data.variables, source) && !inputs.name.value)
        inputs.name.value = data.variables[source].slice(0, 80);
    };
    function apply(next) {
      draft.layout = draft.layout.map(item => item.id === cardId ? {...item, metrics: next} : item);
      draft.reset = false;
      closeModal();
      paint();
      grid.querySelector(`[data-kpi-id="${CSS.escape(cardId)}"] [data-configure-card-kpi=""]`)?.focus();
    }
    setMode();
    handleForm("#widget-kpi-form", async input => {
      if (!existing && metrics.length >= 12) throw Error("Keep at most 12 configured KPIs in one card.");
      const result = await api(path("/dashboard/kpi-preview"), "POST", {name: input.name, unit: input.unit, formula: input[input.mode]});
      data.card_values = {...data.card_values, [result.metric.formula]: result.value};
      const next = [...metrics];
      if (existing) next[Number(index)] = result.metric;
      else next.push(result.metric);
      apply(next);
    });
    const remove = $("#widget-kpi-delete");
    if (remove) remove.onclick = () => apply(metrics.filter((_, i) => i !== Number(index)));
  }
  function showWidgetPicker() {
    const items = Object.entries(widgets).filter(([id]) => panels.has(id));
    const option = (id, name, placed = false) => `<article class="widget-option">
      <div class="widget-preview" data-preview="${esc(id)}" inert aria-hidden="true"></div>
      <div class="widget-option-footer">
        <span class="widget-option-label"><strong>${esc(name)}</strong>${placed ? "<small>On dashboard</small>" : ""}</span>
        <button class="widget-option-action" type="button" data-widget-choice="${esc(id)}" aria-label="${esc(placed ? `${name} is on the dashboard` : `Add ${name}`)}" ${placed ? "disabled" : ""}>${icon(placed ? "check" : "plus")}</button>
      </div>
      </article>`;
    modal("Add widget", `<div class="widget-picker">${option("kpi", "KPI card")}
      ${items.map(([id, item]) => option(id, item.name, draft.layout.some(card => card.id === id))).join("")}
      </div>`, true);
    const picker = $(".widget-picker");
    picker.closest("dialog").classList.add("widget-picker-dialog");
    for (const preview of $$("[data-preview]", picker)) {
      const source = panels.get(preview.dataset.preview)?.node;
      const stage = document.createElement("div");
      stage.className = "widget-preview-stage hmi-main";
      stage.dataset.page = "overview";
      if (source) {
        const copy = source.cloneNode(true);
        for (const element of $$("[id]", copy)) element.removeAttribute("id");
        for (const element of $$(".kpi-corner, .leaflet-control-container, .leaflet-popup-pane", copy)) element.remove();
        for (const row of $$("tbody tr:nth-child(n+5)", copy)) row.remove();
        stage.append(copy);
      } else {
        stage.innerHTML = `<section class="card kpi-group"><div class="card-head"><div class="card-title"><h2>KPIs</h2></div></div><div class="kpi-group-content"><span class="btn kpi-group-add">${icon("plus")}Add KPI</span></div></section>`;
      }
      preview.append(stage);
    }
    icons();
    picker.onclick = event => {
      const choice = event.target.closest("[data-widget-choice]")?.dataset.widgetChoice;
      if (!choice) return;
      if (choice === "kpi") return finishAdding({id: `kpi_group_${crypto.randomUUID()}`, kpis: [], metrics: [], width: 2, height: 2});
      const {width, height} = widgets[choice];
      finishAdding({id: choice, width, height});
    };
  }
  function show() {
    editor.hidden = false;
    grid.classList.add("metrics-editing");
    trigger.setAttribute("aria-pressed", "true");
    editor.innerHTML = `<div class="kpi-editor-bar">
      ${draft.shared ? "<strong>Editing port default</strong>" : ""}
      <button class="btn" type="button" data-editor="add">${icon("plus")}Add widget</button>
      <div class="kpi-editor-actions">
        ${draft.shared ? "" : '<button class="btn" type="button" data-editor="reset">Use port default</button>'}
        <button class="btn" type="button" data-editor="cancel">Cancel</button>
        <button class="btn primary" type="button" data-editor="save">Save layout</button>
      </div>
    </div><div class="subtle kpi-editor-help" id="kpi-editor-help">Drag a card to move it, or focus it and use the arrow keys. Drag its lower-right corner to resize.</div><div role="status" class="sr-only"></div>`;
    paint();
  }
  function close() {
    endGesture(false);
    if (S.dashboardLayoutDraft === draft) delete S.dashboardLayoutDraft;
    draft = null;
    editor.hidden = true;
    grid.classList.remove("metrics-editing");
    trigger.setAttribute("aria-pressed", "false");
    paint();
    trigger.focus();
  }
  const gridColumns = style => Number(style.getPropertyValue("--widget-grid-columns"));
  const widthStep = card => widgets[card.dataset.kpiId]?.width_step ?? 1;
  function sizeBounds(card, columns) {
    const widget = panels.has(card.dataset.kpiId) ? widgets[card.dataset.kpiId] : card.dataset.kpiConfig ? {min_width: 2, min_height: 2} : null;
    return {
      minWidth: Math.min(columns, widget?.min_width ?? 1),
      maxWidth: Math.min(columns, widget ? 8 : 4),
      minHeight: widget?.min_height ?? 1,
      maxHeight: widget ? 4 : 2,
    };
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function resize(card, width, height, columns = gridColumns(getComputedStyle(grid))) {
    const { minWidth, maxWidth, minHeight, maxHeight } = sizeBounds(card, columns);
    const nextWidth = String(clamp(width, minWidth, maxWidth));
    const nextHeight = String(clamp(height, minHeight, maxHeight));
    if (card.dataset.kpiWidth === nextWidth && card.dataset.kpiHeight === nextHeight) return;
    card.dataset.kpiWidth = nextWidth;
    card.dataset.kpiHeight = nextHeight;
    card.style.setProperty("--widget-columns", nextWidth);
    card.style.setProperty("--widget-rows", nextHeight);
    if (card.dataset.kpiId === "widget_map") refreshMap();
  }
  function announceSize(card) {
    announce(`${cardName(card)}: ${card.dataset.kpiWidth} columns by ${card.dataset.kpiHeight} rows.`);
  }
  function move(card, target) {
    const cards = [...grid.children];
    const before = cards.indexOf(card) < cards.indexOf(target) ? target.nextElementSibling : target;
    place(card, grid, before);
    refreshMap();
    update();
    announce(`${cardName(card)} moved to position ${[...grid.children].indexOf(card) + 1}.`);
  }

  grid.onclick = event => {
    const config = event.target.closest("[data-configure-card-kpi]");
    if (config && trigger && !saving) {
      const id = config.closest(".kpi-group").dataset.kpiId;
      const index = config.dataset.configureCardKpi;
      if (!draft) trigger.click();
      return configureCardKpi(id, index);
    }
    if (!draft) {
      const button = event.target.closest("button[data-metric]");
      if (button) openKpi(button);
      return;
    }
    const button = event.target.closest("[data-kpi-tool]");
    if (!button || saving || ignoreClick) return;
    const card = button.closest("[data-kpi-id]");
    if (button.dataset.kpiTool === "resize") {
      const {minHeight, maxHeight} = sizeBounds(card, 8);
      const height = Number(card.dataset.kpiHeight);
      resize(card, Number(card.dataset.kpiWidth), height === maxHeight ? minHeight : height + 1, 8);
      update();
      announceSize(card);
    }
    if (button.dataset.kpiTool === "remove") {
      const name = cardName(card);
      const next = card.nextElementSibling || card.previousElementSibling;
      const panel = panels.get(card.dataset.kpiId);
      if (panel) restore(panel);
      else card.remove();
      refreshMap();
      update();
      if (!draft.layout.length) paint();
        (next?.querySelector('[data-kpi-tool="remove"]') || editor.querySelector('[data-editor="add"]')).focus();
      announce(`${name} removed from the layout.`);
    }
  };
  if (!trigger) {
    if (data && personalized()) paint();
    return;
  }

  trigger.setAttribute("aria-pressed", "false");
  trigger.setAttribute("aria-controls", "dashboard-editor");
  trigger.onclick = () => {
    if (draft) {
      editor.querySelector('[data-editor="add"]')?.focus();
      return;
    }
    draft = S.dashboardLayoutDraft = {key, layout: withWidgets(data, currentKpiLayout(), personalized()), reset: false};
    show();
    editor.querySelector('[data-editor="add"]').focus();
  };
  editor.onclick = async event => {
    const button = event.target.closest("[data-editor]");
    if (!button || !draft || saving) return;
    const action = button.dataset.editor;
    if (action === "cancel") return close();
    if (action === "reset") {
      draft.layout = withWidgets(data, data.layout, data.widgets);
      draft.reset = true;
      paint();
        announce("Port default previewed. Save layout to apply it.");
    }
    if (action === "add") return showWidgetPicker();
    if (action === "save") {
      saving = button.disabled = true;
      try {
        if (draft.shared) {
          const result = await api(path("/dashboard"), "PUT", {
            revision: draft.revision, definitions: data.definitions, layout: draft.layout, widgets: true,
          });
          data.layout = result.layout;
          data.widgets = result.widgets;
          S.data.port.revision = draft.revision + 1;
        } else {
          const result = await api(path("/dashboard/layout"), "PUT", {layout: draft.reset ? null : draft.layout, widgets: true});
          data.personal_layout = result.layout;
          data.personal_widgets = result.widgets;
        }
        close();
        toast("Dashboard layout saved.");
      } catch (error) {
        toast(error.message, true);
      } finally {
        saving = button.disabled = false;
      }
    }
  };
  grid.onkeydown = event => {
    const card = event.target.closest(".metrics > [data-kpi-id]");
    if (!draft || !card || saving) return;
    if (gesture && event.key === "Escape") {
      event.preventDefault();
      endGesture(false);
      return;
    }
    const resizing = event.target.dataset.kpiTool === "resize";
    if ((!resizing && event.target !== card) || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const style = getComputedStyle(grid);
    const rtl = style.direction === "rtl";
    const backward = event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft");
    if (resizing) {
      const delta = backward ? -1 : 1;
      const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
      const columns = horizontal ? gridColumns(style) : 8;
      const width = horizontal ? Math.min(Number(card.dataset.kpiWidth), columns) + delta * widthStep(card) :
        Number(card.dataset.kpiWidth);
      resize(card, width, Number(card.dataset.kpiHeight) + (horizontal ? 0 : delta), columns);
      update();
      announceSize(card);
    } else {
      const target = backward ? card.previousElementSibling : card.nextElementSibling;
      if (target) move(card, target);
      card.focus();
    }
  };
  grid.onpointerdown = event => {
    const card = event.target.closest(".metrics > [data-kpi-id]");
    const button = event.target.closest("button");
    if (!draft || !card || (button && button.dataset.kpiTool !== "resize") || gesture || saving || event.button !== 0 || !event.isPrimary) return;
    const handle = button || card;
    let sizing;
    if (button) {
      const style = getComputedStyle(grid);
      const rect = card.getBoundingClientRect();
      const columns = gridColumns(style);
      const visibleWidth = Math.min(Number(card.dataset.kpiWidth), columns);
      const rows = Number(card.dataset.kpiHeight);
      const stepX = (rect.width + parseFloat(style.columnGap)) / visibleWidth;
      const stepY = (rect.height + parseFloat(style.rowGap)) / rows;
      sizing = { ...sizeBounds(card, columns), rows, visibleWidth,
        width: rect.width, height: rect.height, stepX, stepY };
    }
    ignoreClick = false;
    gesture = {handle, card, id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, scrollTop: grid.scrollTop, sizing};
    handle.setPointerCapture(event.pointerId);
  };
  const track = () => {
    frame = null;
    if (!gesture?.active || !grid.isConnected) return;
    const {card, x, y, sizing, startX, startY} = gesture;
    if (sizing) {
      const {width, height, visibleWidth, rows, stepX, stepY, minWidth, maxWidth, minHeight, maxHeight} = sizing;
      const dx = clamp(x - startX, (minWidth - visibleWidth) * stepX, (maxWidth - visibleWidth) * stepX);
      const dy = clamp(y - startY + grid.scrollTop - gesture.scrollTop, (minHeight - rows) * stepY, (maxHeight - rows) * stepY);
      if (dx === sizing.dx && dy === sizing.dy) return;
      sizing.dx = dx;
      sizing.dy = dy;
      card.style.width = `${width + dx}px`;
      card.style.height = `${height + dy}px`;
      if (card.dataset.kpiId === "widget_map") refreshMap();
      return;
    }
    const bounds = grid.getBoundingClientRect();
    const edge = y < bounds.top + 24 ? -8 : y > bounds.bottom - 24 ? 8 : 0;
    const scroll = grid.scrollTop;
    if (edge) grid.scrollTop += edge;
    card.style.translate = `${x - startX}px ${y - startY + grid.scrollTop - gesture.scrollTop}px`;
    const hitY = Math.max(bounds.top + 1, Math.min(y, bounds.bottom - 1));
    const target = document.elementFromPoint(x, hitY)?.closest(".metrics > [data-kpi-id]");
    if (gesture.target !== target) {
      gesture.target?.removeAttribute("data-kpi-drop");
      gesture.target = target && target !== card && grid.contains(target) ? target : null;
      if (gesture.target) {
        const after = [...grid.children].indexOf(card) < [...grid.children].indexOf(gesture.target);
        gesture.target.dataset.kpiDrop = after ? "after" : "before";
      }
    }
    if (grid.scrollTop !== scroll) frame = requestAnimationFrame(track);
  };
  function endGesture(commit) {
    if (!gesture) return;
    const {handle, id, card, target, active, sizing} = gesture;
    gesture = null;
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    target?.removeAttribute("data-kpi-drop");
    card.removeAttribute("data-kpi-dragging");
    card.style.removeProperty("translate");
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    if (!active) return;
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 0);
    if (sizing) {
      card.removeAttribute("data-kpi-resizing");
      card.style.removeProperty("width");
      card.style.removeProperty("height");
      if (commit) {
        const step = widthStep(card);
        const columns = Math.round(sizing.dx / (sizing.stepX * step)) * step;
        const width = columns ? sizing.visibleWidth + columns : Number(card.dataset.kpiWidth);
        resize(card, width, sizing.rows + Math.round(sizing.dy / sizing.stepY), 8);
        update();
        announceSize(card);
      }
      if (card.dataset.kpiId === "widget_map") refreshMap();
    } else if (commit && target) move(card, target);
  }
  grid.onpointermove = event => {
    if (gesture?.id !== event.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      gesture.active = true;
      if (gesture.sizing) gesture.card.dataset.kpiResizing = "";
      else gesture.card.dataset.kpiDragging = "";
    }
    if (!frame) frame = requestAnimationFrame(track);
  };
  grid.onpointerup = event => {
    if (gesture?.id !== event.pointerId) return;
    if (frame) cancelAnimationFrame(frame);
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    track();
    endGesture(true);
  };
  grid.onpointercancel = grid.onlostpointercapture = event => {
    if (gesture?.id === event.pointerId) endGesture(false);
  };
  if (draft) {
    draft.layout = knownCards(data, draft.layout);
    show();
  } else if (personalized()) paint();
}
