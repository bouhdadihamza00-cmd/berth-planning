import { confirmRemoval } from "./removal.js?v=6";
const P = () => window.P;
export function cargoFields(call = {}, blank = false) {
  const { select } = P();
  const flow = blank ? [["", "Select cargo flow"], "Export", "Import"] : ["Export", "Import"];
  return `<div class="cargo-fields field full"><div class="form-grid">${select("Cargo flow", "direction", flow, blank ? "" : call.direction || "Export", "required")}${select("Product", "product", [], blank ? "" : call.product || "", "required")}${select("Product grade", "grade", [], blank ? "" : call.grade || "", "required")}${select("Product sub-grade", "subgrade", [], blank ? "" : call.subgrade || "")}<input type="hidden" name="catalog_item_id"><p class="cargo-reference field full" id="cargo-reference">Select the cargo specification.</p></div></div>`;
}
export function bindCargoFields(form, initial = {}, blank = false) {
  const { S, esc } = P();
  const catalog = S.data.port.cargo_catalog || [];
  const fields = Object.fromEntries(
    ["direction", "product", "grade", "subgrade"].map((k) => [
      k,
      form.elements[k],
    ]),
  );
  if (!fields.direction) return;
  const set = (el, values, current, placeholder) => {
    el.innerHTML =
      (placeholder ? `<option value="">${placeholder}</option>` : "") +
      values
        .map(
          (v) =>
            `<option value="${esc(v)}">${esc(v || "Not applicable")}</option>`,
        )
        .join("");
    el.value = values.includes(current)
      ? current
      : placeholder
        ? ""
        : (values[0] ?? "");
  };
  const distinct = (rows, key) => [...new Set(rows.map((r) => r[key] || ""))];
  function update(from) {
    if (blank && !fields.direction.value) {
      for (const key of ["product", "grade", "subgrade"])
        set(fields[key], [], "", "Select…");
      form.elements.catalog_item_id.value = "";
      form.querySelector("#cargo-reference").textContent = "Select the cargo specification.";
      return;
    }
    let rows = catalog.filter((r) => r.direction === fields.direction.value);
    if (from <= 0)
      set(
        fields.product,
        distinct(rows, "product"),
        initial.product || fields.product.value,
        blank ? "Select a product" : "",
      );
    rows = rows.filter((r) => r.product === fields.product.value);
    if (from <= 1)
      set(
        fields.grade,
        distinct(rows, "grade"),
        initial.grade || fields.grade.value,
        blank
          ? "Select a grade"
          : initial.grade && !rows.some((r) => r.grade === initial.grade)
            ? "Choose a catalogue grade"
            : "",
      );
    rows = rows.filter((r) => r.grade === fields.grade.value);
    if (from <= 2)
      set(
        fields.subgrade,
        distinct(rows, "subgrade"),
        initial.subgrade ?? fields.subgrade.value,
        blank ? "Select a sub-grade" : "",
      );
    const row = rows.find((r) => (r.subgrade || "") === fields.subgrade.value);
    form.elements.catalog_item_id.value = row?.id || "";
    form.querySelector("#cargo-reference").textContent = row
      ? `${row.id} · ${row.direction} / ${row.product} / ${row.grade}${row.subgrade ? " / " + row.subgrade : ""}`
      : "Choose a valid cargo specification from the catalogue.";
  }
  if (catalog.length) {
    fields.direction.value = blank ? "" : initial.direction || "Export";
    update(0);
    initial = {};
    Object.entries(fields).forEach(([key, el], i) =>
      el.addEventListener("change", () => update(i)),
    );
  } else {
    const products = S.data.port.products || [];
    function basic() {
      set(
        fields.product,
        products
          .filter((p) => p.direction === fields.direction.value)
          .map((p) => p.name),
        initial.product,
        blank ? "Select a product" : "",
      );
      set(fields.grade, ["Standard"], initial.grade, blank ? "Select a grade" : "");
      set(fields.subgrade, [""], "", blank ? "Select a sub-grade" : "");
    }
    basic();
    fields.direction.addEventListener("change", basic);
  }
}
export function timingFields(call = {}, blank = false) {
  const { field, inputDate } = P();
  if (blank)
    return `${field("Planned start", "start", "", "datetime-local", "required")}${field("Duration, hours", "duration_hours", "", "number", 'required min="0.25" max="720" step="any"')}${field("Planned completion", "end", "", "datetime-local", "required")}<p class="field full timing-help">Change duration to calculate completion, or change completion to calculate duration. Times use your browser timezone.</p>`;
  const start =
    call.start ||
    new Date(
      new Date(P().S.data.port.demo_clock || Date.now()).getTime() +
        25 * 3600000,
    ).toISOString();
  const hours = call.end
    ? (new Date(call.end) - new Date(start)) / 3600000
    : P().S.data.port.rules.default_duration_hours || 24;
  const end =
    call.end ||
    new Date(new Date(start).getTime() + hours * 3600000).toISOString();
  return `${field("Planned start", "start", inputDate(start), "datetime-local", "required")}${field("Duration, hours", "duration_hours", Number(hours.toFixed(4)), "number", 'required min="0.25" max="720" step="any"')}${field("Planned completion", "end", inputDate(end), "datetime-local", "required")}<p class="field full timing-help">Change duration to calculate completion, or change completion to calculate duration. Times use your browser timezone.</p>`;
}
export function bindTiming(form) {
  const start = form.elements.start,
    end = form.elements.end,
    duration = form.elements.duration_hours;
  const stamp = (el) => new Date(el.value).getTime();
  const calculateEnd = () => {
    if (start.value && Number(duration.value) > 0)
      end.value = P().inputDate(
        stamp(start) + Number(duration.value) * 3600000,
      );
  };
  start.addEventListener("input", calculateEnd);
  duration.addEventListener("input", calculateEnd);
  end.addEventListener("input", () => {
    if (start.value && end.value)
      duration.value = Number(
        ((stamp(end) - stamp(start)) / 3600000).toFixed(4),
      );
  });
}
const catalogFilterKeys = ["direction", "product", "grade", "subgrade"];
export function filterCatalog(rows, filters = {}, query = "") {
  const words = String(query)
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return rows.filter(
    (row) =>
      catalogFilterKeys.every(
        (key) =>
          !filters[key] ||
          (key === "subgrade" && filters[key] === "__none__"
            ? !row[key]
            : row[key] === filters[key]),
      ) &&
      words.every((word) =>
        `${row.id} ${row.direction} ${row.product} ${row.grade} ${row.subgrade || ""}`
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
}
export function catalogOptions(rows, filters, key) {
  const other = Object.fromEntries(
    catalogFilterKeys
      .slice(0, catalogFilterKeys.indexOf(key))
      .map((parent) => [parent, filters[parent]]),
  );
  return [
    ...new Set(
      filterCatalog(rows, other)
        .map((row) => (key === "subgrade" && !row[key] ? "__none__" : row[key]))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
function productIcon(name) {
  if (/fertili[sz]|engrais/i.test(name)) return "sprout";
  if (/rock|phosphate|mineral/i.test(name) && !/acid/i.test(name))
    return "mountain";
  if (/acid|acide|chemical|caustic/i.test(name)) return "flask-conical";
  if (/sulf|soufre/i.test(name)) return "flame";
  if (/ammon/i.test(name)) return "wind";
  if (/potash|potass/i.test(name)) return "gem";
  return "package";
}
export function activeThroughputProducts(products) {
  return products
    .filter(
      (product) =>
        Number.isFinite(Number(product.quantity)) &&
        Number(product.quantity) > 0,
    )
    .sort((a, b) => Number(b.quantity) - Number(a.quantity));
}
export function renderProductIcon(name) {
  const { S, icon, esc } = P();
  const appearance = S.data.port.product_icons?.[name];
  const color = /^#[0-9a-f]{6}$/i.test(appearance?.color || "")
    ? appearance.color
    : "#087db3";
  if (appearance?.type === "image") {
    const url = `/api/ports/${encodeURIComponent(S.portId)}/product-icons/${encodeURIComponent(appearance.asset_id)}`;
    return appearance.tint
      ? `<span class="product-custom-icon-mask" style="background-color:${color};mask-image:url('${url}');-webkit-mask-image:url('${url}')" aria-hidden="true"></span>`
      : `<img class="product-custom-icon-image" src="${url}" alt="">`;
  }
  return `<span class="product-configured-icon" style="color:${color}">${icon(appearance?.type === "builtin" ? appearance.name : productIcon(name))}</span>`;
}
const PRODUCT_ICON_OPTIONS = [
  "package",
  "boxes",
  "sprout",
  "leaf",
  "mountain",
  "flask-conical",
  "flask-round",
  "droplet",
  "droplets",
  "flame",
  "wind",
  "gem",
  "factory",
  "wheat",
  "fuel",
  "ship",
  "container",
  "recycle",
  "atom",
  "snowflake",
  "sun",
  "circle-dot",
];
function configureProductIcon(name) {
  const {
    S,
    modal,
    esc,
    icon,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
  } = P();
  const current = S.data.port.product_icons?.[name] || {
    type: "default",
    color: "#087db3",
  };
  let uploaded = null;
  modal(
    "Product icon · " + name,
    `<form id="product-icon-form"><div class="product-icon-current"><span id="product-icon-preview">${renderProductIcon(name)}</span><div><strong>${esc(name)}</strong><small>Shared by the product catalogue and dashboard.</small></div></div><label class="check-row"><input type="radio" name="source" value="default" ${current.type === "default" ? "checked" : ""}>Automatic product icon</label><label class="check-row"><input type="radio" name="source" value="builtin" ${current.type === "builtin" ? "checked" : ""}>Choose a built-in icon</label><div class="product-icon-options">${PRODUCT_ICON_OPTIONS.map((value) => `<label title="${esc(value.replaceAll("-", " "))}"><input type="radio" name="builtin" value="${value}" ${(current.name || productIcon(name)) === value ? "checked" : ""}>${icon(value)}<span class="sr-only">${esc(value.replaceAll("-", " "))}</span></label>`).join("")}</div><label class="check-row"><input type="radio" name="source" value="image" ${current.type === "image" ? "checked" : ""}>Upload my own icon</label><label class="field">PNG, JPEG or WebP · up to 256 KB, 1024 × 1024 pixels<input type="file" id="product-icon-file" accept="image/png,image/jpeg,image/webp"></label><div class="product-icon-colors"><label class="field">Icon color<input type="color" name="color" value="${esc(current.color || "#087db3")}"></label><div class="product-icon-swatches">${["#087db3", "#062e4b", "#eb8d24", "#258452", "#8655d1", "#ef6351", "#00a68c", "#64748b"].map((color) => `<button type="button" data-icon-color="${color}" style="background:${color}" aria-label="Use ${color}"></button>`).join("")}</div></div><label class="check-row"><input type="checkbox" name="tint" ${current.tint ? "checked" : ""}>Tint uploaded icon with this color (best with transparent icons)</label><div class="form-actions"><button class="btn primary" type="submit">Save product icon</button></div></form>`,
    true,
  );
  const form = document.querySelector("#product-icon-form");
  const preview = () => {
    const data = new FormData(form),
      color = data.get("color"),
      source = data.get("source");
    const target = document.querySelector("#product-icon-preview");
    target.style.color = color;
    if (source === "image" && (uploaded || current.asset_id)) {
      const url =
        uploaded ||
        `/api/ports/${encodeURIComponent(S.portId)}/product-icons/${encodeURIComponent(current.asset_id)}`;
      target.innerHTML = data.get("tint")
        ? `<span class="product-custom-icon-mask" style="background-color:${color};mask-image:url('${url}');-webkit-mask-image:url('${url}')"></span>`
        : `<img class="product-custom-icon-image" src="${url}" alt="">`;
    } else
      target.innerHTML = icon(
        source === "builtin" ? data.get("builtin") : productIcon(name),
      );
    P().icons();
  };
  form.addEventListener("input", (e) => {
    if (e.target.name === "builtin")
      form.querySelector("[name=source][value=builtin]").checked = true;
    preview();
  });
  document.querySelectorAll("[data-icon-color]").forEach(
    (b) =>
      (b.onclick = () => {
        form.elements.color.value = b.dataset.iconColor;
        preview();
      }),
  );
  document.querySelector("#product-icon-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (
      file.size > 256 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      e.target.value = "";
      toast("Use a PNG, JPEG or WebP image no larger than 256 KB.", true);
      return;
    }
    uploaded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the icon"));
      reader.readAsDataURL(file);
    });
    form.querySelector("[name=source][value=image]").checked = true;
    preview();
  };
  handleForm("#product-icon-form", async (d) => {
    if (d.source === "image" && !uploaded && !current.asset_id)
      throw new Error("Upload your icon first.");
    await api(path("/configuration/product-icon"), "POST", {
      product: name,
      revision: S.data.port.revision,
      type: d.source,
      icon: d.builtin,
      color: d.color,
      tint: d.tint === "on",
      ...(d.source === "image"
        ? uploaded
          ? { content_base64: uploaded.split(",")[1] }
          : { asset_id: current.asset_id }
        : {}),
    });
    closeModal();
    await refresh();
    toast("Product icon saved");
  });
}
function renderProductCards(rows) {
  const { S, cardHead, icon, esc, can, btn } = P();
  const names = [
    ...new Set([
      ...rows.map((r) => r.product),
      ...(S.data.port.products || []).map((p) => p.name),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const cards = [
    { name: "All", product: "", icon: "boxes", rows },
    ...names.map((name) => ({
      name,
      product: name,
      icon: productIcon(name),
      rows: rows.filter((r) => r.product === name),
    })),
  ];
  return `<section class="card product-catalogue-overview">${cardHead("Products & Cargo", "package", `${names.length} products · ${rows.length} specifications`)}<div class="toolbar"><p class="subtle">Choose a product to explore its grades and sub-grades.</p><div class="spacer"></div>${can("config.edit") ? btn("Add product / specification", "plus", "catalog-add", "primary") : ""}</div><div class="catalogue-product-grid">${cards
    .map((card) => {
      const grades = new Set(card.rows.map((r) => r.grade).filter(Boolean))
        .size;
      const subgrades = new Set(
        card.rows.map((r) => r.subgrade).filter(Boolean),
      ).size;
      const flows = [...new Set(card.rows.map((r) => r.direction))].join(" / ");
      return `<div class="catalogue-product-tile"><button type="button" class="catalogue-product-card ${card.product ? "" : "catalogue-all-card"}" data-catalog-product="${esc(card.product)}"><span class="catalogue-product-icon">${card.product ? renderProductIcon(card.product) : icon(card.icon)}</span><span class="catalogue-product-heading"><strong>${esc(card.name)}</strong>${icon("arrow-up-right")}</span><span class="catalogue-product-description">${card.product ? esc(flows || "Product catalogue") : "Every product, grade and sub-grade"}</span><span class="catalogue-product-stats"><span><b>${grades}</b> grade${grades === 1 ? "" : "s"}</span><span><b>${subgrades}</b> sub-grade${subgrades === 1 ? "" : "s"}</span><span><b>${card.rows.length}</b> specification${card.rows.length === 1 ? "" : "s"}</span></span></button>${card.product && can("config.edit") ? `<button type="button" class="catalogue-product-settings" data-product-icon="${esc(card.product)}" aria-label="Configure icon for ${esc(card.product)}" title="Configure product icon">${icon("palette")}</button><button type="button" class="btn small danger catalogue-product-remove" data-product-remove="${esc(card.product)}">Remove product</button>` : ""}</div>`;
    })
    .join("")}</div></section>`;
}
export function renderCatalog() {
  const { S, cardHead, icon, esc, btn } = P();
  const rows = S.data.port.cargo_catalog || [];
  if (S.catalogBrowsePort !== S.portId) {
    S.catalogBrowsePort = S.portId;
    S.catalogSelectedId = null;
    S.catalogSelection = null;
    S.catalogFilters = {};
    S.catalogQuery = "";
  }
  const selection = S.catalogSelection;
  if (!selection) return renderProductCards(rows);
  const sourceRows = selection.product
    ? rows.filter((r) => r.product === selection.product)
    : rows;
  const filters = {
    ...(S.catalogFilters || {}),
    ...(selection.product ? { product: selection.product } : {}),
  };
  const filtered = filterCatalog(sourceRows, filters, S.catalogQuery || "");
  const names = {
    direction: "Flow",
    product: "Product",
    grade: "Grade",
    subgrade: "Sub-grade",
  };
  const controls = catalogFilterKeys
    .filter((key) => key !== "product" || !selection.product)
    .map(
      (key) =>
        `<label class="catalog-filter"><span>${names[key]}</span><select data-catalog-filter="${key}" aria-label="Filter catalogue by ${names[key].toLowerCase()}"><option value="">All ${key === "direction" ? "flows" : key === "product" ? "products" : key === "grade" ? "grades" : "sub-grades"}</option>${catalogOptions(
          sourceRows,
          filters,
          key,
        )
          .map(
            (value) =>
              `<option value="${esc(value)}" ${filters[key] === value ? "selected" : ""}>${esc(value === "__none__" ? "Not applicable" : value)}</option>`,
          )
          .join("")}</select></label>`,
    )
    .join("");
  return `<section class="card catalogue-card">${cardHead(selection.product ? selection.product + " · grades & sub-grades" : "All products · grades & sub-grades", selection.product ? productIcon(selection.product) : "boxes", `${filtered.length} of ${sourceRows.length} specifications`)}<div class="toolbar catalogue-filters"><button type="button" class="btn small" id="catalog-back">${icon("arrow-left")}Products</button><div class="search-box">${icon("search")}<input id="catalog-search" placeholder="Find reference, product, grade or sub-grade…" value="${esc(S.catalogQuery || "")}" aria-label="Search product catalogue"></div>${controls}${selection.product && P().can("config.edit") ? `<button class="btn small" type="button" data-product-icon="${esc(selection.product)}">${icon("palette")}Product icon</button>` : ""}<button type="button" class="btn small" id="catalog-reset">${icon("filter-x")}Reset filters</button><div class="spacer"></div>${P().can("config.edit") ? btn("Add grade / sub-grade", "plus", "catalog-add", "primary") : ""}</div><div class="table-scroll" tabindex="0" aria-label="Product specifications"><table><thead><tr><th scope=\"col\">Reference</th><th scope=\"col\">Flow</th>${selection.product ? "" : "<th scope=\"col\">Product</th>"}<th scope=\"col\">Grade</th><th scope=\"col\">Sub-grade</th><th scope=\"col\"></th></tr></thead><tbody>${filtered.map((r) => `<tr data-catalog-row="${esc(r.id)}" tabindex="0" aria-selected="${S.catalogSelectedId === r.id}" class="catalogue-spec-row ${S.catalogSelectedId === r.id ? "selected" : ""}"><td class="subtle">${esc(r.id)}</td><td>${P().status(r.direction)}</td>${selection.product ? "" : `<td class="vessel-cell">${esc(r.product)}</td>`}<td>${esc(r.grade)}</td><td>${esc(r.subgrade || "Not applicable")}</td><td>${P().can("config.edit") ? `<div class="catalog-row-actions"><button class="btn small" data-catalog-edit="${esc(r.id)}">Edit</button><button class="btn small danger" data-catalog-remove="${esc(r.id)}" aria-label="Delete ${r.subgrade ? "subgrade " + esc(r.subgrade) + " for " + esc(r.grade) : "grade " + esc(r.grade)}">Delete ${r.subgrade ? "subgrade" : "grade"}</button></div>` : ""}</td></tr>`).join("") || `<tr><td colspan="6">No specifications match these filters. Reset filters to see all specifications.</td></tr>`}</tbody></table></div></section>`;
}
export function bindCatalog() {
  const { S, $, $$, renderApp } = P();
  $$("[data-product-icon]").forEach(
    (button) =>
      (button.onclick = () => configureProductIcon(button.dataset.productIcon)),
  );
  $$("[data-product-remove]").forEach(b => b.onclick = () => confirmRemoval(P().path('/configuration/products/' + encodeURIComponent(b.dataset.productRemove)), b.dataset.productRemove, "Remove this product and all its grade/sub-grade specifications? Products used by vessel calls or planning workflows cannot be removed.", () => P().refresh(), { revision: S.data.port.revision }));
  $$("[data-catalog-remove]").forEach(b => b.onclick = () => {
    const r = S.data.port.cargo_catalog.find(r => r.id === b.dataset.catalogRemove);
    confirmRemoval(P().path('/configuration/catalog/' + encodeURIComponent(r.id)), [r.product, r.grade, r.subgrade].filter(Boolean).join(' · '), 'Remove this grade/sub-grade specification? Other specifications remain.', () => P().refresh(), { revision: S.data.port.revision });
  });
  const selectRow = (row) => {
    S.catalogSelectedId = row.dataset.catalogRow;
    $$("[data-catalog-row]").forEach((el) => {
      el.classList.toggle("selected", el === row);
      el.setAttribute("aria-selected", String(el === row));
    });
  };
  $$("[data-catalog-row]").forEach((row) => {
    row.onclick = (e) => {
      if (!e.target.closest("button,a,input,select")) selectRow(row);
    };
    row.onkeydown = (e) => {
      if (e.target === row && ["Enter", " "].includes(e.key)) {
        e.preventDefault();
        selectRow(row);
      }
    };
  });
  $$("[data-catalog-product]").forEach(
    (button) =>
      (button.onclick = () => {
        S.catalogSelection = { product: button.dataset.catalogProduct };
        S.catalogFilters = {};
        S.catalogQuery = "";
        renderApp();
        $("#catalog-search")?.focus();
      }),
  );
  if ($("[data-action=catalog-add]"))
    $("[data-action=catalog-add]").onclick = () => catalogForm();
  if ($("#catalog-back"))
    $("#catalog-back").onclick = () => {
      S.catalogSelection = null;
      S.catalogFilters = {};
      S.catalogQuery = "";
      renderApp();
    };
  if (!$("#catalog-search")) return;
  $("#catalog-search").oninput = (e) => {
    S.catalogQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderApp();
    $("#catalog-search").focus();
    $("#catalog-search").setSelectionRange(pos, pos);
  };
  $$("[data-catalog-filter]").forEach(
    (select) =>
      (select.onchange = () => {
        const key = select.dataset.catalogFilter;
        S.catalogFilters = { ...S.catalogFilters, [key]: select.value };
        for (const child of catalogFilterKeys.slice(
          catalogFilterKeys.indexOf(key) + 1,
        ))
          delete S.catalogFilters[child];
        renderApp();
        $(`[data-catalog-filter="${key}"]`)?.focus();
      }),
  );
  $("#catalog-reset").onclick = () => {
    S.catalogFilters = {};
    S.catalogQuery = "";
    renderApp();
    $("#catalog-search").focus();
  };
  if ($("[data-action=catalog-add]"))
    $("[data-action=catalog-add]").onclick = () => catalogForm();
  $$("[data-catalog-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const row = b.closest("[data-catalog-row]");
        if (row) selectRow(row);
        catalogForm(
          S.data.port.cargo_catalog.find((r) => r.id === b.dataset.catalogEdit),
        );
      }),
  );
}
function catalogForm(existing) {
  const {
    S,
    modal,
    field,
    select,
    handleForm,
    api,
    path,
    refresh,
    closeModal,
    toast,
  } = P();
  const r = existing || {
    id: "CUSTOM-" + Date.now().toString(36).toUpperCase(),
    direction: "Export",
    product: S.catalogSelection?.product || "",
    grade: "",
    subgrade: "",
  };
  modal(
    existing ? "Edit cargo specification" : "Add cargo specification",
    `<form id="catalog-form"><div class="form-grid">${field("Reference", "id", r.id, "text", "required")}${select("Cargo flow", "direction", ["Export", "Import"], r.direction)}${field("Product name", "product", r.product, "text", 'required list="product-names"')}${field("Grade", "grade", r.grade, "text", "required")}${field("Sub-grade, optional", "subgrade", r.subgrade)}<datalist id="product-names">${[...new Set((S.data.port.cargo_catalog || []).map((x) => x.product))].map((n) => `<option value="${P().esc(n)}">`).join("")}</datalist></div><div class="catalog-delete-confirm" id="catalog-delete-confirm" hidden><p>Remove this grade/sub-grade specification from the catalogue? Other specifications stay in place.</p><button class="btn danger" type="button" id="confirm-delete-specification">Confirm deletion</button><button class="btn small" type="button" id="cancel-delete-specification">Cancel</button></div><div class="form-actions">${existing ? '<button class="btn danger" type="button" id="delete-catalog-specification">Delete grade / sub-grade</button>' : ""}<button class="btn primary" type="submit">Save specification</button></div></form>`,
  );
  if (existing) {
    document.querySelector("#delete-catalog-specification").onclick = () => {
      document.querySelector("#catalog-delete-confirm").hidden = false;
    };
    document.querySelector("#cancel-delete-specification").onclick = () => {
      document.querySelector("#catalog-delete-confirm").hidden = true;
    };
    document.querySelector("#confirm-delete-specification").onclick = async (
      e,
    ) => {
      e.currentTarget.disabled = true;
      try {
        await api(
          path("/configuration/catalog/" + encodeURIComponent(existing.id)),
          "DELETE",
          { revision: S.data.port.revision },
        );
        S.catalogSelectedId = null;
        closeModal();
        await refresh();
        toast("Grade/sub-grade specification deleted");
      } catch (error) {
        toast(error.message, true);
        e.currentTarget.disabled = false;
      }
    };
  }
  handleForm("#catalog-form", async (d) => {
    for (const k of ["id", "product", "grade", "subgrade"]) d[k] = d[k].trim();
    const rows = [...(S.data.port.cargo_catalog || [])];
    const i = existing ? rows.findIndex((x) => x.id === existing.id) : -1;
    if (i >= 0) rows[i] = d;
    else rows.push(d);
    await api(path(""), "PUT", { ...S.data.port, cargo_catalog: rows });
    closeModal();
    await refresh();
    toast(
      "Cargo specification saved. Vessel selectors now use the updated catalogue.",
    );
  });
}
