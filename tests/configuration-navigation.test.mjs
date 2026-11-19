import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig, bindConfig } from '../frontend/configuration.js';

test('port configuration exposes directory then inventory without redundant tabs', () => {
  const port = { id: 'port-1', name: 'Test port', code: 'TEST', timezone: 'UTC' };
  globalThis.window = { P: {
    S: { configTab: 'ports', portId: port.id, ports: [port], user: { superadmin: true }, data: { port, berths: [{ id: "berth-1", code: "B1", name: "Test berth", revision: 1 }], equipment: [] } },
    fmt: String, status: String, can: () => true, esc: String, icon: () => '', cardHead: () => '',
    btn: () => '', pageHeading: () => '', empty: () => '',
  } };
  try {
    const directory = renderConfig();
    assert.match(directory, /ports-directory/);
    assert.match(directory, /data-switch-port="port-1"/);
    assert.match(directory, /data-remove-port="port-1"/);
    assert.match(directory, /data-edit-port="port-1"/);
    window.P.S.user = { superadmin: false, memberships: [] };
    assert.doesNotMatch(renderConfig(), /data-edit-port/);
    window.P.S.user.memberships = [{ port_id: port.id, permissions: ['config.edit'] }];
    assert.match(renderConfig(), /data-edit-port="port-1"/);
    assert.doesNotMatch(directory, /config-section-tabs/);
    window.P.S.configTab = 'assets';
    const inventory = renderConfig();
    assert.match(inventory, /port-asset-table/);
    assert.match(inventory, /data-remove-asset="berth-1" data-remove-kind="berths"/);
    window.P.can = () => false;
    assert.doesNotMatch(renderConfig(), /data-remove-asset/);
    window.P.can = () => true;
    assert.match(inventory, /data-config-tab="ports"/);
    assert.doesNotMatch(inventory, /config-section-tabs/);
    assert.match(inventory, /config-nav[\s\S]*class="active" aria-pressed="true" data-config-tab="ports"/);
  } finally { delete globalThis.window; }
});

test('integration settings share one page and legacy AIS navigation resolves to it', () => {
  const port = { id: 'port-1', name: 'Test port', integration: { enabled: false, radius_km: 25, freshness_minutes: 30 } };
  globalThis.window = { P: {
    S: { configTab: 'integrations-ais', portId: port.id, data: { port, ais: { mode: 'offline', message: 'Offline', positions: [] } } },
    can: () => true, esc: String, icon: () => '', cardHead: () => '', btn: () => '', pageHeading: () => '', empty: () => '',
    field: (label, name) => `<label>${label}<input name="${name}"></label>`,
    select: (label, name) => `<label>${label}<select name="${name}"></select></label>`, aisStateLabel: () => 'Offline',
  } };
  try {
    const html = renderConfig();
    assert.equal(window.P.S.configTab, 'integrations');
    assert.match(html, /id="integration-form" aria-labelledby="ais-settings-title"/);
    assert.match(html, /id="connector-list"/);
    assert.match(html, /id="connector-editor-slot" hidden/);
    assert.match(html, /id="new-data-connector"/);
    assert.doesNotMatch(html, /config-section-tabs|connector-back|edit-ais-connector/);
    window.P.can = () => false;
    assert.doesNotMatch(renderConfig(), /id="new-data-connector"/);
  } finally { delete globalThis.window; }
});


test('editing another port saves only details without switching workspace', async () => {
  const port = { id: 'other', name: 'Other port', code: 'OTH', timezone: 'UTC', center: [-8, 33], revision: 7 };
  const button = { dataset: { editPort: port.id } };
  const requests = [];
  let submit, html;
  globalThis.window = { P: {
    S: { configTab: 'ports', portId: 'current', ports: [port], user: {}, data: {} },
    $: () => null, $$: selector => selector === '[data-edit-port]' ? [button] : [],
    can: () => true, icon: () => '',
    field: (label, name, value) => `<label>${label}<input name="${name}" value="${value}"></label>`,
    modal: (title, body) => { html = body; }, handleForm: (selector, fn) => { submit = fn; },
    closeModal: () => {}, refresh: async () => {}, toast: message => { if (/error/i.test(message)) assert.fail(message); },
    api: async (url, method, payload) => { requests.push({url, method, payload}); return [port]; },
  } };
  try {
    bindConfig();
    await button.onclick();
    assert.match(html, /value="Other port"/);
    assert.match(html, /Save changes/);
    assert.doesNotMatch(html, /name="admin_id"|name="org_id"/);
    await submit({ name: ' Updated ', code: ' NEW ', timezone: 'UTC', longitude: '-9', latitude: '32' });
    assert.deepEqual(requests[0], { url: '/ports/other', method: 'PUT', payload: { revision: 7, name: 'Updated', code: 'NEW', timezone: 'UTC', center: [-9, 32] } });
    assert.equal(window.P.S.portId, 'current');
  } finally { delete globalThis.window; }
});
