import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCatalog } from '../frontend/cargo.js';

test('grade and subgrade lists expose add/remove actions only to editors', () => {
  globalThis.window = { P: {
    S: { portId: 'p', catalogBrowsePort: 'p', catalogSelection: { product: 'Fertilizer' }, catalogFilters: {}, data: { port: { cargo_catalog: [{id:'spec-1', product:'Fertilizer', direction:'Export', grade:'DAP', subgrade:'EU'}] } } },
    can: () => true, esc: String, icon: () => '', status: String, cardHead: title => title, btn: label => label,
  } };
  try {
    assert.match(renderCatalog(), /Add grade \/ sub-grade/);
    assert.match(renderCatalog(), /class="catalog-row-actions"[\s\S]*data-catalog-edit="spec-1"[\s\S]*data-catalog-remove="spec-1"[\s\S]*Delete subgrade<\/button>/);
    window.P.can = () => false;
    assert.doesNotMatch(renderCatalog(), /data-catalog-remove|Add grade \/ sub-grade/);
  } finally { delete globalThis.window; }
});
