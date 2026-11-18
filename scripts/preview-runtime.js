/* Browser-only transport for the shareable preview. All edits stay in this browser. */
(() => {
  const original = window.fetch.bind(window);
  const initial = window.PORTSIDE_PREVIEW_DATA;
  const key = 'portside-preview-v1';
  let db;
  try { db = JSON.parse(localStorage.getItem(key)) || structuredClone(initial); }
  catch { db = structuredClone(initial); }
  const user = {id:'preview', name:'Preview administrator', email:'preview@portside.demo', org_id:initial.ports[0]?.org_id, superadmin:true, active:true, memberships:initial.ports.map(p=>({port_id:p.id, department:'Administration', role:'Preview administrator', permissions:initial.permissions}))};
  const save = () => { try { localStorage.setItem(key, JSON.stringify(db)); } catch {} };
  const reply = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
  const unavailable = () => reply({detail:'This action needs the running Portside server. This HTML preview includes navigation, records, configuration, vessel edits and local drafts. Live feeds, AI, imports, constraint validation, approval publication and optimization are available in the full app.'}, 409);
  const id = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  function updateStats(s) {
    const active = ['Loading','Unloading','Delayed','Waiting','Berthed'];
    s.stats.active = s.calls.filter(c=>active.includes(c.status)).length;
    const occupied = new Set(s.calls.filter(c=>['Loading','Unloading','Delayed','Berthed'].includes(c.status)).map(c=>c.berth_id).filter(Boolean));
    s.stats.utilization = s.berths.length ? Math.round(100*occupied.size/s.berths.length) : 0;
    s.stats.open_alerts = s.alerts.filter(a=>!['Resolved','Closed'].includes(a.status)).length;
    s.stats.delay_causes = {};
    s.delays.forEach(d=>s.stats.delay_causes[d.cause]=(s.stats.delay_causes[d.cause]||0)+Number(d.hours||0));
    s.stats.delay_hours = Object.values(s.stats.delay_causes).reduce((a,b)=>a+b,0);
  }
  window.fetch = async (input, options={}) => {
    const url = new URL(typeof input==='string'?input:input.url, 'https://preview.local');
    if (!url.pathname.startsWith('/api/')) return original(input, options);
    const route = url.pathname.slice(4), method=options.method||'GET';
    let data = {};
    try { if(options.body) data=JSON.parse(options.body); } catch { return unavailable(); }
    if (route.startsWith('/auth/')) return reply(route.endsWith('/logout')?{ok:true}:user);
    if (route==='/meta/permissions') return reply({permissions:initial.permissions, roles:{Administrator:initial.permissions}});
    if (route==='/organizations') return reply([...new Set(db.ports.map(p=>p.org_id))].map(id=>({id,name:'Preview organization'})));
    if (route==='/ports') {
      if(method!=='GET') return unavailable();
      return reply(db.ports);
    }
    const match = route.match(/^\/ports\/([^/]+)(.*)$/);
    if(!match) return unavailable();
    const s = db.snapshots[decodeURIComponent(match[1])], tail=match[2];
    if(!s) return reply({detail:'Port not included in this preview'},404);
    if(tail==='/snapshot') { updateStats(s); return reply(s); }
    if(tail==='/ais') return reply(s.ais);
    if(tail==='/audit') return reply([]);
    if(tail==='/users') return reply([user]);
    if(tail==='/intelligence/status') return reply({configured:false,message:'AI needs the running app. Browser preview is offline.'});
    if(tail==='/imports' && method==='GET') return reply({batches:[],templates:[]});
    if(tail==='/configuration/connectors' && method==='GET') return reply(s.connectors||[]);
    if(tail==='/notifications/read') {s.notifications.forEach(n=>n.read_by=[user.id]);save();return reply({ok:true});}
    if(tail==='' && method==='PUT') {
      s.port={...s.port,...data,revision:s.port.revision+1};
      db.ports=db.ports.map(p=>p.id===s.port.id?s.port:p);save();return reply(s.port);
    }
    if(tail==='/planning/drafts' && method==='POST') {
      const call=s.calls.find(c=>c.id===data.call_id);
      if(!call) return reply({detail:'Vessel not found'},404);
      const draft={id:id(),revision:1,call_id:call.id,before:structuredClone(call),proposed:{...call,...data.changes},reason:data.reason,author_id:user.id,author:user.name,status:'Draft',created_at:new Date().toISOString(),validation:{errors:[],warnings:['Preview draft. Server validation is required before submission.']},decisions:[],workflow:s.port.workflow||{}};
      s.drafts.push(draft);save();return reply(draft);
    }
    if(tail==='/configuration/departments' && method==='POST') {
      const list=s.port.departments;
      if(data.action==='add' && !list.includes(data.name))list.push(data.name);
      if(data.action==='rename') {
        s.port.departments=list.map(n=>n===data.name?data.new_name:n);
        s.port.workflow.departments=s.port.workflow.departments.map(n=>n===data.name?data.new_name:n);
      }
      if(data.action==='remove') {
        if(s.port.workflow.departments.includes(data.name))return reply({detail:'Remove the department from the approval route first.'},409);
        s.port.departments=list.filter(n=>n!==data.name);
      }
      save();return reply(s.port);
    }
    if(tail==='/configuration/geography' && method==='POST') {
      for(const change of data.changes||[]) {
        const row=s[change.kind]?.find(r=>r.id===change.id);
        if(row)Object.assign(row,change.action==='remove'?{geometry:null,map_visible:false}:{geometry:change.geometry,map_visible:true});
      }
      if('boundary' in data)s.port.boundary=data.boundary;
      s.port.revision++;save();return reply({ok:true,revision:s.port.revision});
    }
    if(tail.startsWith('/configuration/connectors') && method!=='GET') {
      const rid=tail.split('/')[3];s.connectors=s.connectors||[];
      if(method==='DELETE')s.connectors=s.connectors.filter(c=>c.id!==rid);
      else {const old=s.connectors.find(c=>c.id===rid||c.id===data.id);if(old)Object.assign(old,data);else s.connectors.push({...data,id:id(),revision:1});}
      save();return reply({ok:true});
    }
    if(tail==='/configuration/rules' && method==='POST') {
      s.port.rules={...s.port.rules,...(data.rules||{})};
      for(const b of data.berths||[]) {const current=s.berths.find(x=>x.id===b.id);if(current)Object.assign(current,b);}
      save();return reply(s.port);
    }
    const callAction=tail.match(/^\/calls\/([^/]+)\/(readiness|actuals)$/);
    if(callAction) {
      const call=s.calls.find(c=>c.id===callAction[1]);
      if(!call)return reply({detail:'Vessel not found'},404);
      Object.assign(call,data);call.revision++;save();return reply(call);
    }
    const record=tail.match(/^\/(berths|equipment|zones|calls|alerts|delays|drafts|versions|notifications|scenarios|source_plans|source_issues)(?:\/([^/]+))?$/);
    if(record) {
      const [,kind,rid]=record, rows=s[kind];
      if(method==='GET')return reply(rid?rows.find(r=>r.id===rid):rows);
      if(['drafts','versions','scenarios'].includes(kind))return unavailable();
      if(method==='DELETE') {s[kind]=rows.filter(r=>r.id!==rid);save();return reply({ok:true});}
      const old=rows.find(r=>r.id===rid);
      const row={...old,...data,id:rid||id(),revision:(old?.revision||0)+1};
      if(old)Object.assign(old,row);else rows.push(row);
      if(kind==='delays') {
        row.created_at=new Date().toISOString();row.status=row.status||'Open';
        const call=s.calls.find(c=>c.id===row.call_id);if(call)call.status='Delayed';
        s.alerts.push({id:id(),revision:1,title:'Operational delay',description:row.description,call_id:row.call_id,severity:'Medium',status:'Open',created_at:row.created_at,department:row.department,comments:[]});
      }
      updateStats(s);save();return reply(row);
    }
    return unavailable();
  };
  // Catch server downloads instead of navigating to missing file:// API paths.
  document.addEventListener('click', e=>{
    const anchor=e.target.closest('a[href^="/api"]');
    if(!anchor)return;
    e.preventDefault();
    const s=window.P?.S?.data;if(!s)return;
    const rows=s.calls, columns=['name','product','quantity','berth_id','eta','start','end','status'];
    const csv=[columns,...rows.map(r=>columns.map(c=>r[c]??''))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
    if(!anchor.href.includes('reports/')) {window.P?.toast('Original documents require the running application.',true);return;}
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='Portside-preview-vessel-calls.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    window.P?.toast('Preview exported vessel calls as CSV. PDF and Excel exports require the server.');
  });
  const style=document.createElement('style');
  style.textContent='#preview-controls{position:fixed;bottom:5px;left:8px;z-index:10000;background:#062e4b;color:white;padding:5px 9px;border-radius:6px;font:11px system-ui;box-shadow:0 1px 6px #0004}#preview-controls button{font:inherit;margin-left:8px;cursor:pointer;color:#062e4b;background:white;border:0;border-radius:3px;padding:3px 7px}';
  document.head.append(style);
  const bar=document.createElement('div');bar.id='preview-controls';
  bar.innerHTML='Shared HTML preview · edits stay in this browser <button id="preview-info">About</button><button id="preview-reset">Reset preview</button>';
  document.body.append(bar);
  document.getElementById('preview-info').onclick=()=>alert('Portside HTML preview\n\nIncludes the exported port records, original interface, maps, planning timeline, search, filters, vessel editing, configuration forms and local draft creation. Browser edits are saved locally when storage is available.\n\nLive AIS, AI, document uploads, report generation, optimization, server constraint validation and approval publication require the running application. KPI history is the exported snapshot; active counts, occupancy, alerts and delays update locally.\n\nMap backgrounds and external fonts require internet. This file contains operational records and can be opened by anyone you share it with.');
  document.getElementById('preview-reset').onclick=()=>{if(confirm('Reset all changes made in this preview?')){localStorage.removeItem(key);location.reload();}};
})();
