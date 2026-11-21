import test from 'node:test';
import assert from 'node:assert/strict';
import { overlapsScheduleComparison, planningProposals, proposalConnectorPath } from '../frontend/planning.js';
test('saved proposals persist through review until publication or cancellation', () => {
  const statuses = ['Draft', 'Submitted', 'Clarification requested', 'Approved', 'Published', 'Cancelled', 'Rejected'];
  const data = { drafts: statuses.map((status, i) => ({id: String(i), call_id: 'call', status, proposed: {name:'Vessel', berth_id:'B2'}})) };
  const result = planningProposals(data);
  assert.deepEqual(result.map(x => x.proposalStatus), statuses.slice(0,4));
  assert.ok(result.every(x => x.id === 'call' && x.berth_id === 'B2'));
  assert.equal(data.drafts[0].proposed.id, undefined);
});
test('unsaved changes and multiple saved alternatives remain independent', () => {
  const data = {drafts:[{id:'draft-1',call_id:'call',status:'Draft',proposed:{berth_id:'B2'}}, {id:'new',operation:'create',status:'Draft',proposed:{berth_id:'B3'}}]};
  const result = planningProposals(data, {call:{berth_id:'B4'}});
  assert.deepEqual(result.map(x => [x.proposalKey, x.berth_id]), [['draft-1','B2'], ['pending-call','B4']]);
});
test('only overlapping published and proposed intervals in a rendered berth row use comparison strips', () => {
  const published = {call: {}, left: 0, right: 100};
  const overlap = {call: {proposalKey: 'draft'}, left: 50, right: 75};
  const adjacent = {call: {proposalKey: 'pending'}, left: 100, right: 200};
  const cards = [published, overlap, adjacent];
  assert.deepEqual(cards.map(card => overlapsScheduleComparison(card, cards)), [true, true, false]);
  assert.equal(overlapsScheduleComparison(published, [published, adjacent]), false);
});
test('proposal arrows use facing edges and stay inside narrow gaps', () => {
  const origin = {left: 10, top: 20};
  const published = {left: 10, right: 110, top: 20, bottom: 52};
  const offset = {left: 75, right: 175, top: 66, bottom: 98};
  assert.equal(proposalConnectorPath(published, offset, origin), 'M 50 32 L 50 35.5 Q 50 39 53.5 39 L 111.5 39 Q 115 39 115 42.5 L 115 46');
  assert.equal(proposalConnectorPath(offset, published, origin), 'M 115 46 L 115 42.5 Q 115 39 111.5 39 L 53.5 39 Q 50 39 50 35.5 L 50 32');
  const later = {left: 130, right: 230, top: 20, bottom: 52};
  assert.equal(proposalConnectorPath(published, later, origin), 'M 100 16 C 110 16 110 16 120 16');
  assert.equal(proposalConnectorPath(later, published, origin), 'M 120 16 C 110 16 110 16 100 16');
});
