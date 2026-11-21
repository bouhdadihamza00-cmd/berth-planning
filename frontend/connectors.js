import { confirmRemoval } from "./removal.js?v=6";
const P = () => window.P;
const types = [
  ["erp", "ERP & internal business systems"],
  ["inventory", "Inventory & cargo readiness"],
  ["production", "Production & forecasts"],
  ["vessel_calls", "Vessel calls & schedules"],
  ["weather", "Weather & navigation"],
  ["equipment", "Equipment & handling rates"],
  ["quality", "Quality & laboratory results"],
];
export function renderConnectors(tracking = "") {
  const { icon, can } = P();
  return `<div class="integrations-page"><div class="integrations-intro"><h2>External integrations</h2><p>Vessel tracking and business-system connections.</p></div>${tracking}<section class="card integration-connectors"><div class="integration-section-heading"><div><h3 id="data-connectors-title">${icon("plug-zap")}Data connectors</h3><p>Saved connection definitions and field mappings.</p></div>${can("config.edit") ? `<button type="button" class="btn primary" id="new-data-connector">${icon("plus")}Add connector</button>` : ""}</div><div class="table-scroll"><table><thead><tr><th scope=\"col\">Name</th><th scope=\"col\">Protocol</th><th scope=\"col\">Data</th><th scope=\"col\">Status</th><th scope=\"col\">Actions</th></tr></thead><tbody id="connector-list"><tr><td colspan="5">Loading saved configurations…</td></tr></tbody></table></div><div id="connector-editor-slot" hidden></div></section></div>`;
}
export async function bindConnectors() {
  const { api, path, esc, can, toast, S } = P();
  const host = document.querySelector("#connector-list");
  if (!host) return;
  const port = S.portId;
  const add = document.querySelector("#new-data-connector");
  if (add) add.onclick = () => editor();
  if (S.connectorEditor?.port === port) {
    if (!document.querySelector("#data-connector-form")) editor(S.connectorEditor.id ? S.connectorEditor : null);
  } else S.connectorEditor = null;
  try {
    const rows = await api(path("/configuration/connectors"));
    if (!host.isConnected || port !== S.portId) return;
    host.innerHTML = rows.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td>${x.protocol === "opcua" ? "OPC UA" : "HTTP API"}</td><td>${esc(types.find(t => t[0] === x.data_type)?.[1] || x.data_type)}</td><td><span class="status amber">Not connected</span></td><td><div class="integration-row-actions"><button type="button" class="btn small" data-connector="${esc(x.id)}">${can("config.edit") ? "Configure" : "View"}</button>${can("config.edit") ? `<button type="button" class="btn small danger" data-remove-connector="${esc(x.id)}">Remove</button>` : ""}</div></td></tr>`).join("") || '<tr><td colspan="5"><div class="integration-empty"><strong>No data connectors configured</strong><span>Add an HTTP API or OPC UA connection.</span></div></td></tr>';
    host.querySelectorAll('[data-remove-connector]').forEach(button => button.onclick = () => {
      const item = rows.find(x => x.id === button.dataset.removeConnector);
      confirmRemoval(path('/configuration/connectors/' + item.id), item.name, 'Remove this saved connector and its mappings?', () => {
        if (!host.isConnected || S.portId !== port) return;
        if (S.connectorEditor?.id === item.id) closeEditor();
        return bindConnectors();
      }, { revision: item.revision });
    });
    host.querySelectorAll('[data-connector]').forEach(button => button.onclick = () => editor(rows.find(x => x.id === button.dataset.connector)));
    if (document.querySelector('#data-connector-form')) host.querySelectorAll('button').forEach(button => button.disabled = true);
  } catch (error) {
    if (!host.isConnected || port !== S.portId) return;
    host.innerHTML = `<tr><td colspan="5">${P().asyncState({ error: "Could not load connectors.", retry: "connectors" })}</td></tr>`;
    host.querySelector('[data-retry="connectors"]').onclick = () => bindConnectors();
    toast(error.message, true);
  }
}
function closeEditor() {
  P().S.connectorEditor = null;
  document.querySelectorAll('#new-data-connector,#connector-list button').forEach(button => button.disabled = false);
  const slot = document.querySelector('#connector-editor-slot');
  if (slot) { slot.hidden = true; slot.innerHTML = ""; }
  document.querySelector('#new-data-connector')?.focus({ preventScroll: true });
}
function connectorForm(existing) {
  const { field, select, icon, esc, can } = P();
  const c = existing || {
    protocol: "opcua",
    data_type: "equipment",
    security_mode: "SignAndEncrypt",
    security_policy: "Basic256Sha256",
    poll_seconds: 30,
    tags: [],
  };
  return `<form id="data-connector-form" aria-labelledby="connector-editor-title"><div class="form-grid">${field("Connector name", "name", c.name || "", "text", "required")}${select(
    "Protocol",
    "protocol",
    [
      ["api", "HTTP API"],
      ["opcua", "OPC UA"],
    ],
    c.protocol,
  )}${select("Data category", "data_type", types, c.data_type)}${field("Endpoint URL", "endpoint", c.endpoint || "", "text", 'required placeholder="opc.tcp://host:4840"')}${field("Poll interval, seconds", "poll_seconds", c.poll_seconds, "number", 'min="1" max="86400" required')}${field("Server credential reference", "credential_ref", c.credential_ref || "", "text", 'placeholder="CONNECTOR_CREDENTIAL"')}<div data-opc-fields>${select("Message security", "security_mode", ["SignAndEncrypt", "Sign", "None"], c.security_mode)}</div><div data-opc-fields>${select("Security policy", "security_policy", ["Basic256Sha256", "Aes128_Sha256_RsaOaep", "Aes256_Sha256_RsaPss", "None"], c.security_policy)}</div></div><div class="toolbar"><b>Read-only data mappings</b><div class="spacer"></div><button type="button" class="btn small" id="add-tag">${icon("plus")}Add mapping</button></div><details class="connector-mapping-help"><summary>Mapping help</summary><p>Use an OPC UA NodeId or API field path as the source, an operational field such as equipment.handling_rate as the destination, and its unit.</p></details><div class="table-scroll connector-tags"><table><thead><tr><th scope=\"col\">Source / NodeId</th><th scope=\"col\">Destination field</th><th scope=\"col\">Unit</th><th scope=\"col\"></th></tr></thead><tbody id="tag-rows"></tbody></table></div><p class="subtle">Saving stores the connection definition. It does not start a live data feed.</p><div class="form-actions">${existing && can("config.edit") ? '<button type="button" class="btn danger" id="delete-connector">Delete connector</button>' : ""}<button type="submit" class="btn primary" ${can("config.edit") ? "" : "disabled"}>Save configuration</button></div></form>`;
}
function editor(existing) {
  const slot = document.querySelector('#connector-editor-slot');
  if (!slot) return;
  const { S, esc, icon, can } = P();
  const invoker = document.activeElement;
  S.connectorEditor = { ...(existing || {}), port: S.portId };
  slot.hidden = false;
  document.querySelectorAll("#new-data-connector,#connector-list button").forEach(button => button.disabled = true);
  slot.innerHTML = `<div class="integration-section-heading"><h3 id="connector-editor-title">${icon("settings-2")}${existing ? esc(existing.name) : "New connector"}</h3><button type="button" class="btn" id="cancel-connector">${can("config.edit") ? "Cancel" : "Close"}</button></div><div class="form-body">${connectorForm(existing)}</div>`;
  document.querySelector('#cancel-connector').onclick = () => {
    closeEditor();
    if (invoker?.isConnected) invoker.focus({ preventScroll: true });
  };
  bindConnectorEditor(existing);
  if (!can("config.edit")) slot.querySelectorAll('input,select,textarea,form button').forEach(input => input.disabled = true);
  P().icons();
  slot.scrollIntoView({ block: 'nearest' });
  (slot.querySelector('input:not(:disabled)') || slot.querySelector('#cancel-connector'))?.focus({ preventScroll: true });
}
function bindConnectorEditor(existing) {
  const { field, select, icon, handleForm, api, path, toast, esc, can } = P();
  const form = document.querySelector("#data-connector-form");
  const port = P().S.portId;
  const c = existing || {
    protocol: "opcua",
    data_type: "equipment",
    security_mode: "SignAndEncrypt",
    security_policy: "Basic256Sha256",
    poll_seconds: 30,
    tags: [],
  };
  const addTag = (tag = { source: "", target: "", unit: "" }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input data-tag="source" aria-label="Source NodeId or API path" required value="${esc(tag.source)}"></td><td><input data-tag="target" aria-label="Destination field" required value="${esc(tag.target)}"></td><td><input data-tag="unit" aria-label="Engineering unit" value="${esc(tag.unit)}"></td><td><button type="button" class="btn small">Remove</button></td>`;
    tr.querySelector("button").onclick = () => tr.remove();
    document.querySelector("#tag-rows").append(tr);
  };
  c.tags.forEach(addTag);
  document.querySelector("#add-tag").onclick = () => addTag();
  const protocol = document.querySelector(
    "#data-connector-form [name=protocol]",
  );
  const show = () =>
    document
      .querySelectorAll("[data-opc-fields]")
      .forEach((x) => (x.hidden = protocol.value !== "opcua"));
  protocol.onchange = show;
  show();
  document
    .querySelector("#delete-connector")
    ?.addEventListener("click", async () => {
      try {
        await api(path("/configuration/connectors/" + c.id), "DELETE", {
          revision: c.revision,
        });
        if (!form.isConnected || P().S.portId !== port) return;
        closeEditor();
        await bindConnectors();
        toast("Connector removed.");
      } catch (e) {
        toast(e.message, true);
      }
    });
  handleForm("#data-connector-form", async (d) => {
    const tags = [...document.querySelectorAll("#tag-rows tr")].map((row) =>
      Object.fromEntries(
        [...row.querySelectorAll("[data-tag]")].map((i) => [
          i.dataset.tag,
          i.value,
        ]),
      ),
    );
    await api(path("/configuration/connectors"), "POST", {
      ...d,
      poll_seconds: Number(d.poll_seconds),
      tags,
      ...(existing ? { id: c.id, revision: c.revision } : {}),
    });
    if (!form.isConnected || P().S.portId !== port) return;
    closeEditor();
    await bindConnectors();
    toast("Connector configuration saved. No live connection started.");
  });
}
