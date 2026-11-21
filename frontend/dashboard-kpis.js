import { insertWidget, MAX_WIDGET_ROW, rowMajor, snapWidgetTrack, occupiedWidgetColumns } from "./dashboard-grid.js";

const P = () => window.P;
export const DEFAULT_KPI_IDS = ["active", "upcoming", "utilization", "waiting", "turnaround", "adherence", "delays", "conflicts"];

function catalog() {
  return P().S.data.stats.dashboard_kpis;
}

export function currentKpiLayout() {
  const data = catalog();
  return knownCards(data, data.personal_layout ?? data.layout);
}

function fitCardPreset(card, width, height) {
  const expanded = width > card.width || height > (card.height ?? 1);
  return {...card, width, height, position: expanded ? undefined : card.position};
}

function knownCards(data, layout) {
  return layout.flatMap(card => {
    if (card.id === "widget_weather") {
      const full = card.width > 3 || (card.width === 2 && card.height > 1);
      return [fitCardPreset(card, full ? 5 : 3, full ? 2 : 1)];
    }
    if (card.kpis) {
      const kpis = card.kpis.filter(id => Object.hasOwn(data.definitions, id));
      const group = {...card, kpis};
      return [!kpis.length && (card.metrics?.length ?? 0) <= 1
        ? fitCardPreset(group, card.width > 1 || card.height > 1 ? 2 : 1, 1)
        : group];
    }
    if (card.id === "widget_clock") return []; // merged into the weather card
    if (Object.hasOwn(data.definitions, card.id))
      return [fitCardPreset(card, card.width > 1 || card.height > 1 ? 2 : 1, 1)];
    return Object.hasOwn(data.widget_catalog || {}, card.id) ? [card] : [];
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

async function saveVariables(custom, descriptions) {
  const { S, api, path, closeModal, refresh, toast } = P();
  const data = catalog();
  await api(path("/dashboard"), "PUT", {
    revision: S.data.port.revision,
    definitions: data.definitions,
    layout: knownCards(data, data.layout),
    widgets: data.widgets,
    custom_variables: custom,
    variable_descriptions: descriptions,
  });
  closeModal();
  await refresh();
  toast("Platform variables saved.");
}

export function renderKpiConfig() {
  const { esc, can, cardHead, fmt } = P();
  if (!can("config.view")) return "";
  const data = catalog();
  if (!data) return '<div class="notice">Dashboard configuration requires the updated server.</div>';
  const editable = can("config.edit") && !window.PORTSIDE_PREVIEW_DATA;
  const builtin = new Set(data.builtin_variables || []);
  const toolbar = editable ? '<div class="toolbar variable-toolbar"><button class="btn primary" data-variable-add="">Add variable</button></div>' : "";
  const variableRows = Object.entries(data.variables || {}).map(([id, description]) => {
    const raw = data.variable_values?.[id];
    const value = Number.isFinite(raw) ? fmt(raw, raw % 1 ? 2 : 0) : "—";
    const controls = editable
      ? `<button class="btn small" data-variable-edit="${esc(id)}" aria-label="Edit ${esc(id)}">Edit</button>${builtin.has(id) ? "" : `<button class="btn small danger" data-variable-delete="${esc(id)}" aria-label="Delete ${esc(id)}">Delete</button>`}`
      : "";
    const mark = data.custom_variables?.[id]?.formula ? '<span class="formula-mark" title="Calculated from a formula">fx</span>' : "";
    return `<tr><td><span class="variable-tag">${esc(id)}</span></td><td><strong>${esc(data.variable_names?.[id] || id)}</strong></td><td>${esc(description)}</td><td>${esc(data.variable_types?.[id] || "—")}</td><td>${esc(data.variable_units?.[id] || "—")}</td><td class="variable-value">${mark}${value}</td>${editable ? `<td class="variable-actions">${controls}</td>` : ""}</tr>`;
  }).join("");
  return `<section class="card">${cardHead("Platform variables", "table")}${toolbar}<div class="table-scroll"><table class="platform-variables-table"><thead><tr><th scope="col">Tag</th><th scope="col">Variable name</th><th scope="col">Description</th><th scope="col">Type</th><th scope="col">Unit</th><th scope="col">Value</th>${editable ? '<th scope="col">Actions</th>' : ""}</tr></thead><tbody>${variableRows}</tbody></table></div></section>`;
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

function editVariable(id) {
  const { $, esc, modal, handleForm, field, select, toast } = P();
  const data = catalog();
  const builtin = new Set(data.builtin_variables || []);
  const locked = builtin.has(id);
  const custom = {...(data.custom_variables || {})};
  const descriptions = {...(data.variable_descriptions || {})};
  const item = id ? (locked ? {} : custom[id] || {}) : {};
  const staticField = (label, value) => `<div class="field"><label>${label}</label><div class="static-field">${esc(value ?? "—")}</div></div>`;
  const identity = id
    ? staticField("Tag", id) + (locked
      ? staticField("Variable name", data.variable_names?.[id])
      : field("Variable name", "name", item.name || "", "text", 'required maxlength="80"'))
    : `${field("Tag", "id", "", "text", 'required maxlength="40" pattern="[a-z][a-z0-9_]{0,39}" placeholder="e.g. target_berths"')}
       ${field("Variable name", "name", "", "text", 'required maxlength="80"')}`;
  const source = locked
    ? staticField("Value", data.variable_values?.[id])
    : `${select("Value source", "mode", [["value", "Fixed value"], ["formula", "Formula"]], item.formula ? "formula" : "value")}
       <div class="field" data-mode="value"><label for="f-value">Value</label><input id="f-value" name="value" type="number" step="any" value="${esc(item.value ?? "")}"></div>
       <div class="field formula-field" data-mode="formula" hidden><label for="f-formula">Formula</label>
         <div class="formula-input"><input id="f-formula" name="formula" type="text" maxlength="240" autocomplete="off"
           value="${esc(item.formula || "")}" placeholder="Type @ to insert a variable tag">
           <div class="formula-mentions" id="formula-mentions" role="listbox" aria-label="Variable tags" hidden></div>
         </div>
         <p class="subtle">Type @ then pick a tag. Use + - * / and parentheses, e.g. @active_calls / @configured_berths.</p>
       </div>`;
  const metadata = locked
    ? staticField("Type", data.variable_types?.[id]) + staticField("Unit", data.variable_units?.[id]) + source
    : `${select("Type", "type", ["Count", "Percent", "Duration", "Quantity"], item.type || "Count")}
       ${field("Unit", "unit", item.unit || "", "text", 'maxlength="12" placeholder="e.g. calls"')}
       ${source}`;
  modal(id ? "Edit variable" : "Add variable", `<form id="variable-form" aria-labelledby="modal-title"><div class="form-grid">
    ${identity}
    ${field("Description", "description", item.description || (locked ? data.variables?.[id] || "" : ""), "text", 'required maxlength="240"')}
    ${metadata}
    </div><p class="subtle">Variables can be referenced by KPI formulas. Platform variables cannot be removed; only their description can change.</p>
    <div class="form-actions">${id && !locked ? '<button type="button" class="btn danger" id="delete-variable">Delete variable</button>' : ""}<button type="submit" class="btn primary">Save variable</button></div></form>`);
  const form = $("#variable-form");
  const formula = $("#f-formula");
  const menu = $("#formula-mentions");
  const tags = Object.keys(data.variables || {});
  const dialog = form?.closest("dialog");
  let matches = [], active = -1, start = -1;
  const close = () => {
    if (menu) { menu.hidden = true; menu.innerHTML = ""; }
    matches = []; active = -1; start = -1;
  };
  const place = () => {
    if (!menu || menu.hidden) return;
    const rect = formula.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 10;
    const above = rect.top - 10;
    menu.style.maxHeight = `${Math.max(120, Math.min(180, Math.max(below, above) - 8))}px`;
    const height = menu.offsetHeight;
    const top = below >= height || above < below ? rect.bottom + 6 : above - height;
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  };
  const highlight = () => menu.querySelectorAll(".formula-mention").forEach((node, index) => node.classList.toggle("active", index === active));
  const offer = query => {
    const needle = query.toLowerCase();
    matches = tags.filter(tag => tag.toLowerCase().includes(needle)
      || (data.variable_names?.[tag] || "").toLowerCase().includes(needle)).slice(0, 6);
    if (!matches.length) { close(); return; }
    active = 0;
    menu.innerHTML = `<div class="formula-mention-head"><span>Variables</span><span>↑↓ · Enter · Esc</span></div>`
      + matches.map((tag, index) =>
        `<button type="button" role="option" class="formula-mention${index === 0 ? " active" : ""}" data-tag="${esc(tag)}"><code>@${esc(tag)}</code><small>${esc(data.variable_names?.[tag] || "")}</small></button>`).join("");
    menu.hidden = false;
    place();
  };
  const update = () => {
    const isFormula = form.elements.mode?.value === "formula";
    for (const node of form.querySelectorAll("[data-mode]")) node.hidden = node.dataset.mode !== (isFormula ? "formula" : "value");
    if (form.elements.value) { form.elements.value.disabled = isFormula; form.elements.value.required = !isFormula; }
    if (formula) { formula.disabled = !isFormula; formula.required = isFormula; if (!isFormula) close(); }
  };
  if (form.elements.mode) { form.elements.mode.onchange = update; update(); }
  if (formula && menu) {
    const scan = () => {
      const caret = formula.selectionStart ?? formula.value.length;
      const before = formula.value.slice(0, caret);
      const at = before.lastIndexOf("@");
      if (at < 0) { close(); return; }
      const query = before.slice(at + 1);
      if (/[\s@()+\-*/]/.test(query)) { close(); return; }
      start = at;
      offer(query);
    };
    const choose = tag => {
      const caret = formula.selectionStart ?? formula.value.length;
      const head = formula.value.slice(0, start);
      const tail = formula.value.slice(caret);
      formula.value = `${head}${tag}${tail}`;
      const position = head.length + tag.length;
      formula.focus();
      formula.setSelectionRange(position, position);
      close();
    };
    formula.addEventListener("input", scan);
    formula.addEventListener("click", scan);
    formula.addEventListener("blur", close);
    formula.addEventListener("keydown", event => {
      if (menu.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        highlight();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(matches[active]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    menu.addEventListener("mousedown", event => event.preventDefault());
    menu.addEventListener("click", event => {
      const button = event.target.closest("[data-tag]");
      if (button) choose(button.dataset.tag);
    });
    dialog?.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    dialog?.addEventListener("close", () => {
      dialog.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    }, { once: true });
  }
  handleForm("#variable-form", async input => {
    const base = {name: input.name, description: input.description, type: input.type, unit: input.unit};
    const value = input.mode === "formula" ? {formula: input.formula} : {value: Number(input.value)};
    if (!id) {
      const key = input.id;
      if (builtin.has(key) || Object.hasOwn(custom, key)) throw Error("That tag is already in use.");
      custom[key] = {...base, ...value};
    } else if (locked) {
      descriptions[id] = input.description;
    } else {
      custom[id] = {...base, ...value};
    }
    await saveVariables(custom, descriptions);
  });
  const remove = $("#delete-variable");
  if (remove) remove.onclick = async () => {
    if (!window.confirm(`Delete ${item.name || id}?`)) return;
    const {[id]: removed, ...remaining} = custom;
    try {
      await saveVariables(remaining, descriptions);
    } catch (error) {
      toast(error.message, true);
    }
  };
}

export function bindKpiConfig() {
  const { $, $$, can, toast } = P();
  if (!can("config.edit")) return;
  const deleteVariable = id => {
    const data = catalog();
    if (!window.confirm(`Delete ${data.variable_names?.[id] || id}?`)) return;
    const {[id]: removed, ...remaining} = data.custom_variables || {};
    saveVariables(remaining, {...(data.variable_descriptions || {})}).catch(error => toast(error.message, true));
  };
  $$("[data-variable-add]").forEach(button => { button.onclick = () => editVariable(""); });
  $$("[data-variable-edit]").forEach(button => { button.onclick = () => editVariable(button.dataset.variableEdit); });
  $$("[data-variable-delete]").forEach(button => { button.onclick = () => deleteVariable(button.dataset.variableDelete); });
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

function sameLayout(left, right) {
  const signature = cards => JSON.stringify(cards.map(({id, width, height = 1, kpis = [], metrics = [], position = null}) =>
    [id, width, height, kpis, metrics, position]));
  return signature(left) === signature(right);
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
      ...(card.dataset.kpiConfig ? JSON.parse(card.dataset.kpiConfig) : {}),
      ...(card.dataset.widgetPosition ? {position: JSON.parse(card.dataset.widgetPosition)} : {})}));
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
    setPosition(node, null);
  };
  const addKpiButton = () => `<button type="button" class="btn kpi-group-add" data-configure-card-kpi="">${icon("plus")}Add KPI</button>`;
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
      const height = card.height ?? 1;
      const compact = !card.kpis.length && metrics.length <= 1;
      const members = renderCards(card.kpis.map(id => ({id, width: 1})));
      const toneFor = item => kpiTone(data.definitions[item.formula] || {}, data.card_values?.[item.formula], "info");
      const calculated = metrics.map((item, i) => {
        const value = data.card_values?.[item.formula];
        const hasValue = Number.isFinite(value);
        const glyph = data.card_icons?.includes(item.icon) ? item.icon : "";
        const tone = toneFor(item);
        return `${compact ? "" : `<div class="metric kpi-formula-metric" data-tone="${tone}">`}<div class="metric-top"><span class="metric-label">${esc(item.name)}</span>${glyph ? `<span class="metric-icon" aria-hidden="true">${icon(glyph)}</span>` : ""}</div><strong class="metric-value">${hasValue ? fmt(value, value % 1 ? 2 : 0) : "—"}<span class="metric-unit">${hasValue ? esc(item.unit) : ""}</span></strong>${hasValue ? "" : '<span class="metric-foot">Unavailable</span>'}${draft ? `<button class="${compact ? "icon-btn kpi-corner kpi-corner-edit" : "btn small"}" type="button" data-configure-card-kpi="${i}" aria-label="Edit ${esc(item.name)}" title="Edit ${esc(item.name)}">${compact ? icon("pencil") : "Edit"}</button>` : ""}${compact ? "" : "</div>"}`;
      }).join("");
      const canAdd = compact ? !metrics.length && trigger : draft;
      const config = esc(JSON.stringify({kpis: card.kpis, metrics}));
      const add = canAdd ? addKpiButton() : "";
      const content = compact ? calculated || add : `<div class="card-head"><div class="card-title"><h2>KPIs</h2></div></div><div class="kpi-group-content">${members}${calculated}${add}</div>`;
      grid.insertAdjacentHTML("beforeend", `<section class="${compact ? "metric kpi-formula-metric kpi-single" : "card"} kpi-group" ${compact ? `data-tone="${metrics.length ? toneFor(metrics[0]) : "neutral"}"` : ""} data-kpi-id="${esc(card.id)}" data-kpi-config="${config}" data-kpi-width="${card.width}" data-kpi-height="${height}" style="--widget-columns:${card.width};--widget-rows:${height}" ${draft ? 'tabindex="0" aria-label="KPI card" aria-describedby="kpi-editor-help"' : ""}>${content}</section>`);
    } else grid.insertAdjacentHTML("beforeend", renderCards([card], Boolean(draft)));
    setPosition(grid.lastElementChild, card.position);
    if (draft) {
      const node = grid.lastElementChild;
      const name = esc(cardName(node));
      node.insertAdjacentHTML("beforeend", `<button class="icon-btn kpi-corner kpi-corner-remove" type="button" data-kpi-tool="remove" aria-label="Remove ${name}" title="Remove widget">${icon("x")}</button><button class="icon-btn kpi-corner kpi-corner-resize" type="button" data-kpi-tool="resize" aria-label="Resize ${name}" title="Drag or use the arrow keys to resize">${icon("move-diagonal-2")}</button>`);
    }
  }
  let layoutTracks, legacyTracks;
  const compatibleTracks = positions => Math.max(0, ...positions
    .filter(position => position?.tracks <= layoutTracks).map(position => position.tracks));
  function sizeGrid(layout = [...grid.children].map(card => ({
    position: card.dataset.widgetPosition ? JSON.parse(card.dataset.widgetPosition) : null,
    height: Number(card.dataset.kpiHeight || 1),
  }))) {
    const style = getComputedStyle(grid);
    const scale = Number(style.getPropertyValue("--ui-font-scale")) || 1;
    const width = grid.getBoundingClientRect().width;
    const boardTracks = Math.max(0, ...layout.map(card => card.position?.tracks ?? 0));
    const columns = boardTracks
      ? Math.max(2, Math.min(64, Math.round(boardTracks / 2)))
      : Math.max(2, Math.min(64, Math.floor((width - 34) / (Math.max(112, 108 * scale) + 18))));
    grid.style.setProperty("--widget-grid-columns", columns);
    const tracks = columns * 2;
    const trackWidth = parseFloat(getComputedStyle(grid).gridTemplateColumns);
    const widthBased = trackWidth > 0 ? trackWidth * 2 + (parseFloat(style.columnGap) || 0) : 112;
    const rows = Math.max(1, ...layout.map(card => (card.position?.row ?? 1) + (card.height ?? 1) - 1));
    const gap = parseFloat(style.rowGap) || 0;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const fitted = (grid.clientHeight - padding - (rows - 1) * gap) / rows;
    // Editing needs breathing room for the per-card controls; viewing fits the window.
    const minimum = grid.classList.contains("metrics-editing") ? Math.max(112, 108 * scale) : 72;
    const rowSize = layout.some(card => card.position) && Number.isFinite(fitted) && fitted > 0
      ? Math.max(minimum, fitted)
      : widthBased;
    grid.style.setProperty("--widget-row-size", `${rowSize}px`);
    return tracks;
  }
  const paint = () => {
    const scrollTop = grid.scrollTop;
    board.classList.add("dashboard-widget-mode");
    for (const panel of panels.values()) restore(panel);
    grid.replaceChildren();
    const layout = draft ? draft.layout : withWidgets(data, currentKpiLayout(), personalized());
    layoutTracks = sizeGrid(layout);
    legacyTracks = compatibleTracks(layout.map(card => card.position));
    for (const card of layout) addCard(card);
    grid.scrollTop = scrollTop;
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
  function iconPicker(label, name, keys, value = "") {
    const options = [{key: "", label: "None", glyph: "circle-slash"},
      ...keys.map(key => ({key, label: key.replaceAll("-", " "), glyph: key}))];
    return `<div class="field full icon-picker-field">
      <label id="f-${name}-label" for="f-${name}">${esc(label)}</label>
      <input type="hidden" id="f-${name}" name="${name}" value="${esc(value)}">
      <div class="icon-picker" role="radiogroup" aria-labelledby="f-${name}-label">
        ${options.map(o => `<button type="button" class="icon-option${o.key === value ? " selected" : ""}" data-icon-value="${esc(o.key)}" role="radio" aria-checked="${o.key === value}" aria-label="${esc(o.label)}" title="${esc(o.label)}" tabindex="${o.key === value ? 0 : -1}">${icon(o.glyph)}</button>`).join("")}
      </div>
    </div>`;
  }
  function bindIconPicker(form, name) {
    const input = form.elements.namedItem(name);
    const group = input.closest(".icon-picker-field").querySelector(".icon-picker");
    const options = [...group.querySelectorAll(".icon-option")];
    const choose = option => {
      input.value = option.dataset.iconValue;
      for (const o of options) {
        const active = o === option;
        o.classList.toggle("selected", active);
        o.setAttribute("aria-checked", String(active));
        o.tabIndex = active ? 0 : -1;
      }
    };
    group.addEventListener("click", e => {
      const option = e.target.closest(".icon-option");
      if (option) choose(option);
    });
    group.addEventListener("keydown", e => {
      const index = options.indexOf(document.activeElement);
      if (index < 0) return;
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[e.key];
      if (!step) return;
      e.preventDefault();
      const next = options[(index + step + options.length) % options.length];
      choose(next);
      next.focus();
    });
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
        ${iconPicker("Icon", "glyph", data.card_icons || [], existing?.icon ?? "")}
      </div><div id="widget-kpi-reference"><p class="subtle">Use numbers, +, -, *, /, parentheses, and named KPIs or variables.</p>${variableReference(data)}</div>
      <div class="form-actions">${existing ? '<button type="button" class="btn danger" id="widget-kpi-delete">Remove KPI</button>' : ""}<button type="submit" class="btn primary">Apply KPI</button></div>
    </form>`);
    const form = $("#widget-kpi-form");
    const inputs = form.elements;
    bindIconPicker(form, "glyph");
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
      const result = await api(path("/dashboard/kpi-preview"), "POST", {name: input.name, unit: input.unit, formula: input[input.mode], icon: input.glyph});
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
        if (preview.dataset.preview === "widget_map") {
          for (const element of $$(".map-top-left, .map-right-controls, .map-weather, .map-legend, .port-map-empty-state", copy))
            element.remove();
        }
        stage.append(copy);
      } else {
        stage.innerHTML = `<section class="metric kpi-formula-metric kpi-single kpi-group" data-tone="neutral">${addKpiButton()}</section>`;
      }
      preview.append(stage);
    }
    icons();
    picker.onclick = event => {
      const choice = event.target.closest("[data-widget-choice]")?.dataset.widgetChoice;
      if (!choice) return;
      if (choice === "kpi") return finishAdding({id: `kpi_group_${crypto.randomUUID()}`, kpis: [], metrics: [], width: 1, height: 1});
      const {width, height} = choice === "widget_weather" ? {width: 5, height: 2} : widgets[choice];
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
    const widget = card.dataset.kpiId === "widget_weather"
      ? {min_width: 3, max_width: 5, min_height: 1, max_height: 2}
      : card.matches(".metric")
        ? {min_width: 1, max_width: 2, min_height: 1, max_height: 1}
        : panels.has(card.dataset.kpiId) ? widgets[card.dataset.kpiId] : {min_width: 2, min_height: 2};
    return {
      minWidth: Math.min(columns, widget?.min_width ?? 1),
      maxWidth: Math.min(columns, widget ? widget.max_width ?? 8 : 4),
      minHeight: widget?.min_height ?? 1,
      maxHeight: widget ? widget.max_height ?? 4 : 2,
    };
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function resize(card, width, height, columns = gridColumns(getComputedStyle(grid))) {
    const weather = card.dataset.kpiId === "widget_weather";
    const { minWidth, maxWidth, minHeight, maxHeight } = sizeBounds(card, weather ? 8 : columns);
    if (weather) {
      const compact = card.dataset.kpiWidth === "3";
      const full = compact ? width > 3 || height >= 2 : width >= 5 && height >= 2;
      width = full ? 5 : 3;
      height = full ? 2 : 1;
    }
    const nextWidth = String(clamp(width, minWidth, maxWidth));
    const nextHeight = String(clamp(height, minHeight, maxHeight));
    if (card.dataset.kpiWidth === nextWidth && card.dataset.kpiHeight === nextHeight) return;
    if (draft && card.parentElement === grid && card.dataset.widgetPosition) {
      const {cells, nodes, first, last} = boardCells();
      const id = card.dataset.kpiId;
      const slot = cells.get(id);
      const span = Math.min(slot.tracks, Number(nextWidth) * 2);
      const column = weather || card.matches(".metric")
        ? Math.max(first, Math.min(slot.column, slot.tracks - span + 1))
        : slot.column;
      const expanded = {...slot, column, width: span, height: Number(nextHeight)};
      const right = Math.max(last, expanded.column + expanded.width - 1);
      const next = right <= slot.tracks && insertWidget(cells, id, expanded, {first, last: right});
      if (!next) {
        announce("There is not enough room to resize this widget.");
        return;
      }
      showCells(next, nodes);
    }
    card.dataset.kpiWidth = nextWidth;
    card.dataset.kpiHeight = nextHeight;
    card.style.setProperty("--widget-columns", nextWidth);
    card.style.setProperty("--widget-rows", nextHeight);
    if (card.dataset.kpiId === "widget_map") refreshMap();
  }
  function announceSize(card) {
    announce(`${cardName(card)}: ${card.dataset.kpiWidth} columns by ${card.dataset.kpiHeight} rows.`);
  }
  function setPosition(card, position) {
    card.style.removeProperty("--widget-column");
    card.style.removeProperty("--widget-row");
    if (!position) {
      delete card.dataset.widgetPosition;
      return;
    }
    card.dataset.widgetPosition = JSON.stringify(position);
    if (position.tracks === layoutTracks || position.tracks === legacyTracks) {
      card.style.setProperty("--widget-column", position.column);
      card.style.setProperty("--widget-row", position.row);
    }
  }
  function boardCells() {
    const style = getComputedStyle(grid);
    const tracks = layoutTracks;
    const first = 1;
    const last = tracks;
    const stepX = parseFloat(style.gridTemplateColumns) + parseFloat(style.columnGap);
    const stepY = parseFloat(style.gridTemplateRows) + parseFloat(style.rowGap);
    const left = parseFloat(style.paddingLeft);
    const right = grid.clientWidth - parseFloat(style.paddingRight);
    const top = parseFloat(style.paddingTop);
    const rtl = style.direction === "rtl";
    const nodes = new Map([...grid.children].filter(node => node.dataset.kpiId)
      .map(node => [node.dataset.kpiId, node]));
    const cells = new Map([...nodes].map(([id, node]) => [id, {
      tracks,
      column: first + Math.round((rtl ? right - node.offsetLeft - node.offsetWidth : node.offsetLeft - left) / stepX),
      row: 1 + Math.round((node.offsetTop - top) / stepY),
      width: Math.min(tracks, Number(node.dataset.kpiWidth) * 2), height: Number(node.dataset.kpiHeight),
    }]));
    return {cells, nodes, tracks, first, last, stepX, stepY, rtl, top, bottom: parseFloat(style.paddingBottom)};
  }
  function showCells(cells, nodes, dragged) {
    const previous = new Map();
    if (dragged && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const node of nodes.values()) {
        if (node !== dragged) previous.set(node, node.getBoundingClientRect());
      }
    }
    for (const [id, cell] of cells) {
      const position = cell && {column: cell.column, row: cell.row, tracks: cell.tracks};
      setPosition(nodes.get(id), position);
    }
    for (const [node, before] of previous) animateShift(node, before);
    refreshMap();
  }
  function animateShift(node, before) {
    node.getAnimations().find(animation => animation.id === "widget-shift")?.cancel();
    const after = node.getBoundingClientRect();
    const x = before.left - after.left;
    const y = before.top - after.top;
    if (Math.abs(x) + Math.abs(y) > 1)
      node.animate({translate: [`${x}px ${y}px`, "0px 0px"]}, {
        id: "widget-shift", duration: 150, easing: "ease-out",
      });
  }
  function commitCells(cells, nodes, card) {
    let head = grid.firstElementChild;
    for (const [id] of [...cells].sort(([, a], [, b]) => rowMajor(a, b))) {
      const node = nodes.get(id);
      if (node === head) head = head.nextElementSibling;
      else place(node, grid, head);
    }
    update();
    announce(`${cardName(card)} moved to row ${cells.get(card.dataset.kpiId).row}.`);
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
      const width = Number(card.dataset.kpiWidth);
      if (card.matches(".metric")) resize(card, width === 1 ? 2 : 1, 1, 8);
      else resize(card, width, height === maxHeight ? minHeight : height + 1, 8);
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
  const gridResize = new ResizeObserver(() => {
    if (!grid.isConnected) return gridResize.disconnect();
    if (!board.classList.contains("dashboard-widget-mode")) return;
    const previousTracks = layoutTracks;
    const nextTracks = sizeGrid();
    if (nextTracks === previousTracks) return;
    endGesture(false);
    layoutTracks = nextTracks;
    const placed = [...grid.children].filter(card => card.dataset.widgetPosition)
      .map(card => [card, JSON.parse(card.dataset.widgetPosition)]);
    legacyTracks = compatibleTracks(placed.map(([, position]) => position));
    for (const [card, position] of placed) setPosition(card, position);
    refreshMap();
  });
  gridResize.observe(grid);
  if (!trigger) {
    if (data?.widget_catalog) paint();
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
      draft.layout = withWidgets(data, knownCards(data, data.layout), data.widgets);
      draft.reset = true;
      paint();
        announce("Port default previewed. Save layout to apply it.");
    }
    if (action === "add") return showWidgetPicker();
    if (action === "save") {
      endGesture(false);
      const original = draft.shared
        ? withWidgets(data, data.layout, data.widgets)
        : withWidgets(data, currentKpiLayout(), personalized());
      if (!draft.reset && sameLayout(draft.layout, original)) return close();
      saving = button.disabled = true;
      try {
        let layout = draft.layout;
        if (!draft.reset && layout.length && occupiedWidgetColumns(layout)?.tracks !== layoutTracks) {
          const {cells} = boardCells();
          layout = layout.map(card => {
            const {column, row, tracks} = cells.get(card.id);
            return {...card, position: {column, row, tracks}};
          });
        }
        if (draft.shared) {
          const result = await api(path("/dashboard"), "PUT", {
            revision: draft.revision, definitions: data.definitions, layout, widgets: true,
          });
          data.layout = result.layout;
          data.widgets = result.widgets;
          S.data.port.revision = draft.revision + 1;
        } else {
          const result = await api(path("/dashboard/layout"), "PUT", {layout: draft.reset ? null : layout, widgets: true});
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
    if (gesture) return;
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
      const width = horizontal ? Number(card.dataset.kpiWidth) + delta * widthStep(card) :
        Number(card.dataset.kpiWidth);
      resize(card, width, Number(card.dataset.kpiHeight) + (horizontal ? 0 : delta), columns);
      update();
      announceSize(card);
    } else {
      const {cells, nodes, first, last} = boardCells();
      const id = card.dataset.kpiId;
      const slot = cells.get(id);
      const delta = backward ? -1 : 1;
      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const target = {...slot,
        column: horizontal ? clamp(slot.column + delta * 2, first, last - slot.width + 1) : slot.column,
        row: horizontal ? slot.row : clamp(slot.row + delta, 1, MAX_WIDGET_ROW)};
      if (!rowMajor(slot, target)) return;
      const next = insertWidget(cells, id, target, {first, last});
      if (!next) return announce("There is not enough room to move this widget.");
      showCells(next, nodes, card);
      commitCells(next, nodes, card);
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
      const stepX = (parseFloat(style.gridTemplateColumns) + parseFloat(style.columnGap)) * 2;
      const stepY = (rect.height + parseFloat(style.rowGap)) / rows;
      sizing = { ...sizeBounds(card, columns), rows, visibleWidth,
        width: rect.width, height: rect.height, stepX, stepY };
    }
    ignoreClick = false;
    const placement = sizing ? null : boardCells();
    const id = card.dataset.kpiId;
    const lastRow = placement && Math.max(...[...placement.cells.values()].map(cell => cell.row + cell.height - 1));
    const maxRow = placement && Math.min(MAX_WIDGET_ROW, Math.max(lastRow + 1,
      Math.ceil((grid.clientHeight - placement.top) / placement.stepY)));
    gesture = {handle, card, id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, scrollTop: grid.scrollTop, sizing, placement, maxRow, lastRow,
      slot: placement?.cells.get(id), left: card.offsetLeft, top: card.offsetTop,
      originalPositions: placement && new Map([...placement.nodes].map(([key, node]) =>
        [key, JSON.parse(node.dataset.widgetPosition || "null")]))};
    handle.focus({preventScroll: true});
    handle.setPointerCapture(event.pointerId);
  };
  const track = (time, scrolling = true) => {
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
    const {cells, nodes, stepX, stepY, rtl, tracks, first, last} = gesture.placement;
    if (layoutTracks !== tracks) return endGesture(false);

    const bounds = grid.getBoundingClientRect();
    const zone = Math.min(stepY, bounds.height / 3);
    const edge = clamp((y - bounds.bottom + zone) / zone, 0, 1) -
      clamp((bounds.top + zone - y) / zone, 0, 1);
    const scroll = grid.scrollTop;
    const elapsed = gesture.lastFrame == null ? 16 : Math.min(32, time - gesture.lastFrame);
    gesture.lastFrame = time;
    if (scrolling && edge) {
      const {top, bottom} = gesture.placement;
      const lastRow = gesture.preview
        ? Math.max(...[...gesture.preview.values()].map(cell => cell.row + cell.height - 1))
        : gesture.lastRow;
      const maxScroll = Math.max(0, top + lastRow * stepY + bottom - grid.clientHeight);
      grid.scrollTop = clamp(grid.scrollTop + edge * elapsed * .8, 0, maxScroll);
    }
    const id = card.dataset.kpiId;
    const original = cells.get(id);
    const dx = x - startX;
    const dy = y - startY + grid.scrollTop - gesture.scrollTop;
    const slot = {...original,
      column: first - 1 + snapWidgetTrack(original.column - first + 1 + (rtl ? -dx : dx) / stepX,
        gesture.slot.column - first + 1, last - first - original.width + 2, 2, original.column - first + 1),
      row: snapWidgetTrack(original.row + dy / stepY, gesture.slot.row, gesture.maxRow)};
    const changed = rowMajor(gesture.slot, slot);
    if (changed) {
      gesture.slot = slot;
      gesture.preview = rowMajor(original, slot) ? insertWidget(cells, id, slot, {first, last}) : null;
      showCells(gesture.preview || gesture.originalPositions, nodes, card);
      grid.toggleAttribute("data-widget-drop", Boolean(gesture.preview));
      if (gesture.preview) {
        grid.style.setProperty("--widget-drop-column", `${slot.column - first + 1} / span ${slot.width}`);
        grid.style.setProperty("--widget-drop-row", `${slot.row} / span ${slot.height}`);
      }
    }
    card.toggleAttribute("data-widget-blocked", Boolean(rowMajor(original, slot) && !gesture.preview));
    card.style.translate = `${gesture.left - card.offsetLeft + dx}px ${gesture.top - card.offsetTop + dy}px`;
    if (scrolling && edge && (changed || grid.scrollTop !== scroll)) frame = requestAnimationFrame(track);
  };
  function endGesture(commit) {
    if (!gesture) return;
    const {handle, id, card, active, sizing, placement, preview, originalPositions, scrollTop} = gesture;
    const release = active && placement && !matchMedia("(prefers-reduced-motion: reduce)").matches
      ? card.getBoundingClientRect() : null;
    const scroll = grid.scrollTop;
    gesture = null;
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    grid.removeAttribute("data-widget-drop");
    card.removeAttribute("data-kpi-dragging");
    card.removeAttribute("data-widget-blocked");
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
        const width = card.dataset.kpiId === "widget_weather" || !columns
          ? Number(card.dataset.kpiWidth) + columns
          : sizing.visibleWidth + columns;
        resize(card, width, sizing.rows + Math.round(sizing.dy / sizing.stepY), 8);
        update();
        announceSize(card);
      }
      if (card.dataset.kpiId === "widget_map") refreshMap();
    } else if (commit && preview) {
      commitCells(preview, placement.nodes, card);
    } else if (!commit) {
      if (preview) showCells(originalPositions, placement.nodes, card);
      grid.scrollTop = scrollTop;
      announce("Widget move canceled.");
    }
    if (release && scroll === grid.scrollTop) animateShift(card, release);
  }

  grid.onpointermove = event => {
    if (gesture?.id !== event.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      gesture.active = true;
      if (gesture.sizing) gesture.card.dataset.kpiResizing = "";
      else {
        const card = gesture.card;
        const before = card.getBoundingClientRect();
        card.getAnimations().find(animation => animation.id === "widget-shift")?.cancel();
        const after = card.getBoundingClientRect();
        gesture.left += before.left - after.left;
        gesture.top += before.top - after.top;
        card.dataset.kpiDragging = "";
      }
    }
    if (!frame) frame = requestAnimationFrame(track);
  };
  grid.onpointerup = event => {
    if (gesture?.id !== event.pointerId) return;
    if (frame) cancelAnimationFrame(frame);
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    track(performance.now(), false);
    endGesture(true);
  };
  grid.onpointercancel = grid.onlostpointercapture = event => {
    if (gesture?.id === event.pointerId &&
        (event.type === "pointercancel" || !gesture.handle.hasPointerCapture(event.pointerId))) endGesture(false);
  };
  if (draft) {
    draft.layout = knownCards(data, draft.layout);
    show();
  } else if (data?.widget_catalog) paint();
}
