from .approval_workflow import normalize_workflow, reviewers, capture_workflow, decision_step, completed
import csv, hashlib, io, json, math, os, secrets, sqlite3, time
import asyncio
from contextlib import asynccontextmanager, suppress
from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
from pathlib import Path
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from .store import *
from .planning import dt, validate, optimize
from .policies import normalize_rules, approval_eligibility
from .ais import positions
from .ais_marinetraffic_client import collector as marinetraffic_client_collector
from .catalog import normalize_timing,match_cargo,check_catalog,product_types

@asynccontextmanager
async def lifespan(app):
    initialize()
    from .marine import run as run_marine
    marine_task = asyncio.create_task(run_marine())
    client_task = asyncio.create_task(marinetraffic_client_collector.run())
    try:
        yield
    finally:
        marine_task.cancel()
        with suppress(asyncio.CancelledError):
            await marine_task
        client_task.cancel()
        with suppress(asyncio.CancelledError):
            await client_task
app=FastAPI(title='Portside Operations API',version='1.0.0',lifespan=lifespan)

@app.exception_handler(ValueError)
async def value_error(request,exc): return Response(json.dumps({'detail':str(exc)}),status_code=409 if 'changed' in str(exc) else 422,media_type='application/json')

@app.middleware('http')
async def security(request,call_next):
    if request.method not in ['GET','HEAD','OPTIONS']:
        origin=request.headers.get('origin')
        if origin and origin!=str(request.base_url).rstrip('/'):
            return Response('{"detail":"Cross-origin mutation denied"}',status_code=403,media_type='application/json')
        if request.headers.get('content-length','0').isdigit() and int(request.headers.get('content-length','0'))>(12*1024*1024 if request.url.path.endswith('/imports/upload') else 2_000_000):
            return Response(status_code=413)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'; response.headers['Referrer-Policy']='same-origin'
    if request.url.path.startswith('/api/'): response.headers['Cache-Control']='no-store'
    return response

def user(c,request):
    token=request.cookies.get('portside_session','')
    row=c.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
    if not row: raise HTTPException(401,'Sign in to continue')
    return dict(row)

def access(c,request,port,permission='dashboard.view'):
    u=user(c,request); p=c.execute('SELECT * FROM ports WHERE id=?',(port,)).fetchone()
    m=c.execute('SELECT * FROM memberships WHERE user_id=? AND port_id=?',(u['id'],port)).fetchone()
    if not p or (not u['superadmin'] and (not m or p['org_id']!=u['org_id'])): raise HTTPException(403,'You do not have access to this port')
    if not u['superadmin'] and permission not in json.loads(m['permissions']): raise HTTPException(403,f'Permission required: {permission}')
    data=dict(json.loads(p['data']),id=p['id'],org_id=p['org_id'],revision=p['revision'])
    return u,data

def safe_user(c,u):
    return {k:u[k] for k in ['id','name','email','org_id','superadmin','active']} | {'memberships':[dict(m,permissions=json.loads(m['permissions'])) for m in c.execute('SELECT port_id,department,role,permissions FROM memberships WHERE user_id=?',(u['id'],))]}

_LOGIN_ATTEMPTS={}
@app.post('/api/auth/login')
async def login(request:Request,response:Response):
    d=await request.json(); ip=request.client.host; cutoff=time.time()-60; attempts=[t for t in _LOGIN_ATTEMPTS.get(ip,[]) if t>cutoff]
    if len(attempts)>=20: raise HTTPException(429,'Too many sign-in attempts. Try again in a minute.')
    _LOGIN_ATTEMPTS[ip]=attempts+[time.time()]
    with connect() as c:
        u=c.execute('SELECT * FROM users WHERE lower(email)=? AND active=1',(str(d.get('email','')).lower(),)).fetchone()
        if not u or not verify_password(str(d.get('password','')),u['password']): raise HTTPException(401,'Incorrect email or password')
        token=secrets.token_urlsafe(40)
        c.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],time.time()+43200))
        response.set_cookie('portside_session',token,httponly=True,samesite='strict',secure=request.url.scheme=='https',max_age=43200)
        return safe_user(c,u)

@app.post('/api/auth/logout')
async def logout(request:Request,response:Response):
    with connect() as c: c.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(request.cookies.get('portside_session','').encode()).hexdigest(),))
    response.delete_cookie('portside_session'); return {'ok':True}

@app.get('/api/auth/me')
def me(request:Request):
    with connect() as c: return safe_user(c,user(c,request))

@app.get('/api/ports')
def ports(request:Request):
    with connect() as c:
        u=user(c,request)
        rows=c.execute('SELECT * FROM ports').fetchall() if u['superadmin'] else c.execute('SELECT p.* FROM ports p JOIN memberships m ON p.id=m.port_id WHERE m.user_id=? AND p.org_id=?',(u['id'],u['org_id'])).fetchall()
        return [dict(json.loads(r['data']),id=r['id'],revision=r['revision'],org_id=r['org_id']) for r in rows]

@app.post('/api/ports')
async def new_port(request:Request):
    d=await request.json()
    with connect() as c:
        u=user(c,request)
        if not u['superadmin']: raise HTTPException(403,'Super Administrator required to create a port')
        if not str(d.get('name','')).strip(): raise HTTPException(422,'Port name is required')
        id=uid(); org=d.get('org_id',u['org_id'])
        if not c.execute('SELECT 1 FROM organizations WHERE id=?',(org,)).fetchone(): raise HTTPException(422,'Unknown organization')
        data=dict(name=d['name'],code=d.get('code','PORT'),timezone=d.get('timezone','Africa/Casablanca'),center=d.get('center',[0,0]),zoom=2,brand='Portside',boundary=None,mode='live',departments=['Production','Supply Chain','Operations'],products=[],rules={'buffer_hours':1},workflow={'departments':['Operations'],'segregation':True,'mode':'parallel'},integration={'enabled':False,'provider':'marinetraffic-client','freshness_minutes':30})
        check_port(data)
        c.execute('INSERT INTO ports(id,org_id,data) VALUES(?,?,?)',(id,org,json.dumps(data)))
        admin=d.get('admin_id',u['id'])
        au=c.execute('SELECT * FROM users WHERE id=?',(admin,)).fetchone()
        if not au or (au['org_id']!=org and not au['superadmin']): raise HTTPException(422,'Port administrator must belong to this organization')
        c.execute('INSERT INTO memberships VALUES(?,?,?,?,?)',(admin,id,'Administration','Administrator',json.dumps(PERMISSIONS)))
        audit(c,id,u['id'],'port.created',id,data)
        return dict(data,id=id,revision=1)

@app.get('/api/organizations')
def organizations(request:Request):
    with connect() as c:
        u=user(c,request)
        return [dict(r) for r in c.execute('SELECT * FROM organizations'+('' if u['superadmin'] else ' WHERE id=?'),() if u['superadmin'] else (u['org_id'],))]

@app.post('/api/organizations')
async def new_org(request:Request):
    d=await request.json()
    with connect() as c:
        u=user(c,request)
        if not u['superadmin']: raise HTTPException(403,'Super Administrator required')
        if not d.get('name'): raise HTTPException(422,'Name required')
        id=uid(); c.execute('INSERT INTO organizations VALUES(?,?)',(id,d['name'])); audit(c,None,u['id'],'organization.created',id,d)
        return {'id':id,'name':d['name']}

def check_geometry(g,types=None):
    if g is None: return
    if not isinstance(g,dict) or g.get('type') not in (types or ['Point','LineString','Polygon','MultiPolygon']): raise HTTPException(422,'Invalid GeoJSON geometry type')
    def point(p):
        if not isinstance(p,list) or len(p)!=2 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in p) or not -180<=p[0]<=180 or not -90<=p[1]<=90: raise HTTPException(422,'Coordinates must be [longitude, latitude]')
    def line(points,minlen):
        if len(points)<minlen: raise HTTPException(422,'Geometry has too few vertices')
        for p in points: point(p)
    def polygon(rings):
        if not rings: raise HTTPException(422,'Polygon requires a ring')
        for ring in rings:
            line(ring,4)
            if ring[0]!=ring[-1]: raise HTTPException(422,'Polygon ring must be closed')
            if abs(sum(ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1] for i in range(len(ring)-1)))<1e-12: raise HTTPException(422,'Polygon has zero area')
            def orientation(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
            for i in range(len(ring)-1):
                for j in range(i+2,len(ring)-1):
                    if i==0 and j==len(ring)-2: continue
                    a,b,d,e=ring[i],ring[i+1],ring[j],ring[j+1]
                    if orientation(a,b,d)*orientation(a,b,e)<0 and orientation(d,e,a)*orientation(d,e,b)<0: raise HTTPException(422,'Polygon intersects itself')
    coords=g.get('coordinates',[])
    if g['type']=='Point': point(coords)
    elif g['type']=='LineString': line(coords,2)
    elif g['type']=='Polygon': polygon(coords)
    else:
        if not coords: raise HTTPException(422,'Empty MultiPolygon')
        for p in coords: polygon(p)

def check_port(d):
    for field in ["name", "code"]:
        if not isinstance(d.get(field), str) or not d[field].strip(): raise HTTPException(422, f"Port {field} is required")
        d[field] = d[field].strip()
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try: ZoneInfo(d.get('timezone','UTC'))
    except (ZoneInfoNotFoundError,ValueError): raise HTTPException(422,'Invalid time zone')
    if not isinstance(d.get('departments'),list) or not d['departments'] or any(not isinstance(x,str) or not x.strip() for x in d['departments']) or len({x.casefold() for x in d['departments']})!=len(d['departments']): raise HTTPException(422,'Department names must be non-empty and unique')
    if 'cargo_catalog' in d: check_catalog(d['cargo_catalog'])
    d['rules']=normalize_rules(d.get('rules',{}))
    rules=d['rules']
    for k,lo,hi in [('buffer_hours',0,168),('default_duration_hours',0.25,720)]:
        if k in rules and (not isinstance(rules[k],(int,float)) or not math.isfinite(rules[k]) or not lo<=rules[k]<=hi): raise HTTPException(422,'Invalid planning rule: '+k)
    if rules.get('snap_minutes',15) not in [5,10,15,30,60]: raise HTTPException(422,'Choose a supported time increment')
    check_geometry(d.get('boundary'),['Polygon'])
    check_geometry({'type':'Point','coordinates':d.get('center',[])})
    if d.get('workflow',{}).get('mode','parallel') not in ['parallel','sequential']: raise HTTPException(422,'Workflow must be parallel or sequential')
    workflow=d.get('workflow',{})
    if workflow.get('approval_mode','manual') not in ['manual','semi','automatic']: raise HTTPException(422,'Choose manual, semi-automatic or automatic approval')
    for key in ['auto_max_shift_hours','auto_max_duration_change_hours']:
        value=workflow.get(key,2)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=720: raise HTTPException(422,'Automation thresholds must be between 0 and 720 hours')
    if not isinstance(workflow.get('auto_allow_berth_change',False),bool): raise HTTPException(422,'Berth reassignment setting must be true or false')
    config=d.get('integration', {})
    if config.get('provider', 'marinetraffic-client') != 'marinetraffic-client': raise HTTPException(422,'Select a supported AIS provider')
    for name, default, minimum, maximum in [('radius_km',25,1,5000),('freshness_minutes',30,1,1440),('refresh_seconds',300,60,3600)]:
        value=config.get(name, default)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not minimum<=value<=maximum: raise HTTPException(422,f'{name} must be between {minimum} and {maximum}')
    if any(x not in d.get('departments',[]) for x in d.get('workflow',{}).get('departments',[])): raise HTTPException(422,'Approval departments must be configured departments')

@app.put('/api/ports/{port}')
async def save_port(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'config.edit')
        if d.get('revision')!=p['revision']: raise ValueError('Port configuration changed. Reload before saving.')
        allowed=['name','code','timezone','center','zoom','boundary','brand','departments','products','cargo_catalog','rules','workflow','workflow_templates','integration']
        for k in allowed:
            if k in d: p[k]=d[k]
        if 'workflow_templates' not in d:
            p['workflow']=normalize_workflow(p.get('workflow',{}),p.get('departments',[]),reviewers(c,port))
        if 'workflow_templates' in p:
            templates=p['workflow_templates']
            if not isinstance(templates,list) or not 1<=len(templates)<=50: raise HTTPException(422,'Keep between 1 and 50 workflow templates')
            normalized=[]; seen=set()
            for template in templates:
                if not isinstance(template,dict) or not isinstance(template.get('id'),str) or not template['id'] or len(template['id'])>120 or template['id'] in seen: raise HTTPException(422,'Workflow references must be unique')
                name=template.get('name','')
                if not isinstance(name,str) or not name.strip() or len(name)>120: raise HTTPException(422,'Workflow name must contain 1 to 120 characters')
                if 'steps' not in template: raise HTTPException(422,'Define at least one workflow step')
                if template.get('mode') not in ['sequential','parallel'] or not isinstance(template.get('segregation'),bool): raise HTTPException(422,'Choose workflow execution and author approval settings')
                seen.add(template['id'])
                normalized.append(normalize_workflow({k:template[k] for k in ['id','name','steps','mode','segregation','departments'] if k in template},p['departments'],reviewers(c,port)))
            active=p['workflow'].get('template_id','default')
            if not isinstance(active,str) or active not in seen: raise HTTPException(409,'Activate another workflow before removing the active one')
            if 'workflow_templates' in d:
                selected=next(t for t in normalized if t['id']==active)
                p['workflow']={**p['workflow'],**{k:selected[k] for k in ['steps','mode','segregation','departments'] if k in selected},'template_id':active,'name':selected['name']}
            else:
                normalized=[{**t,**{k:p['workflow'][k] for k in ['steps','mode','segregation','departments'] if k in p['workflow']}} if t['id']==active else t for t in normalized]
            p['workflow_templates']=normalized
        p['workflow']=normalize_workflow(p.get('workflow',{}),p.get('departments',[]),reviewers(c,port))
        check_port(p)
        p['rules']=normalize_rules(p['rules'],[b['id'] for b in records(c,port,'berths')],[e['id'] for e in records(c,port,'equipment')])
        if 'cargo_catalog' in d: p['products']=product_types(p['cargo_catalog'],p.get('products',[]))
        used={r['department'] for r in c.execute('SELECT department FROM memberships WHERE port_id=?',(port,))}
        if any(x not in p['departments'] and x!='Administration' for x in used): raise HTTPException(409,'Reassign department members before removing their department')
        # Integration settings cannot accept or expose credentials.
        p['integration']={k:v for k,v in p.get('integration',{}).items() if k in ['enabled','provider','freshness_minutes','radius_km']}
        revision=p.pop('revision'); p.pop('id'); p.pop('org_id')
        updated=c.execute('UPDATE ports SET data=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(p),port,revision))
        if updated.rowcount!=1: raise ValueError('Port configuration changed. Reload before saving.')
        audit(c,port,u['id'],'port.updated',port,p)
        put(c,port,'config_versions',dict(created_at=now(),author=u['name'],port=p,berths=records(c,port,'berths'),equipment=records(c,port,'equipment')))
        notification(c,port,'Configuration updated','The dashboard and planning constraints use the saved configuration.')
        return dict(p,id=port,revision=revision+1)

def stats(c,port):
    config=json.loads(c.execute('SELECT data FROM ports WHERE id=?',(port,)).fetchone()['data'])
    calls=records(c,port,'calls'); berths=records(c,port,'berths'); delays=records(c,port,'delays'); alerts=records(c,port,'alerts')
    active=[x for x in calls if x['status'] in ['Loading','Unloading','Delayed','Waiting','Berthed']]
    t=dt(config["demo_clock"]) if config.get("demo_clock") else datetime.now(timezone.utc); start=t-timedelta(days=30); prev=start-timedelta(days=30)
    completed=[x for x in calls if x['status']=='Completed' and x.get('actual_end') and start<=dt(x['actual_end'])<=t]
    previous=[x for x in calls if x['status']=='Completed' and x.get('actual_end') and prev<=dt(x['actual_end'])<start]
    wait=[max(0,(dt(x['actual_start'])-dt(x['actual_arrival'])).total_seconds()/3600) for x in completed if x.get('actual_start') and x.get('actual_arrival')]
    turn=[(dt(x['actual_departure'])-dt(x['actual_arrival'])).total_seconds()/3600 for x in completed if x.get('actual_departure') and x.get('actual_arrival')]
    adherence=[abs((dt(x['actual_start'])-dt(x['planned_start'])).total_seconds())<=3600 for x in completed if x.get('actual_start') and x.get('planned_start')]
    occupied={x.get('berth_id') for x in calls if x['status'] in ['Loading','Unloading','Delayed','Berthed']}
    products=[]
    p=json.loads(c.execute('SELECT data FROM ports WHERE id=?',(port,)).fetchone()['data'])
    for product in p.get('products',[]):
        q=sum(float(x['quantity']) for x in completed if x['product']==product['name']); old=sum(float(x['quantity']) for x in previous if x['product']==product['name'])
        products.append(dict(product,quantity=q,previous=old,change=round((q-old)/old*100,1) if old else None))
    causes={}
    for d in delays: causes[d['cause']]=round(causes.get(d['cause'],0)+float(d['hours']),2)
    conflicts=[]
    for x in calls:
        if x['status'] not in ['Completed','Cancelled']:
            v=validate(x,calls,berths,records(c,port,'equipment'),p.get('rules',{}))
            if v['errors']: conflicts.append({'call_id':x['id'],'name':x['name'],'errors':v['errors']})
    return dict(active=len(active),upcoming=sum(x['status'] in ['Scheduled','Waiting'] and t<=dt(x['eta'])<=t+timedelta(hours=48) for x in calls),utilization=round(len(occupied)/len(berths)*100) if berths else 0,waiting=round(sum(wait)/len(wait),1) if wait else None,turnaround=round(sum(turn)/len(turn),1) if turn else None,adherence=round(sum(adherence)/len(adherence)*100) if adherence else None,delay_hours=round(sum(causes.values()),1),conflicts=conflicts,open_alerts=sum(a['status'] not in ['Resolved','Closed'] for a in alerts),products=products,delay_causes=causes,period='Last 30 days',completed=len(completed))

@app.get('/api/ports/{port}/ais')
def ais_positions(port:str,request:Request):
    with connect() as c:
        _,p=access(c,request,port)
        return positions(p,records(c,port,'calls'))

@app.get('/api/ports/{port}/marine')
def port_marine(port:str,request:Request):
    from .marine import snapshot
    with connect() as c:
        _,p=access(c,request,port)
    return snapshot(p)

@app.get('/api/ports/{port}/weather')
def port_weather(port:str,request:Request):
    from .weather import weather
    with connect() as c:
        _,p=access(c,request,port)
    return weather(p)

@app.get('/api/ports/{port}/snapshot')
def snapshot(port:str,request:Request):
    with connect() as c:
        u,p=access(c,request,port)
        # Snapshot is operational read data. Sensitive user, permission and audit data have separate guarded endpoints.
        kinds=['berths','equipment','calls','alerts','delays','drafts','versions','notifications','scenarios','zones','source_plans','source_issues']
        member=c.execute('SELECT permissions FROM memberships WHERE user_id=? AND port_id=?',(u['id'],port)).fetchone()
        permissions=PERMISSIONS if u['superadmin'] else json.loads(member['permissions'])
        restricted={'drafts':'approvals.view','versions':'planning.view','scenarios':'scenarios.view'}
        return dict(port=p,stats=stats(c,port),**{k:([x for x in records(c,port,k) if k!='notifications' or u['id'] not in x.get('hidden_by',[])] if k not in restricted or restricted[k] in permissions else []) for k in kinds},ais=positions(p,records(c,port,'calls')))

KINDS={'berths':('config.view','config.edit'),'equipment':('equipment.view','config.edit'),'zones':('config.view','config.edit'),'calls':('calls.view','calls.create'),'delays':('delays.view','delays.create'),'alerts':('alerts.view','alerts.edit')}

def list_records(port:str,kind:str,request:Request):
    permission=KINDS.get(kind,({'drafts':'approvals.view','versions':'planning.view','notifications':'dashboard.view','scenarios':'scenarios.view','audit':'config.view','users':'users.view'}.get(kind,'dashboard.view'),''))[0]
    if kind not in KINDS and kind not in ['drafts','versions','notifications','scenarios','audit','users']: raise HTTPException(404)
    if kind=='audit': permission='config.view'
    if kind=='users': permission='users.view'
    with connect() as c:
        u,p=access(c,request,port,permission)
        if kind=='audit': return [dict(r,detail=json.loads(r['detail'])) for r in c.execute('SELECT a.*,u.name AS author FROM audit a JOIN users u ON a.user_id=u.id WHERE port_id=? ORDER BY a.id DESC LIMIT 500',(port,))]
        if kind=='users':
            return [safe_user(c,r) for r in c.execute('SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.port_id=?',(port,))]
        return records(c,port,kind)

def check_record(kind,d,p,c,port):
    if kind=='calls':
        normalize_timing(d)
        legacy=record(c,port,'calls',d.get('id','')) if d.get('id') else None
        match_cargo(d,p,legacy)
        required=['name','product','quantity','start','end','eta','loa','draft','status']
        if any(k not in d for k in required): raise HTTPException(422,'Missing required vessel information')
        if not str(d['name']).strip(): raise HTTPException(422,'Vessel name is required')
        if any(not isinstance(d[k],(float,int)) or not math.isfinite(d[k]) or d[k]<=0 for k in ['quantity','loa','draft']): raise HTTPException(422,'Quantity, length and draft must be positive finite numbers')
        if d['status'] not in ['Scheduled','Waiting','Berthed','Loading','Unloading','Delayed','Completed','Cancelled']: raise HTTPException(422,'Invalid vessel status')
        if not 0<=float(d.get('progress',0))<=100: raise HTTPException(422,'Progress must be from 0 to 100')
        if dt(d['end'])<=dt(d['start']): raise HTTPException(422,'Completion must be after start')
        dt(d['eta'])
        if d['product'] not in [x['name'] for x in p.get('products',[])]: raise HTTPException(422,'Product must exist in port configuration')
        if not d.get('berth_id'): raise HTTPException(422,'Assign a configured berth before saving the vessel call')
        if not record(c,port,'berths',d['berth_id']): raise HTTPException(422,'Unknown berth')
        if d.get('equipment_id') and not record(c,port,'equipment',d['equipment_id']): raise HTTPException(422,'Unknown equipment')
    if kind=='berths':
        if d.get('status') not in ['Available','Closed','Maintenance']: raise HTTPException(422,'Choose Available, Closed or Maintenance for berth status')
        if not d.get('name') or not d.get('code'): raise HTTPException(422,'Berth name and code required')
        check_geometry(d.get('geometry'),['LineString','Polygon'])
        if d.get('geometry') is None and d.get('map_visible',True): raise HTTPException(422,'Draw berth geometry first')
        for k in ['length','max_loa','max_draft']:
            if not isinstance(d.get(k),(float,int)) or not math.isfinite(d[k]) or d[k]<=0: raise HTTPException(422,'Berth dimensions must be positive')
        if not isinstance(d.get('cargo'),list) or any(x not in [p['name'] for p in p.get('products',[])] for x in d['cargo']): raise HTTPException(422,'Select configured cargo products')
        if d['max_loa']>d['length']: raise HTTPException(422,'Maximum vessel length cannot exceed berth length')
        buffer=d.get('buffer_hours',1)
        if not isinstance(buffer,(int,float)) or not math.isfinite(buffer) or not 0<=buffer<=168: raise HTTPException(422,'Safety gap must be between 0 and 168 hours')
    if kind in ['equipment','zones']:
        if not d.get('name'): raise HTTPException(422,'Name required')
        check_geometry(d.get('geometry'))
    if kind=='equipment':
        if float(d.get('capacity',0))<=0: raise HTTPException(422,'Equipment capacity must be positive')
        if any(not record(c,port,'berths',id) for id in d.get('berths',[])): raise HTTPException(422,'Unknown linked berth')
    if kind=='delays':
        if not isinstance(d.get('hours'),(float,int)) or not math.isfinite(d['hours']) or d['hours']<=0: raise HTTPException(422,'Duration must be positive')
        if not record(c,port,'calls',d.get('call_id','')): raise HTTPException(422,'Select a vessel call')
        if d.get('equipment_id') and not record(c,port,'equipment',d['equipment_id']): raise HTTPException(422,'Unknown equipment')
        if not d.get('description'): raise HTTPException(422,'Delay description required')

def _save(c,port,kind,d,u,p,id=None):
    old=record(c,port,kind,id) if id else None
    if id and not old: raise HTTPException(404,'Record not found')
    check_record(kind,d,p,c,port)
    result=put(c,port,kind,d,id,d.get('revision'))
    audit(c,port,u['id'],kind+'.'+('updated' if old else 'created'),result['id'],{'before':old,'after':result})
    if kind=='calls' and not old: notification(c,port,'New vessel nomination',d['name'],result['id'])
    if kind=='delays':
        title=f'{d["cause"]} delay reported'
        put(c,port,'alerts',dict(title=title,description=d['description'],severity='High' if d['hours']>=4 else 'Medium',call_id=d['call_id'],department=d.get('department','Operations'),status='Open',created_at=now(),comments=[]))
        if d.get('equipment_id'):
            e=record(c,port,'equipment',d['equipment_id']); e['status']='Outage'; put(c,port,'equipment',e,e['id'],e['revision'])
        call=record(c,port,'calls',d['call_id']); call['status']='Delayed'; put(c,port,'calls',call,call['id'],call['revision'])
        notification(c,port,title,d['description'],d['call_id'])
    return result

@app.post('/api/ports/{port}/{kind}')
async def create_record(port:str,kind:str,request:Request):
    if kind not in KINDS: raise HTTPException(404)
    d=await request.json();d.pop('id',None);d.pop('revision',None)
    with connect() as c:
        u,p=access(c,request,port,KINDS[kind][1])
        if kind=='calls':
            normalize_timing(d)
            d['status']='Scheduled'; d['progress']=0; d['planned_start']=d['start']; d['planned_end']=d['end']
        d['created_at']=now()
        return _save(c,port,kind,d,u,p)

@app.put('/api/ports/{port}/{kind}/{id}')
async def update_record(port:str,kind:str,id:str,request:Request):
    if kind not in ['berths','equipment','zones','alerts']: raise HTTPException(405,'Use workflow-specific endpoints for vessel changes')
    d=await request.json()
    with connect() as c:
        perm='equipment.update' if kind=='equipment' and set(d.keys())<= {'id','revision','status'} else KINDS[kind][1]
        u,p=access(c,request,port,perm)
        old=record(c,port,kind,id)
        if not old: raise HTTPException(404)
        if d.get('revision')!=old['revision']: raise ValueError('Record changed. Reload before saving.')
        return _save(c,port,kind,dict(old,**d),u,p,id)

@app.delete('/api/ports/{port}/{kind}/{id}')
def delete_record(port:str,kind:str,id:str,request:Request,revision:int):
    if kind not in ['berths','equipment','zones','calls','alerts','delays','imports','scenarios']: raise HTTPException(405)
    with connect() as c:
        u,p=access(c,request,port,'config.edit'); old=record(c,port,kind,id)
        if not old: raise HTTPException(404)
        if old['revision']!=revision: raise ValueError('Record changed. Reload before deleting.')
        if kind=='imports' and (old.get('status') in ['Applied','Drafted','Partially applied','Rolled back','Configuration initialized'] or old.get('applied') or old.get('draft_ids') or old.get('applied_at') or any(x.get('status')=='Applied' for x in old.get('setup_candidates',[]))): raise HTTPException(409,'Processed imports are retained as operational history')
        if kind in ['berths','equipment']:
            if any(x['kind']==kind and x['asset_id']==id for x in p.get('rules',{}).get('asset_constraints',[])): raise HTTPException(409,'Remove constraints for this asset before deleting it')
            key='berth_id' if kind=='berths' else 'equipment_id'
            if any(x.get(key)==id for x in records(c,port,'calls')): raise HTTPException(409,'This asset is linked to a vessel call. Reassign the call before removing it.')
            if kind=='berths' and (any(id in x.get('berths',[]) for x in records(c,port,'equipment')) or any(id in x.get('berth_ids',[]) for x in p.get('rules',{}).get('custom_rules',[]))): raise HTTPException(409,'Remove equipment and cargo rule links to this berth first')
        if kind in ['berths','equipment','calls','delays','alerts','scenarios','imports']:
            linked=[x for k in ['drafts','versions','scenarios','imports','source_plans'] for x in records(c,port,k)]
            def references(value):
                if isinstance(value,dict): return any(references(v) for v in value.values())
                if isinstance(value,list): return any(references(v) for v in value)
                return value==id
            if any(x['id']!=id and references(x) for x in linked): raise HTTPException(409,'This entry is referenced by a workflow, plan version, scenario or import. Retain it for operational history.')
        if kind=='equipment' and any(x.get('equipment_id')==id for x in records(c,port,'delays')): raise HTTPException(409,'This equipment is linked to a recorded delay')
        if kind=='calls' and any(x.get('call_id')==id for k in ['delays','alerts'] for x in records(c,port,k)): raise HTTPException(409,'Remove linked alerts and delays before removing this vessel call')
        c.execute('DELETE FROM records WHERE id=? AND port_id=? AND kind=?',(id,port,kind)); audit(c,port,u['id'],kind+'.deleted',id,old)
        return {'ok':True}

@app.post('/api/ports/{port}/calls/{id}/readiness')
async def readiness(port:str,id:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'readiness.update'); call=record(c,port,'calls',id)
        if not call: raise HTTPException(404)
        call['ready']=bool(d.get('ready')); call['revision']=d.get('revision'); call['ready_at']=d.get('ready_at',call.get('ready_at'))
        if call['ready_at']: dt(call['ready_at'])
        result=put(c,port,'calls',call,id,call['revision']); audit(c,port,u['id'],'readiness.updated',id,d)
        notification(c,port,'Cargo readiness updated',call['name'],id)
        if not call['ready']: put(c,port,'alerts',dict(title='Cargo not ready',description=f'{call["name"]}: production readiness withdrawn.',severity='High',call_id=id,status='Open',department='Production',created_at=now(),comments=[]))
        return result

@app.post('/api/ports/{port}/calls/{id}/actuals')
async def actuals(port:str,id:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'operations.update'); call=record(c,port,'calls',id)
        if not call: raise HTTPException(404)
        before=dict(call)
        for key in ['status','progress','actual_arrival','actual_start','actual_end','actual_departure']:
            if key in d: call[key]=d[key]
        check_record('calls',call,p,c,port)
        for k in ['actual_arrival','actual_start','actual_end','actual_departure']:
            if call.get(k): dt(call[k])
        result=put(c,port,'calls',call,id,d.get('revision')); audit(c,port,u['id'],'actuals.updated',id,{'before':before,'after':result})
        return result

@app.post('/api/ports/{port}/planning/validate')
async def validate_plan(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'planning.view'); calls=records(c,port,'calls')
        call=record(c,port,'calls',d.get('id','')) or {}
        call.update(d)
        return validate(call,calls,records(c,port,'berths'),records(c,port,'equipment'),p.get('rules',{}))

@app.post('/api/ports/{port}/planning/drafts')
async def draft_plan(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'planning.draft'); call=record(c,port,'calls',d.get('call_id',''))
        if not call: raise HTTPException(404,'Vessel not found')
        if d.get('base_revision')!=call['revision']: raise ValueError('The vessel record changed. Reload before proposing a change.')
        proposed=dict(call,**{k:v for k,v in d.get('changes',{}).items() if k in ['berth_id','equipment_id','start','end','eta','quantity','priority','product','grade','subgrade','direction','catalog_item_id','duration_hours','rate']})
        changes=d.get('changes',{})
        if 'start' in changes or 'end' in changes: proposed.pop('duration_hours',None)
        if 'duration_hours' in changes and 'end' not in changes: proposed.pop('end',None)
        check_record('calls',proposed,p,c,port)
        if len(str(d.get('reason','')).strip())<5: raise HTTPException(422,'Provide a modification reason of at least five characters')
        checks=validate(proposed,records(c,port,'calls'),records(c,port,'berths'),records(c,port,'equipment'),p.get('rules',{}))
        draft=dict(call_id=call['id'],before=call,proposed=proposed,reason=d['reason'],author_id=u['id'],author=u['name'],status='Draft',created_at=now(),validation=checks,decisions=[],workflow=capture_workflow(c,port,p.get('workflow',{}),u['id']))
        result=put(c,port,'drafts',draft); audit(c,port,u['id'],'draft.created',result['id'],draft)
        return result

@app.delete('/api/ports/{port}/planning/drafts/{id}')
def delete_draft(port:str,id:str,request:Request,revision:int):
    with connect() as c:
        u,p=access(c,request,port,'planning.view')
        draft=record(c,port,'drafts',id)
        if not draft: raise HTTPException(404,'Workflow not found')
        if draft.get('author_id')!=u['id'] and not u['superadmin']: raise HTTPException(403,'Only the initiator or an administrator can delete this workflow')
        removed=c.execute("DELETE FROM records WHERE id=? AND port_id=? AND kind='drafts' AND revision=?",(id,port,revision))
        if removed.rowcount!=1: raise ValueError('Workflow changed. Reload before deleting.')
        audit(c,port,u['id'],'draft.deleted',id,draft)
        return {'ok':True}

@app.post('/api/ports/{port}/planning/drafts/{id}/{action}')
async def draft_action(port:str,id:str,action:str,request:Request):
    d=await request.json()
    permission={'submit':'planning.submit','approve':'approvals.approve','reject':'approvals.approve','clarify':'approvals.approve','publish':'planning.publish','terminate':'planning.view'}.get(action)
    if not permission: raise HTTPException(404)
    with connect() as c:
        u,p=access(c,request,port,permission); draft=record(c,port,'drafts',id)
        if not draft: raise HTTPException(404)
        if d.get('revision')!=draft['revision']: raise ValueError('Draft changed. Reload before continuing.')
        if action=='terminate':
            if draft.get('author_id')!=u['id'] and not u['superadmin']: raise HTTPException(403,'Only the initiator or an administrator can terminate this workflow')
            if draft['status'] not in ['Draft','Submitted','Clarification requested','Approved']: raise HTTPException(409,'This workflow is already finished')
            draft['status']='Cancelled'
            draft.setdefault('decisions',[]).append(dict(action='terminate',author=u['name'],user_id=u['id'],comment=d.get('comment',''),created_at=now()))
            result=put(c,port,'drafts',draft,id,draft['revision'])
            audit(c,port,u['id'],'draft.terminated',id,result)
            notification(c,port,'Workflow terminated',draft.get('reason',''),id)
            return result
        call=record(c,port,'calls',draft['call_id'])
        if not call and draft.get('operation')!='create':raise HTTPException(404,'Vessel call no longer exists')
        checks=validate(draft['proposed'],records(c,port,'calls'),records(c,port,'berths'),records(c,port,'equipment'),p.get('rules',{}))
        draft['validation']=checks
        if draft.get('import_delay'):
            draft['validation']['warnings'].append('Document declares an operational delay; a reviewer must confirm it')
        auto_publish=False
        if action in ['submit','approve','publish'] and checks['errors']: raise HTTPException(409,{'message':'Hard constraints block this change','errors':checks['errors']})
        if action=='submit':
            if draft['status'] not in ['Draft','Clarification requested']: raise HTTPException(409,'Only a draft may be submitted')
            draft['status']='Submitted'
            # Both the captured route and current policy must permit automation.
            captured=approval_eligibility(draft['before'],draft['proposed'],checks,draft.get('workflow',{}))
            current=approval_eligibility(draft['before'],draft['proposed'],checks,p.get('workflow',{}))
            draft['automation']=dict(captured,current_policy=current)
            if captured['auto_approve'] and current['auto_approve'] and draft.get('operation')!='create':
                draft['status']='Approved'
                draft['decisions'].append(dict(action='auto_approve',author='Configured approval policy',user_id=u['id'],department='Automation',comment='Validated change within configured limits',created_at=now()))
                if captured['auto_publish'] and current['auto_publish']:
                    # Automatic publication uses the submitting user's existing authority.
                    m=c.execute('SELECT permissions FROM memberships WHERE user_id=? AND port_id=?',(u['id'],port)).fetchone()
                    auto_publish=bool(u['superadmin'] or (m and 'planning.publish' in json.loads(m['permissions'])))
                    if not auto_publish:draft['automation']['reasons'].append('A permitted publisher must publish this approved change')
        elif action in ['approve','reject','clarify']:
            if draft['status']!='Submitted': raise HTTPException(409,'Request is not awaiting a decision')
            workflow=draft.get('workflow',{}); required=workflow.get('departments',['Operations'])
            m=c.execute('SELECT department FROM memberships WHERE user_id=? AND port_id=?',(u['id'],port)).fetchone(); department=m['department'] if m else 'Administration'
            if workflow.get('segregation',True) and u['id']==draft['author_id']: raise HTTPException(403,'The author cannot approve their own change')
            if workflow.get('steps'):
                step=decision_step(workflow,draft['decisions'],u['id'],d.get('step_id'))
                draft['decisions'].append(dict(action=action,author=u['name'],user_id=u['id'],department=department,step_id=step['id'],step_name=step['name'],comment=d.get('comment',''),created_at=now()))
                if action=='reject':draft['status']='Rejected'
                elif action=='clarify':draft['status']='Clarification requested';draft['decisions']=[]
                elif all(completed(item,draft['decisions']) for item in workflow['steps']):draft['status']='Approved'
            else:
                approved=[x['department'] for x in draft['decisions'] if x['action']=='approve']
                if department not in required: raise HTTPException(403,'Your department is not assigned to this approval route')
                if department in approved: raise HTTPException(409,'Your department has already approved')
                if workflow.get('mode')=='sequential' and department!=next((x for x in required if x not in approved),None): raise HTTPException(403,'Another department must review first')
                draft['decisions'].append(dict(action=action,author=u['name'],user_id=u['id'],department=department,comment=d.get('comment',''),created_at=now()))
                if action=='reject': draft['status']='Rejected'
                elif action=='clarify': draft['status']='Clarification requested'; draft['decisions']=[]
                elif all(dep in approved+[department] for dep in required): draft['status']='Approved'
        if action=='publish' or auto_publish:
            if draft['status']!='Approved': raise HTTPException(409,'Required approvals must be completed before publication')
            if draft.get('operation')=='create':
                access(c,request,port,'calls.create')
                if call:raise ValueError('Vessel nomination already exists. Reload the published plan.')
            elif call['revision']!=draft['before']['revision']: raise ValueError('Published vessel record changed. Create a fresh proposal.')
            if draft.get('import_delay'):access(c,request,port,'delays.create')
            for permission in draft.get('import_permissions',[]):access(c,request,port,permission)
            updated=dict(draft['proposed'],planned_start=draft['proposed']['start'],planned_end=draft['proposed']['end'])
            if draft.get('import_id'):
                from .document_imports import apply_row, mark_import_draft_published
                item={'id':draft['import_item_id'],'match_id':call['id'] if call else None,'proposed':updated,'delay':draft.get('import_delay'),'evidence':draft.get('import_evidence',[])}
                ledger=apply_row(c,port,p,u,item,draft['import_id'],_save)
                mark_import_draft_published(c,port,draft,ledger)
            else:put(c,port,'calls',updated,call['id'],call['revision'])
            draft['status']='Published'
            for version in records(c,port,'versions'):
                if version['status']=='Published': version['status']='Superseded'; put(c,port,'versions',version,version['id'],version['revision'])
            put(c,port,'versions',dict(label=f'Plan revision {len(records(c,port,"versions"))+1}',status='Published',author=u['name'],created_at=now(),draft_id=id,calls=records(c,port,'calls'),berths=records(c,port,'berths')))
        result=put(c,port,'drafts',draft,id,draft['revision']); audit(c,port,u['id'],'draft.'+action,id,result)
        notification(c,port,f'Plan change {result["status"].lower()}',f'{draft["proposed"]["name"]}: {draft["reason"]}',id)
        return result

@app.post('/api/ports/{port}/scenarios/run')
async def run_scenario(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'scenarios.create')
        result=optimize(records(c,port,'calls'),records(c,port,'berths'),records(c,port,'equipment'),d,p.get('rules',{}))
        result.update(name=d.get('name','Scenario analysis'),parameters=d,created_at=now(),author=u['name'])
        saved=put(c,port,'scenarios',result); audit(c,port,u['id'],'scenario.run',saved['id'],d)
        return saved

@app.delete('/api/ports/{port}/notifications/{id}/inbox')
def dismiss_notification(port:str,id:str,request:Request):
    with connect() as c:
        u,p=access(c,request,port)
        item=record(c,port,'notifications',id)
        if not item: raise HTTPException(404,'Notification not found')
        hidden=item.setdefault('hidden_by',[])
        if u['id'] not in hidden:
            hidden.append(u['id'])
            put(c,port,'notifications',item,id,item['revision'])
        return {'ok':True}

@app.post('/api/ports/{port}/notifications/{id}/read')
def read_notification(port:str,id:str,request:Request):
    with connect() as c:
        u,p=access(c,request,port)
        item=record(c,port,'notifications',id)
        if not item: raise HTTPException(404,'Notification not found')
        if u['id'] not in item['read_by']:
            item['read_by'].append(u['id'])
            item=put(c,port,'notifications',item,id,item['revision'])
        return item

@app.post('/api/ports/{port}/notifications/read')
async def read_notifications(port:str,request:Request):
    with connect() as c:
        u,p=access(c,request,port)
        for n in records(c,port,'notifications'):
            if u['id'] not in n['read_by']: n['read_by'].append(u['id']); put(c,port,'notifications',n,n['id'],n['revision'])
        return {'ok':True}

@app.post('/api/ports/{port}/integration/test')
def test_integration(port:str,request:Request):
    with connect() as c:
        u,p=access(c,request,port,'config.edit'); result=positions(p,records(c,port,'calls'),True)
        audit(c,port,u['id'],'integration.test',port,{'mode':result['mode']})
        return result

@app.post('/api/ports/{port}/users/save')
async def save_user(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'users.edit'); id=d.get('id') or uid(); existing=c.execute('SELECT * FROM users WHERE id=?',(id,)).fetchone()
        if existing and existing['org_id']!=p['org_id']: raise HTTPException(403,'User belongs to another organization')
        if d.get('department') not in p['departments']+['Administration']: raise HTTPException(422,'Unknown department')
        perms=d.get('permissions',ROLES.get(d.get('role','Viewer'),[]))
        if not isinstance(perms,list) or any(x not in PERMISSIONS for x in perms): raise HTTPException(422,'Unknown permission')
        actor_membership=c.execute('SELECT permissions FROM memberships WHERE user_id=? AND port_id=?',(u['id'],port)).fetchone()
        if not u['superadmin'] and any(x not in json.loads(actor_membership['permissions']) for x in perms): raise HTTPException(403,'Cannot grant permissions you do not hold')
        if not existing:
            if len(d.get('password',''))<10: raise HTTPException(422,'Password must have at least ten characters')
            if not d.get('name') or '@' not in d.get('email',''): raise HTTPException(422,'Name and valid email required')
            try: c.execute('INSERT INTO users(id,org_id,email,name,password) VALUES(?,?,?,?,?)',(id,p['org_id'],d['email'].lower(),d['name'],password_hash(d['password'])))
            except sqlite3.IntegrityError: raise HTTPException(409,'This email is already registered')
        # Port administrators manage membership, not account-wide or superadmin status.
        c.execute('INSERT INTO memberships VALUES(?,?,?,?,?) ON CONFLICT(user_id,port_id) DO UPDATE SET department=excluded.department,role=excluded.role,permissions=excluded.permissions',(id,port,d.get('department','Operations'),d.get('role','Custom Role'),json.dumps(perms)))
        audit(c,port,u['id'],'user.membership.updated',id,{k:v for k,v in d.items() if k!='password'})
        return {'id':id,'ok':True}

@app.delete('/api/ports/{port}/users/{id}/membership')
def remove_membership(port:str,id:str,request:Request):
    with connect() as c:
        u,p=access(c,request,port,'users.edit')
        target=c.execute('SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.port_id=? AND u.id=?',(port,id)).fetchone()
        if not target: raise HTTPException(404,'Port member not found')
        if id==u['id']: raise HTTPException(409,'You cannot remove your own port access')
        if target['superadmin'] and not u['superadmin']: raise HTTPException(403,'Only a super administrator can remove this membership')
        members=c.execute('SELECT u.active,m.permissions FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.port_id=? AND m.user_id!=?',(port,id)).fetchall()
        if not any(m['active'] and 'users.edit' in json.loads(m['permissions']) for m in members): raise HTTPException(409,'Keep at least one active user administrator at this port')
        membership=c.execute('SELECT department,permissions FROM memberships WHERE user_id=? AND port_id=?',(id,port)).fetchone()
        workflow=p.get('workflow',{})
        if any(id in step.get('user_ids',[]) for route in [workflow]+p.get('workflow_templates',[]) for step in route.get('steps',[])): raise HTTPException(409,'Reassign this person in the approval route before removing access')
        if 'approvals.approve' in json.loads(membership['permissions']) and any(membership['department'] in route.get('departments',[]) or any(step.get('department')==membership['department'] for step in route.get('steps',[])) for route in [workflow]+p.get('workflow_templates',[])):
            if not any(x['id']!=id and x['department']==membership['department'] for x in reviewers(c,port)): raise HTTPException(409,'Keep an eligible reviewer in this approval department')
        if any(d.get('status') in ['Submitted','Clarification requested','Approved'] and any(id in step.get('user_ids',[]) for step in d.get('workflow',{}).get('steps',[])) for d in records(c,port,'drafts')): raise HTTPException(409,'This person is a captured reviewer on an active workflow. Complete or terminate the workflow first.')
        c.execute('DELETE FROM memberships WHERE user_id=? AND port_id=?',(id,port))
        audit(c,port,u['id'],'user.membership.removed',id,{'name':target['name']})
        return {'ok':True}

@app.delete('/api/ports/{port}')
def remove_port(port:str,request:Request,revision:int):
    with connect() as c:
        u,p=access(c,request,port,'config.edit')
        if not u['superadmin']: raise HTTPException(403,'Super administrator required to remove a port')
        if revision!=p['revision']: raise HTTPException(409,'Port changed. Reload before removing it.')
        if c.execute('SELECT 1 FROM records WHERE port_id=? LIMIT 1',(port,)).fetchone(): raise HTTPException(409,'Remove this port’s entries before removing the port. Operational history must be retained.')
        if c.execute('SELECT count(*) FROM ports').fetchone()[0]<=1: raise HTTPException(409,'Keep at least one port')
        c.execute('DELETE FROM memberships WHERE port_id=?',(port,))
        c.execute('DELETE FROM ports WHERE id=?',(port,))
        audit(c,port,u['id'],'port.deleted',port,p)
        return {'ok':True}

@app.get('/api/meta/permissions')
def metadata(request:Request):
    with connect() as c: user(c,request)
    return {'permissions':PERMISSIONS,'roles':ROLES}

@app.get('/api/ports/{port}/reports/export')
def export_report(port:str,request:Request,format:str='csv',report:str='Vessel calls',start:str='',end:str='',berth:str='',product:str=''):
    with connect() as c:
        u,p=access(c,request,port,'reports.export'); calls=records(c,port,'calls')
        if start: calls=[x for x in calls if dt(x['start'])>=dt(start)]
        if end: calls=[x for x in calls if dt(x['start'])<=dt(end)]
        if berth: calls=[x for x in calls if x.get('berth_id')==berth]
        if product: calls=[x for x in calls if x.get('product')==product]
        if report=='Operational delays':
            allowed={x['id'] for x in calls}; rows=[x for x in records(c,port,'delays') if x['call_id'] in allowed]; keys=['cause','hours','call_id','department','description','status','created_at']
        elif report=='Schedule modification history': rows=records(c,port,'drafts'); keys=['created_at','author','call_id','status','reason']
        elif report=='Approval history':
            rows=[dict(draft_id=x['id'],**dec) for x in records(c,port,'drafts') for dec in x['decisions']]; keys=['draft_id','created_at','author','department','action','comment']
        elif report=='Cargo throughput':
            rows=stats(c,port)['products']; keys=['name','direction','quantity','previous','change']
        elif report=='Berth utilization':
            rows=[{'berth':b['code'],'calls':sum(x.get('berth_id')==b['id'] for x in calls),'occupied_hours':round(sum(max(0,(dt(x['end'])-dt(x['start'])).total_seconds()/3600) for x in calls if x.get('berth_id')==b['id']),1)} for b in records(c,port,'berths')]; keys=['berth','calls','occupied_hours']
        else: rows=calls; keys=['name','imo','product','grade','quantity','direction','berth_id','start','end','status','progress','ready']
        audit(c,port,u['id'],'report.exported',report,{'format':format,'rows':len(rows)})
    if format=='csv':
        out=io.StringIO(); writer=csv.writer(out); writer.writerow(keys)
        for row in rows: writer.writerow([("'"+str(row.get(k,''))) if str(row.get(k,'')).startswith(('=','+','-','@')) else row.get(k,'') for k in keys])
        content=out.getvalue().encode('utf-8-sig'); mime='text/csv'
    elif format=='xlsx':
        from openpyxl import Workbook
        wb=Workbook(); ws=wb.active; ws.title='Port operations'; ws.append(keys)
        for row in rows: ws.append([str(row.get(k,'')) if isinstance(row.get(k), (list,dict)) else row.get(k) for k in keys])
        for row in ws:
            for cell in row:
                if cell.data_type=='f': cell.data_type='s'
        ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions
        for col in ws.columns: ws.column_dimensions[col[0].column_letter].width=23
        out=io.BytesIO(); wb.save(out); content=out.getvalue(); mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    elif format=='pdf':
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.pagesizes import A3, landscape
        from reportlab.lib import colors
        from xml.sax.saxutils import escape
        out=io.BytesIO(); styles=getSampleStyleSheet(); data=[[Paragraph(escape(k),styles['BodyText']) for k in keys]]+[[Paragraph(escape(str(row.get(k,''))),styles['BodyText']) for k in keys] for row in rows]
        table=Table(data,repeatRows=1,colWidths=[(landscape(A3)[0]-72)/len(keys)]*len(keys)); table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e7eff4')),('GRID',(0,0),(-1,-1),.25,colors.HexColor('#cfdae2')),('VALIGN',(0,0),(-1,-1),'TOP')]))
        SimpleDocTemplate(out,pagesize=landscape(A3),leftMargin=36,rightMargin=36).build([Paragraph(escape(p['name']),styles['Title']),Paragraph(escape(report+' | '+now()),styles['BodyText']),Spacer(1,16),table]); content=out.getvalue(); mime='application/pdf'
    else: raise HTTPException(422,'Format must be csv, xlsx, or pdf')
    return Response(content,media_type=mime,headers={'Content-Disposition':f'attachment; filename="portside-report.{format}"'})

@app.get('/api/health')
def health(): return {'status':'ok','database':'SQLite','version':'1.0.0'}

app.mount('/vendor',StaticFiles(directory=ROOT/'frontend/vendor'),name='vendor')
app.mount('/assets',StaticFiles(directory=ROOT/'frontend'),name='assets')
@app.get('/')
def index(): return FileResponse(ROOT/'frontend/index.html')

@app.post('/api/ports/{port}/configuration/geography')
async def save_geography(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'config.edit')
        if d.get('port_revision')!=p['revision']:raise ValueError('Port configuration changed. Reload before saving.')
        changes=d.get('changes',[]);prepared=[];seen=set()
        for change in changes:
            kind=change.get('kind');id=change.get('id')
            if kind not in ['berths','equipment','zones'] or (kind,id) in seen:raise HTTPException(422,'Invalid or duplicate geographic change')
            seen.add((kind,id));old=record(c,port,kind,id)
            if not old:raise HTTPException(404,'Geographic object no longer exists')
            if change.get('revision')!=old['revision']:raise ValueError('A geographic object changed. Reload before saving.')
            if change.get('action')=='remove':
                # Remove the geographic representation without destroying allocations or history.
                new=dict(old,geometry=None,map_visible=False)
            elif change.get('action')=='update':
                check_geometry(change.get('geometry'));new=dict(old,geometry=change['geometry'],map_visible=True)
                check_record(kind,new,p,c,port)
            else:raise HTTPException(422,'Unsupported geographic action')
            prepared.append((kind,old,new))
        if 'boundary' in d:check_geometry(d['boundary'],['Polygon']);p['boundary']=d['boundary']
        for kind,old,new in prepared:put(c,port,kind,new,old['id'],old['revision'])
        saved={k:v for k,v in p.items() if k not in ['id','org_id','revision']}
        result=c.execute('UPDATE ports SET data=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(saved),port,p['revision']))
        if result.rowcount!=1:raise ValueError('Port configuration changed. Reload before saving.')
        put(c,port,'config_versions',dict(created_at=now(),author=u['name'],port=saved,berths=records(c,port,'berths'),equipment=records(c,port,'equipment')))
        audit(c,port,u['id'],'geography.saved',port,{'changes':changes,'boundary_changed':'boundary' in d})
        return {'ok':True,'revision':p['revision']+1,'removed_from_map':sum(x.get('action')=='remove' for x in changes)}

@app.post('/api/ports/{port}/configuration/departments')
async def department_change(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'config.edit');names=list(p['departments']);name=str(d.get('name','')).strip();new=str(d.get('new_name','')).strip();action=d.get('action')
        if not name or len(name)>80:raise HTTPException(422,'Enter a department name of 1–80 characters')
        if action=='add':
            if name.casefold() in [x.casefold() for x in names]:raise HTTPException(409,'Department already exists')
            names.append(name)
        elif action in ['rename','remove']:
            if name not in names:raise HTTPException(404,'Department not found')
            if action=='remove':
                if any(name in route.get('departments',[]) or any(step.get('department')==name for step in route.get('steps',[])) for route in [p['workflow']]+p.get('workflow_templates',[])) or c.execute('SELECT 1 FROM memberships WHERE port_id=? AND department=?',(port,name)).fetchone():raise HTTPException(409,'Reassign members and approval routes before removing this department')
                names.remove(name)
            else:
                if not new or len(new)>80 or any(x!=name and x.casefold()==new.casefold() for x in names):raise HTTPException(422,'Choose a unique department name')
                names=[new if x==name else x for x in names];p['workflow']['departments']=[new if x==name else x for x in p['workflow']['departments']]
                for step in p['workflow'].get('steps',[]):
                    if step.get('department')==name:step['department']=new
                for template in p.get('workflow_templates',[]):
                    template['departments']=[new if x==name else x for x in template.get('departments',[])]
                    for step in template.get('steps',[]):
                        if step.get('department')==name: step['department']=new
                c.execute('UPDATE memberships SET department=? WHERE port_id=? AND department=?',(new,port,name))
                for kind in ['alerts','delays','drafts']:
                    for item in records(c,port,kind):
                        changed=False
                        if item.get('department')==name:item['department']=new;changed=True
                        if kind=='drafts' and item['status'] not in ['Published','Rejected']:
                            route=item.get('workflow',{});route['departments']=[new if x==name else x for x in route.get('departments',[])];item['workflow']=route
                            for step in route.get('steps',[]):
                                if step.get('department')==name:step['department']=new
                            for dec in item.get('decisions',[]):
                                if dec.get('department')==name:dec['department']=new
                            changed=True
                        if changed:put(c,port,kind,item,item['id'],item['revision'])
        else:raise HTTPException(422,'Unknown department action')
        p['departments']=names;data={k:v for k,v in p.items() if k not in ['id','org_id','revision']}
        updated=c.execute('UPDATE ports SET data=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(data),port,p['revision']))
        if updated.rowcount!=1:raise ValueError('Port configuration changed. Reload before saving.')
        audit(c,port,u['id'],'department.'+action,name,d);return {'ok':True,'departments':names}

@app.post('/api/ports/{port}/configuration/rules')
async def save_planning_rules(port:str,request:Request):
    d=await request.json()
    with connect() as c:
        u,p=access(c,request,port,'config.edit')
        if d.get('port_revision')!=p['revision']:raise ValueError('Port configuration changed. Reload before saving.')
        p['rules']=normalize_rules({**p.get('rules',{}),**d.get('rules',{})},[b['id'] for b in records(c,port,'berths')],[e['id'] for e in records(c,port,'equipment')]);check_port(p);seen=set()
        for entry in d.get('berths',[]):
            b=record(c,port,'berths',entry.get('id',''))
            if not b:raise HTTPException(404,'Berth not found')
            if b['id'] in seen:raise HTTPException(422,'Duplicate berth settings')
            seen.add(b['id'])
            if entry.get('revision')!=b['revision']:raise ValueError('Berth configuration changed. Reload before saving.')
            for key in ['max_loa','max_draft','buffer_hours','status']:
                if key in entry:b[key]=entry[key]
            check_record('berths',b,p,c,port);put(c,port,'berths',b,b['id'],b['revision'])
        data={k:v for k,v in p.items() if k not in ['id','org_id','revision']};updated=c.execute('UPDATE ports SET data=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(data),port,p['revision']))
        if updated.rowcount!=1:raise ValueError('Port configuration changed. Reload before saving.')
        audit(c,port,u['id'],'planning_rules.updated',port,d);return {'ok':True}

from .reporting import register_reporting
register_reporting(app, access)
from .connectors import register_connectors
register_connectors(app, access)

from .document_imports import register_document_imports
register_document_imports(app, access, check_record, _save)
# Keep this one-segment fallback behind explicitly registered document routes.
app.add_api_route('/api/ports/{port}/{kind}', list_records, methods=['GET'])

@app.get('/api/ports/{port}/configuration/reviewers')
def workflow_reviewers(port:str,request:Request):
    with connect() as c:
        access(c,request,port,'config.view')
        return reviewers(c,port)

from .product_appearance import register_product_appearance
register_product_appearance(app,access)
