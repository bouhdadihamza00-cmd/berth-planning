import { confirmRemoval } from "./removal.js?v=5";
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
export function renderConnectors() {
  const { cardHead, icon, can, S, esc } = P();
  if (S.connectorEditor)
    return `<button class="btn small" id="connector-back">← All integrations</button><section class="card connector-edit-page">${cardHead(S.connectorEditor.id ? "Edit integration" : "New integration", "plug-zap")}<div class="form-body">${connectorForm(S.connectorEditor.id ? S.connectorEditor : null)}</div></section>`;
  return `<section class="card">${cardHead("External integrations", "plug-zap")}<div class="toolbar"><div class="spacer"></div>${can("config.edit") ? `<button class="btn primary" id="new-data-connector">${icon("plus")}Add connector</button>` : ""}</div><div class="table-scroll"><table><thead><tr><th>Name</th><th>Protocol</th><th>Data</th><th>State</th><th></th></tr></thead><tbody id="ais-connector-row"><tr><td><strong>AIS vessel tracking</strong></td><td>${esc(S.data.port.integration.provider || "AIS API")}</td><td>Vessel positions</td><td>${esc(P().aisStateLabel())}</td><td><button class="btn small" id="edit-ais-connector">Configure</button></td></tr></tbody><tbody id="connector-list"><tr><td colspan="5">Loading saved configurations…</td></tr></tbody></table></div></section>`;
}
export async function bindConnectors() {
  const { api, path, esc, can, toast, S } = P();
  if (S.connectorEditor) {
    document.querySelector("#connector-back").onclick = () => {
      S.connectorEditor = null;
      P().renderApp();
    };
    bindConnectorEditor(S.connectorEditor.id ? S.connectorEditor : null);
    return;
  }
  document.querySelector("#edit-ais-connector").onclick = () => {
    S.configTab = "integrations-ais";
    P().renderApp();
  };
  const add = document.querySelector("#new-data-connector");
  if (add) add.onclick = () => editor();
  try {
    const rows = await api(path("/configuration/connectors"));
    const host = document.querySelector("#connector-list");
    if (!host) return;
    host.innerHTML =
      rows
        .map(
          (x) =>
            `<tr><td>${esc(x.name)}</td><td>${x.protocol === "opcua" ? "OPC UA" : "HTTP API"}</td><td>${esc(types.find((t) => t[0] === x.data_type)?.[1] || x.data_type)}</td><td>Not connected</td><td><button class="btn small" data-connector="${esc(x.id)}">${can("config.edit") ? "Configure" : "View"}</button>${can("config.edit") ? `<button class="btn small danger" data-remove-connector="${esc(x.id)}">Remove</button>` : ""}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="5">No data connectors configured.</td></tr>';
    host.querySelectorAll('[data-remove-connector]').forEach(b => b.onclick = () => {
      const item = rows.find(x => x.id === b.dataset.removeConnector);
      confirmRemoval(path('/configuration/connectors/' + item.id), item.name, 'Remove this saved connector and its mappings?', () => P().renderApp(), { revision: item.revision });
    });
    host
      .querySelectorAll("[data-connector]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editor(rows.find((x) => x.id === b.dataset.connector))),
      );
  } catch (e) {
    toast(e.message, true);
  }
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
  return `<form id="data-connector-form"><div class="form-grid">${field("Connector name", "name", c.name || "", "text", "required")}${select(
    "Protocol",
    "protocol",
    [
      ["api", "HTTP API"],
      ["opcua", "OPC UA"],
    ],
    c.protocol,
  )}${select("Data category", "data_type", types, c.data_type)}${field("Endpoint URL", "endpoint", c.endpoint || "", "text", 'required placeholder="opc.tcp://host:4840"')}${field("Poll interval, seconds", "poll_seconds", c.poll_seconds, "number", 'min="1" max="86400" required')}${field("Server credential reference", "credential_ref", c.credential_ref || "", "text", 'placeholder="JPH_FIELD_CREDENTIAL"')}<div data-opc-fields>${select("Message security", "security_mode", ["SignAndEncrypt", "Sign", "None"], c.security_mode)}</div><div data-opc-fields>${select("Security policy", "security_policy", ["Basic256Sha256", "Aes128_Sha256_RsaOaep", "Aes256_Sha256_RsaPss", "None"], c.security_policy)}</div></div><div class="toolbar"><b>Read-only data mappings</b><div class="spacer"></div><button type="button" class="btn small" id="add-tag">${icon("plus")}Add mapping</button></div><p class="subtle">Source: OPC UA NodeId or API field path. Destination: operational field name, for example equipment.handling_rate. Unit: t/h, %, or blank.</p><div class="table-scroll connector-tags"><table><thead><tr><th>Source / NodeId</th><th>Destination field</th><th>Unit</th><th></th></tr></thead><tbody id="tag-rows"></tbody></table></div><div class="notice">Not connected</div><div class="form-actions">${existing && can("config.edit") ? '<button type="button" class="btn danger" id="delete-connector">Delete connector</button>' : ""}<button type="submit" class="btn primary" ${can("config.edit") ? "" : "disabled"}>Save configuration</button></div></form>`;
}
function editor(existing) {
  P().S.connectorEditor = existing || {};
  P().renderApp();
}
function bindConnectorEditor(existing) {
  const { field, select, icon, handleForm, api, path, toast, esc, can } = P();
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
        P().S.connectorEditor = null;
        P().renderApp();
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
    P().S.connectorEditor = null;
    P().renderApp();
    toast("Connector configuration saved. No live connection started.");
  });
}
