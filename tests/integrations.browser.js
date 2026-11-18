// Run in the signed-in app. All writes are mocked; existing operational data is restored.
async () => {
  const P = window.P, savedApi = P.api, savedData = P.S.data, savedCan = P.can;
  const savedEditor = P.S.connectorEditor, savedTab = P.S.configTab;
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const wait = async condition => { for (let i=0;i<50&&!condition();i++) await new Promise(r=>setTimeout(r,50)); check(condition(), 'UI did not settle'); };
  let rows = [], writes = [], tracking = null;
  const sample = { id:'ui-test', revision:1, name:'Test connection', protocol:'api', data_type:'equipment', endpoint:'https://example.org/data', poll_seconds:30, tags:[] };
  P.api = async (path, method='GET', data) => {
    if (path.endsWith('/configuration/connectors')) {
      if (method === 'POST') { writes.push(data); rows=[{...sample,...data}]; return rows[0]; }
      return rows;
    }
    if (path.endsWith('/integration/test')) return { mode:'offline', message:'Test connection status' };
    if (method === 'PUT' && path === '/ports/'+P.S.portId) { tracking=data.integration;return data; }
    if (path.endsWith('/snapshot')) return {...savedData,port:{...savedData.port,integration:tracking || savedData.port.integration}};
    throw Error('Unexpected API request: '+method+' '+path);
  };
  try {
    P.S.configTab='integrations'; P.S.connectorEditor=null;
    await P.nav('configuration');
    await wait(()=>document.querySelector('.integration-empty'));
    check(!document.querySelector('.config-section-tabs'), 'Nested integration tabs remain');
    const radius=document.querySelector('#integration-form [name=radius_km]');
    radius.value='4999';
    document.querySelector('#new-data-connector').click();
    check(document.querySelector('#integration-form') && document.querySelector('#data-connector-form'), 'Editor replaced the integration page');
    check(document.querySelector('#data-connector-form').getAttribute('aria-labelledby')==='connector-editor-title','Unnamed connector form');
    const set=(name,value)=>{ const input=document.querySelector('#data-connector-form [name='+name+']');input.value=value;input.dispatchEvent(new Event('change')); };
    set('name','Test connection');set('protocol','api');set('endpoint','https://example.org/data');
    check([...document.querySelectorAll('[data-opc-fields]')].every(el=>el.hidden),'API form shows OPC UA fields');
    document.querySelector('#add-tag').click();
    document.querySelector('[data-tag=source]').value='rate';document.querySelector('[data-tag=target]').value='equipment.handling_rate';
    document.querySelector('#data-connector-form').requestSubmit();
    await wait(()=>!document.querySelector('#data-connector-form'));
    check(writes.length===1 && writes[0].tags[0].source==='rate','Connector mappings were lost');
    check(radius.isConnected && radius.value==='4999','Connector save discarded tracking draft');
    document.querySelector('[data-connector]').click();
    document.querySelector('#data-connector-form [name=name]').value='Unsaved connector edit';
    document.querySelector('#integration-form').requestSubmit();
    await wait(()=>tracking && !document.querySelector('#integration-form [type=submit]').disabled);
    check(tracking.radius_km===4999,'Tracking settings were not normalized');
    check(document.querySelector('#data-connector-form [name=name]').value==='Unsaved connector edit','Tracking save discarded connector draft');
    document.querySelector('#test-integration').click();
    await wait(()=>!document.querySelector('#test-integration').disabled);
    check(document.querySelector('#data-connector-form [name=name]').value==='Unsaved connector edit','Connection check discarded connector draft');
    document.querySelector('#cancel-connector').click();
    check(radius.value==='4999','Cancel discarded tracking draft');
    P.can=permission=>permission==='config.edit'?false:savedCan(permission);
    P.renderApp();await wait(()=>document.querySelector('[data-connector]'));
    document.querySelector('[data-connector]').click();
    check([...document.querySelectorAll('#data-connector-form input,#data-connector-form select,#data-connector-form button')].every(input=>input.disabled),'Read-only connector can be edited');
    check([...document.querySelectorAll('#integration-form input,#integration-form select')].every(input=>input.disabled),'Read-only tracking settings can be edited');
    return { passed:['single page','inline editor','protocol fields','mapping save','independent drafts','tracking save','connection check','cancel','read-only access'], realWrites:0 };
  } finally {
    P.api=savedApi;P.can=savedCan;P.S.data=savedData;P.S.connectorEditor=savedEditor;P.S.configTab=savedTab;P.renderApp();
  }
}
