const P = () => window.P;
export function renderPortDirectory() {
  const { S, esc, icon, cardHead, btn, can } = P();
  return `<section class="card ports-directory">${cardHead("Ports", "building-2", `${S.ports.length} workspaces`)}<div class="toolbar"><div class="search-box">${icon("search")}<input type="search" id="port-directory-search" placeholder="Find a port by name or code…" aria-label="Search ports"></div><div class="spacer"></div>${S.user.superadmin ? btn("New organization", "plus", "new-org") + btn("Create a port", "plus", "new-port", "primary") : ""}</div><div class="port-directory-grid">${S.ports.map((port) => `<article class="port-directory-card ${port.id === S.portId ? "current" : ""}" data-port-search="${esc((port.name + " " + port.code + " " + port.timezone).toLowerCase())}"><div class="port-directory-card-top"><span class="port-directory-icon">${icon("map-pinned")}</span>${port.id === S.portId ? '<span class="port-current-badge">Current workspace</span>' : ""}</div><h3>${esc(port.name)}</h3><div class="port-directory-code">${esc(port.code)}</div><p>${icon("clock-3")}${esc(port.timezone)}</p><div class="port-directory-card-bottom"><span>${port.id === S.portId ? `${S.data.berths.length} berths · ${S.data.equipment.length} equipment` : "Infrastructure & map"}</span><button class="btn small ${port.id === S.portId ? "primary" : ""}" data-switch-port="${esc(port.id)}">Configure ${icon("arrow-right")}</button>${S.user.superadmin || S.user.memberships?.find(m => m.port_id === port.id)?.permissions.includes("config.edit") ? `<button class="btn small" data-edit-port="${esc(port.id)}">Edit details</button>` : ""}${S.user.superadmin ? `<button class="btn small danger" data-remove-port="${esc(port.id)}">Remove</button>` : ""}</div></article>`).join("")}</div></section>`;
}
export function renderAssetInventory() {
  const { S, esc, icon, fmt, status, cardHead, can, btn } = P();
  const rows = [
    ...S.data.berths.map((b) => ({ ...b, kind: "berths" })),
    ...S.data.equipment.map((e) => ({ ...e, kind: "equipment" })),
  ];
  const mapped = rows.filter(
    (x) => x.geometry && x.map_visible !== false,
  ).length;
  return `<section class="card port-asset-workspace">${cardHead(esc(S.data.port.name), "map-pinned")}<div class="port-inventory-summary"><div><span class="port-inventory-kicker">${esc(S.data.port.code)} · INFRASTRUCTURE</span><h3>Berths & equipment</h3></div><div class="port-inventory-counts"><span><strong>${S.data.berths.length}</strong>Berths</span><span><strong>${S.data.equipment.length}</strong>Equipment</span><span><strong>${mapped}/${rows.length}</strong>On map</span></div></div><div class="toolbar port-inventory-toolbar"><button class="btn small" data-config-tab="ports">${icon("arrow-left")}All ports</button><div class="segmented" aria-label="Asset type">${[
    ["", "All assets"],
    ["berths", "Berths"],
    ["equipment", "Equipment"],
  ]
    .map(
      ([kind, label]) =>
        `<button type="button" data-asset-kind="${kind}" class="${(S.assetKind || "") === kind ? "active" : ""}" aria-pressed="${(S.assetKind || "") === kind}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="search-box">${icon("search")}<input type="search" id="port-asset-search" placeholder="Find a berth or equipment…" aria-label="Search port infrastructure"></div><div class="spacer"></div><button class="btn small" data-config-tab="geography">${icon("map")}Port map</button>${can("config.edit") ? btn("Add berth", "plus", "add-berth") + btn("Add equipment", "plus", "add-equipment") : ""}</div><div class="table-scroll"><table class="port-asset-table"><thead><tr><th scope=\"col\">Asset</th><th scope=\"col\">Type</th><th scope=\"col\">Operational details</th><th scope=\"col\">Status</th><th scope=\"col\">Map position</th><th scope=\"col\">Actions</th></tr></thead><tbody>${
    rows
      .map((x) => {
        const placed = x.geometry && x.map_visible !== false;
        return `<tr data-asset-type="${x.kind}" data-asset-search="${esc([x.name, x.code, x.type, x.terminal].filter(Boolean).join(" ").toLowerCase())}"><td><div class="port-asset-name"><span>${icon(x.kind === "berths" ? "anchor" : "construction")}</span><div><strong>${esc(x.kind === "berths" ? x.code + " · " + x.name : x.name)}</strong><small>${esc(x.kind === "berths" ? x.terminal || "No terminal assigned" : x.type || "Equipment")}</small></div></div></td><td>${x.kind === "berths" ? "Berth" : "Equipment"}</td><td>${x.kind === "berths" ? `${x.max_loa} m LOA · ${x.max_draft} m draft<br><small class="subtle">${x.buffer_hours} h safety gap</small>` : `${fmt(x.capacity)} t/h<br><small class="subtle">${esc((x.berths || []).map((id) => S.data.berths.find((b) => b.id === id)?.code || id).join(", ") || "No linked berths")}</small>`}</td><td>${status(x.status)}</td><td><span class="asset-map-status ${placed ? "mapped" : "unplaced"}">${icon(placed ? "map-pin-check" : "map-pin-off")}${placed ? "Placed" : "Not placed"}</span></td><td><div class="port-asset-actions"><button class="btn small" ${x.kind === "berths" ? `data-edit-berth="${esc(x.id)}"` : `data-edit-equipment="${esc(x.id)}"`}>${can("config.edit") ? "Configure" : "View"}</button><button class="btn small ${placed ? "" : "primary"}" data-place-asset="${esc(x.id)}" data-place-kind="${x.kind}" ${can("config.edit") ? "" : "disabled"}>${icon("map-pin")}${placed ? "Reposition" : "Place on map"}</button>${can("config.edit") ? `<button class="btn small danger" data-remove-asset="${esc(x.id)}" data-remove-kind="${x.kind}">Remove</button>` : ""}</div></td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="6"><div class="empty-state"><h3>No infrastructure yet</h3><p>Add a berth or equipment, or import your documents to initialize this port.</p></div></td></tr>'
  }</tbody></table></div></section>`;
}
export function bindPortInventory() {
  const { S } = P();
  const search = document.querySelector("#port-asset-search");
  const filter = () => {
    const query = search?.value.toLowerCase() || "";
    document
      .querySelectorAll("[data-asset-type]")
      .forEach(
        (row) =>
          (row.hidden = !!(
            (S.assetKind && S.assetKind !== row.dataset.assetType) ||
            !row.dataset.assetSearch.includes(query)
          )),
      );
    document.querySelectorAll("[data-asset-kind]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.assetKind === (S.assetKind || ""),
      );
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.assetKind === (S.assetKind || "")),
      );
    });
  };
  if (search) search.oninput = filter;
  document.querySelectorAll("[data-asset-kind]").forEach(
    (b) =>
      (b.onclick = () => {
        S.assetKind = b.dataset.assetKind;
        filter();
      }),
  );
  filter();
}
