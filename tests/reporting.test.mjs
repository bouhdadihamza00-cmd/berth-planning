import test from 'node:test';
import assert from 'node:assert/strict';
import {renderReports} from '../frontend/reporting.js';

function setup(result) {
  globalThis.window={P:{
    S:{portId:'test',customReportPort:'test',customReport:{dataset:'vessel_lineup',origin:'working',group_by:'none'},customReportResult:result,data:{port:{},calls:[],berths:[]}},
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>'',can:()=>true,
  }};
}
test('report provenance stays available on demand and escapes source notes',()=>{
  setup({title:'Vessel lineup',rows:[],fields:[],columns:[{id:'vessel',label:'Vessel',type:'string'}],summary:{records:0,vessels:0},notes:['<script>source note</script>'],total_rows:0,origin:'working'});
  try {
    const html=renderReports();
    assert.match(html,/<details class="report-data-notes"><summary>Data notes<\/summary>/);
    assert.match(html,/&lt;script&gt;/);
    assert.doesNotMatch(html,/<script>|report-data-notes" open/);
    assert.match(html,/id="report-dataset" name="dataset"/);
  } finally {delete globalThis.window;}
});
test('empty report workspace has concise instructions without promotional captions',()=>{
  setup(null);
  try {
    const html=renderReports();
    assert.match(html,/Choose your filters, then generate a preview/);
    assert.doesNotMatch(html,/YOUR OPERATIONAL DATA|01 Configure|report-empty-steps/);
  } finally {delete globalThis.window;}
});
