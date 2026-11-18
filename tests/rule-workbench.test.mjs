import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRuleWorkbench } from '../frontend/rule-workbench.js';

const setup = () => {
  globalThis.window = { P: {
    S: { data: { port: { name: 'Test port', departments: ['Operations'], rules: { custom_rules: [{ id: 'cargo-1', name: 'Sulfur restriction', effect: 'deny' }] }, workflow: { mode: 'sequential', departments: ['Operations'], steps: [{ name: 'Operations review', decision: 'all' }] } }, berths: [{ id: 'b1', code: 'B1', max_loa: 200, max_draft: 12, buffer_hours: 1 }], equipment: [{ id: 'e1', name: 'Crane', capacity: 100, status: 'Available', berths: ['b1'] }] } },
    esc: value => String(value).replaceAll('<', '&lt;'), icon: () => '', cardHead: title => `<h2>${title}</h2>`, can: () => true,
    field: (label, name) => `<label>${label}<input name="${name}"></label>`, select: (label, name) => `<label>${label}<select name="${name}"></select></label>`,
  } };
};

test('Rules opens with six categories and isolates each category’s settings', () => {
  setup();
  try {
    const hub = renderRuleWorkbench();
    assert.equal((hub.match(/data-rule-category=/g) || []).length, 6);
    assert.doesNotMatch(hub, /data-rule-page=/);
    const categories = { approvals: ['automation'], physical: [], equipment: [], cargo: ['cargo:cargo-1'], planning: ['defaults'], validation: ['constraints'] };
    for (const [category, expected] of Object.entries(categories)) {
      window.P.S.ruleCategory = category;
      const html = renderRuleWorkbench();
      const pages = [...html.matchAll(/data-rule-page="([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual(pages, expected);
      assert.match(html, /id="rule-categories-back"/);
      if (category === "physical") { assert.match(html, /id="add-asset-constraint"/); assert.doesNotMatch(html, /add-berth/); }
      if (category === "equipment") { assert.match(html, /id="add-asset-constraint"/); assert.doesNotMatch(html, /add-equipment/); }
      if (category === 'approvals') {
        assert.match(html, /Sequential/);
        assert.match(html, /Operations review/);
        assert.match(html, /id="add-workflow"/);
        assert.match(html, /data-workflow-edit="default"/);
        assert.match(html, /data-workflow-remove="default" disabled/);
      }
    }
  } finally { delete globalThis.window; }
});

test('category editors retain existing forms and hide cargo creation from viewers', () => {
  setup();
  try {
    window.P.S.ruleCategory = 'approvals';
    window.P.S.ruleEditor = 'workflow';
    const workflow = renderRuleWorkbench();
    assert.match(workflow, /id="workflow-add-step"/);
    assert.match(workflow, /id="workflow-step-count"/);
    assert.match(workflow, /workflow-canvas/);
    assert.match(workflow, /data-step-up/);
    assert.match(workflow, /← Approval workflows/);
    window.P.S.ruleCategory = 'cargo';
    window.P.S.ruleEditor = null;
    window.P.can = () => false;
    assert.doesNotMatch(renderRuleWorkbench(), /id="new-cargo-rule"/);
    window.P.S.ruleCategory = 'physical';
    window.P.S.data.berths = [];
    assert.match(renderRuleWorkbench(), /No additional constraints/);
  } finally { delete globalThis.window; }
});
