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
    assert.match(inventory, /config-nav[\s\S]*class="active" data-config-tab="ports"/);
  } finally { delete globalThis.window; }
});
