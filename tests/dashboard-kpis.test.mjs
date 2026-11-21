import test from 'node:test';
import assert from 'node:assert/strict';
import { kpiTone } from '../frontend/dashboard-kpis.js';

test('KPI threshold boundaries and unavailable readings use distinct tones', () => {
  for (const direction of ['higher', 'lower']) {
    const factor = direction === 'higher' ? -1 : 1;
    const definition = { thresholds: {direction, warning: 4 * factor, danger: 8 * factor} };
    assert.equal(kpiTone(definition, 0, 'info'), 'positive');
    assert.equal(kpiTone(definition, 4 * factor, 'info'), 'warning');
    assert.equal(kpiTone(definition, 8 * factor, 'info'), 'danger');
    assert.equal(kpiTone(definition, null, 'info'), 'neutral');
  }
  assert.equal(kpiTone({thresholds_enabled: false}, 30, 'danger'), 'info');
});
