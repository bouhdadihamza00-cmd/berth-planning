import { renderKpiConfig, bindKpiConfig } from "./dashboard-kpis.js?v=43";
import { confirmRemoval } from "./removal.js?v=6";
import {
  renderPortDirectory,
  renderAssetInventory,
  bindPortInventory,
} from "./port-workspace.js?v=7";
import {
  renderRuleWorkbench,
  bindRuleWorkbench,
} from "./rule-workbench.js?v=10";
import { renderDocuments, bindDocuments } from "./documents.js?v=16";
import { renderConnectors, bindConnectors } from "./connectors.js?v=9";
import { renderPreferences, bindPreferences } from "./preferences.js?v=13";
import { renderCatalog, bindCatalog } from "./cargo.js?v=13";
import {
  renderDepartments,
  bindDepartments,
  permissionLabels,
} from "./administration.js?v=7";
import { initGeography } from "./geography.js?v=10";
const P = () => window.P;
const sections = [
  [
    "general",
    "settings-2",
    "General settings",
    [["general", "General app configuration"]],
  ],
  [
    "people",
    "users",
    "People",
    [
      ["users", "People & permissions"],
      ["departments", "Departments"],
    ],
  ],
  [
    "ports",
    "map",
    "Ports",
    [
      ["ports", "Ports & organizations"],
      ["geography", "Port map"],
      ["assets", "Berths & equipment"],
    ],
  ],
  [
    "products",
    "package",
    "Products & Cargo",
    [["products", "Products & Cargo"]],
  ],
  [
    "rules",
    "shield-check",
    "Rules",
    [
      ["rules", "All rules"],
      ["workflows", "Approval workflow"],
    ],
  ],
  ["dashboard-kpis", "chart-column", "Platform variables", [["dashboard-kpis", "Platform variables"]]],
  ["imports", "files", "Document Imports", [["imports", "Document Imports"]]],
  [
    "integrations",
    "plug-zap",
    "External integrations",
    [["integrations", "External integrations"]],
  ],
];
export function renderConfig() {
  const { S, pageHeading, btn, icon, can, empty } = P();
  if (!can("config.view") && can("planning.view")) S.configTab = "imports";
  if (S.configTab === "integrations-ais") S.configTab = "integrations";
  if (S.configTab === "audit") S.configTab = "general";
  if (S.configTab === "workflows") {
    S.configTab = "rules";
    S.ruleEditor = "workflow";
  }
  const group =
    sections.find(([, , , tabs]) => tabs.some(([id]) => id === S.configTab)) ||
    sections[0];
  return (
    pageHeading(
      "Configuration",
      "Port infrastructure, planning rules, products and access control.",
      `${can("config.edit") ? btn("Export geography", "download", "export-geo") : ""}`,
    ) +
    (!can("config.view") && !can("planning.view")
      ? `<section class="card">${empty("Configuration access is restricted", "Your role can view operational information. Configuration requires administrator permissions.", "lock-keyhole")}</section>`
      : `<div class="config-layout"><aside class="card config-nav"><div class="nav-caption">Settings</div>${sections
          .filter(
            ([id]) =>
              (can("config.view") || id === "imports") &&
              (id !== "people" || can("users.view") || can("config.view")),
          )
          .map(
            ([id, ic, title, tabs]) =>
              `<button class="${group[0] === id ? "active" : ""}" aria-pressed="${group[0] === id}" data-config-tab="${tabs.find(([tab]) => tab !== "users" || can("users.view"))[0]}">${icon(ic)}${title}</button>`,
          )
          .join(
            "",
          )}</aside><div class="config-content">${group[0] !== "ports" && group[3].filter(([id]) => id !== "workflows" && (id !== "users" || can("users.view"))).length > 1 ? `<div class="config-section-tabs" role="navigation" aria-label="${group[2]}">${group[3]
          .filter(([id]) => id !== "users" || can("users.view"))
          .filter(([id]) => id !== "workflows")
          .map(
            ([id, title]) =>
              `<button class="btn small ${S.configTab === id ? "primary" : ""}" data-config-tab="${id}">${title}</button>`,
          )
          .join("")}</div>` : ""}${configContent()}</div></div>`)
  );
}
function configContent() {
  const {
    S,
    esc,
    icon,
    fmt,
    date,
    status,
    btn,
    empty,
    field,
    select,
    textArea,
    cardHead,
    can,
  } = P();
  const p = S.data.port;
  if (S.configTab === "geography")
    return `<section class="card">${cardHead("Port map · " + esc(p.name), "map", "Shared source for dashboard & planning")}<div class="toolbar"><button class="btn small" data-config-tab="assets">${icon("arrow-left")}Berths & equipment</button><div class="spacer"></div><button class="btn small" id="import-geo">${icon("upload")}Import GeoJSON</button><button class="btn small" id="geo-recenter">${icon("locate-fixed")}Recenter</button><button class="btn small" id="geo-basemap">${icon("layers")}Satellite / map</button></div><div class="toolbar"><span class="subtle" style="font-size:calc(10px * var(--ui-font-scale, 1))">Go to coordinates</span><input id="geo-lng" type="number" step="0.00001" value="${p.center[0]}" aria-label="Map center longitude" style="width:120px"><input id="geo-lat" type="number" step="0.00001" value="${p.center[1]}" aria-label="Map center latitude" style="width:120px"><button class="btn small" id="geo-go">Locate</button><small class="subtle">Longitude, latitude · WGS84</small></div><div class="config-map" id="config-map"></div><div class="form-body"><div class="notice">${icon("info")}Draw a polygon to set the port boundary, a line to create a berth, or a marker to place equipment. Edit or delete saved geometry using the map toolbar. Geometry is illustrative and requires validation before operational use.</div><div class="form-grid"><div class="field"><label>Port boundary</label><p style="font-size:calc(11px * var(--ui-font-scale, 1));color:#74909c">${p.boundary ? p.boundary.coordinates[0].length - 1 + " configured vertices" : "Not yet configured"}</p></div><div class="field"><label>Mapped infrastructure</label><p style="font-size:calc(11px * var(--ui-font-scale, 1));color:#74909c">${S.data.berths.filter((x) => x.geometry && x.map_visible !== false).length} berths · ${S.data.equipment.filter((x) => x.geometry && x.map_visible !== false).length} assets · ${S.data.zones.filter((x) => x.geometry && x.map_visible !== false).length} zones</p></div></div><div class="form-actions"><button class="btn" id="geo-center-save" ${!can("config.edit") ? "disabled" : ""}>${icon("map-pin")}Save current map view</button><button class="btn primary" id="geo-to-overview">${icon("layout-dashboard")}View on dashboard</button></div></div></section>`;
  if (S.configTab === "ports") return renderPortDirectory();
  if (S.configTab === "assets") return renderAssetInventory();
  if (S.configTab === "imports") return renderDocuments();
  if (S.configTab === "products") return renderCatalog();
  if (S.configTab === "departments") return renderDepartments();
  if (S.configTab === "users")
    return `<section class="card">${cardHead("People & permissions", "users")}<div class="form-body"><div id="users-list">${empty("Loading port members…", "", "users")}</div><div class="form-actions">${can("users.edit") ? btn("Create user", "user-plus", "new-user", "primary") : ""}</div></div></section>`;
  if (S.configTab === "rules" || S.configTab === "workflows")
    return renderRuleWorkbench();
  if (S.configTab === "integrations") return renderConnectors(`<section class="card"><div class="integration-section-heading"><h3 id="ais-settings-title">${icon("radio")}AIS vessel tracking</h3><span class="status blue" id="ais-connection-badge">${esc(P().aisStateLabel())}</span></div><form class="form-body" id="integration-form" aria-labelledby="ais-settings-title"><div id="ais-connection-message" role="status" class="notice ${S.data.ais.mode === "live" ? "success" : "warning"}">${icon("radio")}${esc(S.data.ais.message)}</div><div class="form-grid">${select(
      "Vessel data source",
      "provider",
      [["marinetraffic-client", "MarineTraffic · global vessel data"]],
      "marinetraffic-client",
    )}${field("Port tracking radius, km", "radius_km", p.integration.radius_km || 25, "number", 'min="1" max="5000" required')}${field("Position freshness, minutes", "freshness_minutes", p.integration.freshness_minutes || 30, "number", 'min="1" max="1440" required')}<div class="field full"><label class="check-row"><input type="checkbox" name="enabled" ${p.integration.enabled ? "checked" : ""}>Enable AIS vessel tracking for this port</label></div><div class="field full"><label>Connection status</label><p id="ais-connection-detail">${esc(P().aisStateLabel())}${S.data.ais.connected ? " · Connection active" : ""} · ${S.data.ais.positions.length} positions${S.data.ais.last_message_at ? " · Last report " + esc(P().date(S.data.ais.last_message_at)) : ""}</p></div></div><div class="form-actions"><button type="button" class="btn" id="test-integration">${icon("refresh-cw")}Check saved connection</button><button type="submit" class="btn primary" ${!can("config.edit") ? "disabled" : ""}>${icon("save")}Save tracking settings</button></div></form></section>`);
  if (S.configTab === "general") return renderPreferences();
  if (S.configTab === "dashboard-kpis") return renderKpiConfig();
  return empty("Select a configuration section");
}
async function savePort(changes) {
  const { S, api, path, refresh, toast } = P();
  await api(path(""), "PUT", { ...S.data.port, ...changes });
  S.ports = await api("/ports");
  await refresh();
  toast("Port configuration saved. Shared views now use the updated values.");
}
export function bindConfig() {
  const {
    S,
    can,
    $,
    $$,
    api,
    path,
    toast,
    renderApp,
    handleForm,
    modal,
    closeModal,
    refresh,
    esc,
    date,
    empty,
  } = P();
  $$("[data-config-tab]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await P().saveGeoBeforeNavigation();
        } catch (e) {
          toast(e.message, true);
          return;
        }
        S.configTab = b.dataset.configTab;
        if (S.configTab !== "geography") S.geoPlacement = null;
        S.ruleEditor = null;
        S.ruleCategory = null;
        S.connectorEditor = null;
        renderApp();
      }),
  );
  const exp = $("[data-action=export-geo]");
  if (exp) exp.onclick = exportGeo;
  if (S.configTab === "imports") {
    bindDocuments();
    return;
  }
  if (!P().can("config.view")) return;
  if (S.configTab === "geography") {
    P().importGeography = importGeo;
    initConfigMap();
  }
  if (S.configTab === "assets") {
    bindPortInventory();
    $$("[data-remove-asset]").forEach(b => b.onclick = () => {
      const kind = b.dataset.removeKind;
      const item = S.data[kind].find(x => x.id === b.dataset.removeAsset);
      confirmRemoval(path(`/${kind}/${item.id}?revision=${item.revision}`), item.name, "Linked vessel calls, workflows and infrastructure must be reassigned or removed first. Audit history is retained.");
    });
    $$("[data-place-asset]").forEach(
      (button) =>
        (button.onclick = () => {
          S.geoPlacement = {
            kind: button.dataset.placeKind,
            id: button.dataset.placeAsset,
            port: S.portId,
          };
          S.configTab = "geography";
          renderApp();
        }),
    );
    $$("[data-edit-berth]").forEach(
      (b) =>
        (b.onclick = () =>
          berthForm(S.data.berths.find((x) => x.id === b.dataset.editBerth))),
    );
    $$("[data-edit-equipment]").forEach(
      (b) =>
        (b.onclick = () =>
          equipmentForm(
            S.data.equipment.find((x) => x.id === b.dataset.editEquipment),
          )),
    );
    for (const a of ["add-berth", "add-equipment"])
      if ($("[data-action=" + a + "]"))
        $("[data-action=" + a + "]").onclick = () =>
          a === "add-berth" ? berthForm() : equipmentForm();
  }
  if (S.configTab === "ports") {
    $$("[data-remove-port]").forEach(b => b.onclick = () => {
      const port = S.ports.find(p => p.id === b.dataset.removePort);
      confirmRemoval(`/ports/${port.id}?revision=${port.revision}`, port.name, "Only empty ports can be removed. Audit history is retained.", async () => {
        S.ports = await api('/ports');
        if (S.portId === port.id) { S.portId = S.ports[0].id; localStorage.setItem('portside-port', S.portId); }
        await refresh();
      });
    });
    if ($("#port-directory-search"))
      $("#port-directory-search").oninput = (e) => {
        const q = e.target.value.toLowerCase();
        $$("[data-port-search]").forEach(
          (card) => (card.hidden = !card.dataset.portSearch.includes(q)),
        );
      };
    $$("[data-switch-port]").forEach(
      (b) =>
        (b.onclick = async () => {
          S.portId = b.dataset.switchPort;
          S.configTab = "assets";
          S.assetKind = "";
          S.geoPlacement = null;
          S.pending = {};
          S.undo = [];
          S.redo = [];
          S.date = null;
          localStorage.setItem("portside-port", S.portId);
          await refresh();
        }),
    );
    if ($("[data-action=new-port]"))
      $("[data-action=new-port]").onclick = () => portForm();
    $$("[data-edit-port]").forEach(b => b.onclick = () => portForm(S.ports.find(p => p.id === b.dataset.editPort)));
    if ($("[data-action=new-org]"))
      $("[data-action=new-org]").onclick = () => {
        modal(
          "Create an organization",
          `<form id="org-form">${P().field("Organization name", "name", "", "text", "required")}<div class="form-actions"><button class="btn primary" type="submit">Create organization</button></div></form>`,
        );
        handleForm("#org-form", async (d) => {
          await api("/organizations", "POST", d);
          closeModal();
          toast("Organization created. You can now create a port for it.");
        });
      };
  }
  if (S.configTab === "products") bindCatalog();
  if (S.configTab === "departments") bindDepartments();
  if (S.configTab === "rules" || S.configTab === "workflows") {
    bindRuleWorkbench();
    return;
  }
  if (S.configTab === "general") bindPreferences();
  if (S.configTab === "dashboard-kpis") bindKpiConfig();
  if (S.configTab === "integrations") {
    bindConnectors();

    const integrationPort = S.portId;
    const integrationForm = $("#integration-form");
    if (!can("config.edit")) integrationForm.querySelectorAll("input,select").forEach(input => input.disabled = true);
    const updateConnection = () => {
      $("#ais-connection-badge").textContent = P().aisStateLabel();
      const message = $("#ais-connection-message");
      message.textContent = S.data.ais.message || "No connection report available.";
      message.className = "notice " + (S.data.ais.mode === "live" ? "success" : "warning");
      $("#ais-connection-detail").textContent = `${P().aisStateLabel()} · ${S.data.ais.positions.length} positions${S.data.ais.last_message_at ? " · Last report " + P().date(S.data.ais.last_message_at) : ""}`;
    };
    const reloadConnection = async () => {
      const snapshot = await api("/ports/" + encodeURIComponent(integrationPort) + "/snapshot");
      if (S.portId !== integrationPort || !integrationForm.isConnected) return;
      S.data = snapshot;
      updateConnection();
    };
    handleForm("#integration-form", async (d) => {
      await api(path(""), "PUT", { ...S.data.port, integration: {
        ...d, enabled: d.enabled === "on", freshness_minutes: Number(d.freshness_minutes), radius_km: Number(d.radius_km),
      }});
      await reloadConnection();
      toast("Vessel tracking settings saved.");
    });
    $("#test-integration").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const result = await api(path("/integration/test"), "POST", {});
        toast(
          result.mode === "live" ? "AIS positions received." : result.message,
        );
        await reloadConnection();
      } catch (e) {
        toast(e.message, true);
      } finally {
        if ($("#test-integration")) $("#test-integration").disabled = false;
      }
    };
  }
  if (S.configTab === "users") {
    loadUsers();
    if ($("[data-action=new-user]"))
      $("[data-action=new-user]").onclick = () => userForm();
  }
}
function initConfigMap() {
  return initGeography({
    berthForm,
    equipmentForm,
    boundaryDialog,
    assignGeometry,
  });
}
async function apiSaveGeometry(g) {
  await P().api(P().path(""), "PUT", { ...P().S.data.port, boundary: g });
}
function boundaryDialog(geometry, beforeSave = async () => {}) {
  const { modal, handleForm, closeModal, refresh, icon, toast } = P();
  modal(
    "Set port boundary",
    `<form id="area-form"><div class="notice">${icon("map")}Use this polygon as the port boundary. Berths and equipment keep their own separate geometry.</div><div class="form-actions"><button class="btn primary" type="submit">Save port boundary</button></div></form>`,
  );
  handleForm("#area-form", async () => {
    await beforeSave();
    await apiSaveGeometry(geometry);
    closeModal();
    await refresh();
    toast("Port boundary saved.");
  });
}
function assignGeometry(kind, geometry, beforeSave) {
  const {
    S,
    modal,
    select,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
  } = P();
  const label = kind === "berths" ? "quay / berth" : "equipment";
  const target =
    S.geoPlacement?.port === S.portId && S.geoPlacement.kind === kind
      ? S.data[kind].find((x) => x.id === S.geoPlacement.id)
      : null;
  modal(
    target ? "Place " + target.name + " on the map" : "Assign drawn " + label,
    `<form id="assign-geometry-form">${target ? `<p class="config-description">Assign this position to <strong>${P().esc(target.name)}</strong>. Its operational settings will be preserved.</p><input type="hidden" name="asset" value="${P().esc(target.id)}">` : select("Select " + label, "asset", [["", "Create a new " + label], ...S.data[kind].map((x) => [x.id, (x.code ? x.code + " · " : "") + x.name])])}<div class="form-actions"><button class="btn primary" type="submit">${target ? "Save map position" : "Continue"}</button></div></form>`,
  );
  handleForm("#assign-geometry-form", async (d) => {
    if (!d.asset) {
      (kind === "berths" ? berthForm : equipmentForm)(
        null,
        geometry,
        beforeSave,
      );
      return;
    }
    await beforeSave();
    const fresh = await api(path("/" + kind));
    const item = fresh.find((x) => x.id === d.asset);
    if (!item)
      throw new Error("This asset no longer exists. Reload the configuration.");
    await api(path("/" + kind + "/" + item.id), "PUT", {
      ...item,
      geometry,
      map_visible: true,
    });
    S.geoPlacement = null;
    if (target) S.configTab = "assets";
    closeModal();
    await refresh();
    toast("Map geometry assigned to " + item.name + ".");
  });
}
export function berthForm(
  existing = null,
  geometry = null,
  beforeSave = async () => {},
) {
  const {
    S,
    modal,
    field,
    select,
    icon,
    esc,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
    can,
  } = P();
  const b = existing || {
    code: "B" + (S.data.berths.length + 1),
    name: "Berth " + String(S.data.berths.length + 1).padStart(2, "0"),
    terminal: "Main terminal",
    length: 300,
    max_loa: 280,
    max_draft: 14.5,
    status: "Available",
    buffer_hours: S.data.port.rules.buffer_hours ?? 1,
    cargo: S.data.port.products.map((p) => p.name),
    geometry,
  };
  modal(
    existing ? "Configure " + b.name : "Create a berth",
    `<form id="berth-form"><div class="form-grid">${field("Berth identifier", "code", b.code, "text", "required")}${field("Berth name", "name", b.name, "text", "required")}${field("Terminal", "terminal", b.terminal, "text", "required")}${field("Validated berth length, m", "length", b.length, "number", 'min="1" required')}${field("Maximum vessel length, m", "max_loa", b.max_loa, "number", 'min="1" required')}${field("Maximum permitted draft, m", "max_draft", b.max_draft, "number", 'min="0.1" step="0.1" required')}${field("Minimum turnaround buffer, h", "buffer_hours", b.buffer_hours, "number", 'min="0" step="0.25" required')}${select("Operating status", "status", ["Available", "Maintenance", "Closed"], b.status)}<div class="field full"><label>Compatible cargo products</label><div style="display:flex;gap:16px;flex-wrap:wrap">${S.data.port.products.map((p) => `<label class="check-row"><input type="checkbox" name="cargo" value="${esc(p.name)}" ${b.cargo.includes(p.name) ? "checked" : ""}>${esc(p.name)}</label>`).join("")}</div></div></div><div class="form-actions"><button class="btn primary" type="submit" ${!can("config.edit") ? "disabled" : ""}>${icon("save")}Save berth configuration</button></div></form>`,
  );
  handleForm("#berth-form", async (d, f) => {
    await beforeSave();
    for (const k of ["length", "max_loa", "max_draft", "buffer_hours"])
      d[k] = Number(d[k]);
    d.cargo = new FormData(f).getAll("cargo");
    await api(
      path("/berths" + (existing ? "/" + existing.id : "")),
      existing ? "PUT" : "POST",
      {
        ...b,
        ...d,
        geometry: geometry || b.geometry,
        map_visible: geometry ? true : !!b.geometry && b.map_visible !== false,
      },
    );
    closeModal();
    await refresh();
    toast("Berth saved. Dashboard geometry and planning rows updated.");
  });
}
function equipmentForm(
  existing = null,
  geometry = null,
  beforeSave = async () => {},
) {
  const {
    S,
    modal,
    field,
    select,
    icon,
    esc,
    handleForm,
    api,
    path,
    closeModal,
    refresh,
    toast,
    can,
  } = P();
  const e = existing || {
    name: "Shiploader " + (S.data.equipment.length + 1),
    type: "Shiploader",
    capacity: 1800,
    status: "Available",
    berths: [],
    geometry,
  };
  modal(
    existing ? "Configure equipment" : "Create port equipment",
    `<form id="equipment-form"><div class="form-grid">${field("Equipment name", "name", e.name, "text", "required")}${select("Equipment type", "type", ["Shiploader", "Unloader", "Conveyor", "Transfer point", "Storage", "Loading line", "Equipment station", "Other"], e.type)}${field("Rated handling capacity, t/h", "capacity", e.capacity, "number", 'min="1" required')}${select("Availability", "status", ["Available", "Outage", "Maintenance"], e.status)}<div class="field full"><label>Berths this equipment can physically serve</label><div style="display:flex;gap:17px;flex-wrap:wrap">${S.data.berths.map((b) => `<label class="check-row"><input type="checkbox" name="berths" value="${b.id}" ${e.berths.includes(b.id) ? "checked" : ""}>${esc(b.code)}</label>`).join("") || "<small>Create a berth before linking equipment.</small>"}</div></div></div><div class="form-actions"><button type="submit" class="btn primary" ${!can("config.edit") ? "disabled" : ""}>${icon("save")}Save equipment</button></div></form>`,
  );
  handleForm("#equipment-form", async (d, f) => {
    await beforeSave();
    d.capacity = Number(d.capacity);
    d.berths = new FormData(f).getAll("berths");
    await api(
      path("/equipment" + (existing ? "/" + existing.id : "")),
      existing ? "PUT" : "POST",
      {
        ...e,
        ...d,
        geometry: geometry || e.geometry,
        map_visible: geometry ? true : !!e.geometry && e.map_visible !== false,
      },
    );
    closeModal();
    await refresh();
    toast(
      "Equipment saved. Availability and compatibility now apply to planning.",
    );
  });
}
async function portForm(existing = null) {
  const {
    S,
    api,
    modal,
    field,
    select,
    icon,
    handleForm,
    closeModal,
    refresh,
    toast,
  } = P();
  try {
    const orgs = existing ? [] : await api("/organizations");
    const users = existing ? [] : await api(P().path("/users"));
    modal(
      existing ? "Edit port details" : "Create a port workspace",
      `<form id="port-form" aria-label="Port details"><div class="form-grid">${field("Port name", "name", existing?.name || "", "text", "required")}${field("Port code", "code", existing?.code || "", "text", "required")}${existing ? "" : select(
        "Organization",
        "org_id",
        orgs.map((o) => [o.id, o.name]),
        S.data.port.org_id,
      )}${existing ? "" : select(
        "Assign port administrator",
        "admin_id",
        users.map((u) => [u.id, u.name]),
        S.user.id,
      )}${field("Timezone", "timezone", existing?.timezone || "Africa/Casablanca", "text", "required")}${field("Center longitude", "longitude", existing?.center[0] ?? -8.617, "number", 'step="0.000001" min="-180" max="180" required')}${field("Center latitude", "latitude", existing?.center[1] ?? 33.113, "number", 'step="0.000001" min="-90" max="90" required')}</div><div class="form-actions"><button type="submit" class="btn primary">${icon(existing ? "save" : "plus")}${existing ? "Save changes" : "Create port & open map"}</button></div></form>`,
    );
    handleForm("#port-form", async (d) => {
      d.center = [Number(d.longitude), Number(d.latitude)];
      if (existing) {
        await api(`/ports/${encodeURIComponent(existing.id)}`, "PUT", {
          revision: existing.revision, name: d.name.trim(), code: d.code.trim(),
          timezone: d.timezone.trim(), center: d.center,
        });
        S.ports = await api("/ports");
        closeModal();
        await refresh();
        toast("Port details saved.");
        return;
      }
      const port = await api("/ports", "POST", d);
      S.ports = await api("/ports");
      S.portId = port.id;
      S.pending = {};
      S.undo = [];
      S.redo = [];
      S.date = null;
      S.configTab = "geography";
      closeModal();
      await refresh();
      toast(
        "Port created. Draw its boundary and infrastructure to get started.",
      );
    });
  } catch (e) {
    toast(e.message, true);
  }
}
async function loadUsers() {
  const { S, $, api, path, esc, empty, status, can, toast } = P();
  try {
    const port = S.portId;
    const rows = await api(path("/users"));
    if (S.portId !== port || S.configTab !== "users") return;
    S.configUsers = rows;
    if (!$("#users-list")) return;
    $("#users-list").innerHTML =
      `<div class="table-scroll"><table><thead><tr><th scope=\"col\">Person</th><th scope=\"col\">Department</th><th scope=\"col\">Port role</th><th scope=\"col\">Capabilities</th><th scope=\"col\"></th></tr></thead><tbody>${rows
        .map((u) => {
          const m = u.memberships.find((m) => m.port_id === S.portId);
          return `<tr><td><div class="vessel-cell">${esc(u.name)}</div><small class="subtle">${esc(u.email)}</small></td><td>${esc(m.department)}</td><td>${esc(m.role)}</td><td>${m.permissions.length} permissions</td><td>${can("users.edit") ? `<button class="btn small" data-edit-user="${u.id}">Edit access</button>${u.id !== S.user.id && (!u.superadmin || S.user.superadmin) ? `<button class="btn small danger" data-remove-user="${u.id}">Remove</button>` : ""}` : ""}</td></tr>`;
        })
        .join("")}</tbody></table></div>`;
    P().$$("[data-remove-user]").forEach(b => b.onclick = () => {
      const person = rows.find(u => u.id === b.dataset.removeUser);
      confirmRemoval(path(`/users/${person.id}/membership`), person.name, "This revokes access to this port. Their account, access to other ports and audit history are retained.", loadUsers);
    });
    P()
      .$$("[data-edit-user]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            userForm(rows.find((u) => u.id === b.dataset.editUser))),
      );
  } catch (e) {
    toast(e.message, true);
  }
}
async function userForm(existing = null) {
  const {
    S,
    api,
    modal,
    field,
    select,
    icon,
    esc,
    handleForm,
    path,
    closeModal,
    refresh,
    toast,
  } = P();
  try {
    const meta = await api("/meta/permissions");
    const m = existing?.memberships.find((m) => m.port_id === S.portId);
    const selected = m?.permissions || meta.roles.Viewer;
    modal(
      existing ? "Edit port access" : "Create a port user",
      `<form id="user-form"><div class="form-grid">${!existing ? field("Full name", "name", "", "text", "required") + field("Email address", "email", "", "email", "required") + field("Initial password", "password", "", "password", 'minlength="10" required') : ""}${select("Department", "department", [...S.data.port.departments, "Administration"], m?.department || "Operations")}${select("Role template", "template", Object.keys(meta.roles), m?.role || "Viewer")}${field("Role name", "role", m?.role || "Viewer", "text", "required")}<div class="field full"><label>Access permissions</label><div class="permission-grid">${meta.permissions.map((p) => `<label><input type="checkbox" name="permissions" value="${p}" ${selected.includes(p) ? "checked" : ""}>${esc(permissionLabels[p] || p.replaceAll(".", " "))}</label>`).join("")}</div><small>Select what this person is allowed to do at this port. Permission checks apply to every request.</small></div></div><div class="form-actions"><button type="submit" class="btn primary">${icon("save")}Save user access</button></div></form>`,
      true,
    );
    P().$("#f-template").onchange = (e) => {
      P().$("#f-role").value = e.target.value;
      P()
        .$$("[name=permissions]")
        .forEach(
          (i) => (i.checked = meta.roles[e.target.value].includes(i.value)),
        );
    };
    handleForm("#user-form", async (d, f) => {
      d.permissions = new FormData(f).getAll("permissions");
      if (existing) d.id = existing.id;
      await api(path("/users/save"), "POST", d);
      closeModal();
      S.user = await api("/auth/me");
      await refresh();
      toast("Port membership and permissions saved");
    });
  } catch (e) {
    toast(e.message, true);
  }
}
function exportGeo() {
  const { S } = P();
  const features = [];
  if (S.data.port.boundary)
    features.push({
      type: "Feature",
      properties: { kind: "boundary", name: "Port boundary" },
      geometry: S.data.port.boundary,
    });
  for (const kind of ["berths", "equipment", "zones"])
    for (const r of S.data[kind])
      features.push({
        type: "Feature",
        properties: { ...r, geometry: undefined, kind },
        geometry: r.geometry,
      });
  const blob = new Blob(
    [JSON.stringify({ type: "FeatureCollection", features }, null, 2)],
    { type: "application/geo+json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = S.data.port.code + "-geography.geojson";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importGeo() {
  const {
    modal,
    textArea,
    icon,
    handleForm,
    api,
    path,
    S,
    closeModal,
    refresh,
    toast,
  } = P();
  modal(
    "Import port GeoJSON",
    `<form id="geo-import-form"><div class="notice">${icon("upload")}Paste a FeatureCollection exported by Portside. Features require a kind property: boundary, berths, equipment, or zones. Imports add new records; boundaries replace the current boundary.</div>${textArea("GeoJSON FeatureCollection", "json", "", 'required placeholder="{\"type\":\"FeatureCollection\",\"features\":[…]}"')}<div class="form-actions"><button type="submit" class="btn primary">Validate & import</button></div></form>`,
    true,
  );
  handleForm("#geo-import-form", async (d) => {
    const geo = JSON.parse(d.json);
    if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features))
      throw new Error("Expected a GeoJSON FeatureCollection");
    const idMap = {};
    let portRevision = S.data.port.revision;
    for (const f of geo.features) {
      const { kind, id, revision, ...props } = f.properties || {};
      if (kind === "boundary") {
        const result = await api(path(""), "PUT", {
          ...S.data.port,
          revision: portRevision,
          boundary: f.geometry,
        });
        portRevision = result.revision;
      } else if (["berths", "equipment", "zones"].includes(kind)) {
        if (kind === "equipment")
          props.berths = (props.berths || []).map((id) => idMap[id] || id);
        const added = await api(path("/" + kind), "POST", {
          ...props,
          geometry: f.geometry,
        });
        if (id) idMap[id] = added.id;
      } else
        throw new Error("Unknown feature kind. Use an export from Portside.");
    }
    closeModal();
    await refresh();
    toast("GeoJSON imported. Port geometry and infrastructure updated.");
  });
}
