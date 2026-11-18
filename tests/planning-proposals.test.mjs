import test from 'node:test';
import assert from 'node:assert/strict';
import { planningProposals } from '../frontend/planning.js';
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
