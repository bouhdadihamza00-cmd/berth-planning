import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewPageSize } from '../frontend/hmi.js';

test('overview record pages fit the tallest row and preserve access in small panels', () => {
  assert.equal(overviewPageSize([30, 42, 35], 130), 3);
  assert.equal(overviewPageSize([30, 42, 35], 80), 1);
  assert.equal(overviewPageSize([80], 20), 1);
  assert.equal(overviewPageSize([], 0), 1);
});
