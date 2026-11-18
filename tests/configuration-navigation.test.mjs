import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig } from '../frontend/configuration.js';

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
