"""Document migration: extract, reconcile, review, validate and apply with provenance."""
import asyncio
import base64
import copy
import hashlib
import json
import math
import re
import unicodedata
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from fastapi import HTTPException, Request, Response
from .store import connect, records, record, put, audit, notification, uid, now
from .planning import dt, validate
from .catalog import normalize_timing
from .policies import approval_eligibility
from .approval_workflow import capture_workflow
from . import document_setup
from .document_extract import extract_document
from .planning_ai import ai_status, interpret_document, analyze_operations, explain_operations

MAX_BYTES=8*1024*1024
FIELDS=['call_reference','name','imo','mmsi','direction','product','grade','subgrade','quantity','berth','equipment','eta','start','end','duration_hours','loa','draft','ready','priority','status','progress','delay_hours','delay_cause','delay_description']
NUMBERS={'quantity','duration_hours','loa','draft','priority','progress','delay_hours'}
ALIASES={
 'call_reference':['call reference','reference','escale','numero escale','call id','voyage'],
 'name':['vessel','vessel name','ship','ship name','navire','nom du navire','nom navire'],
 'imo':['imo','imo number'],'mmsi':['mmsi'],
 'direction':['flow','direction','import export','export import','sens','flux','operation'],
 'product':['product','produit','cargo','marchandise'], 'grade':['grade','product grade','qualite'],
 'subgrade':['subgrade','sub grade','product subgrade','sous grade','sous qualite'],
 'quantity':['quantity','quantity t','quantity kt','quantite','tonnage','cargo quantity','tonnage t','quantite t','quantite kt','qty','quantite tonnes'],
 'berth':['berth','berth code','berth id','quai','poste','poste a quai'],
 'equipment':['equipment','equipment id','equipement','shiploader','loader'],
 'eta':['eta','arrival','expected arrival','date arrivee','arrivee'],
 'start':['start','planned start','operation start','debut','debut operation','date debut'],
 'end':['end','planned end','planned completion','completion','fin','date fin','fin operation'],
 'duration_hours':['duration','duration hours','duration h','duree','duree h','duree heures'],
 'loa':['loa','loa m','length','length m','longueur','longueur m'],
 'draft':['draft','draft m','tirant eau','tirant d eau'],
 'ready':['ready','readiness','cargo ready','pret','disponible'],
 'priority':['priority','priorite'],'status':['status','statut','etat'],'progress':['progress','progress %','avancement','avancement %'],
 'delay_hours':['delay hours','delay h','delay duration','retard h','arret h','duree arret'],
 'delay_cause':['delay cause','cause','cause arret','motif retard'],
 'delay_description':['delay description','delay note','description arret','notes retard'],
}

def key(value):
    value=unicodedata.normalize('NFKD',str(value or '')).encode('ascii','ignore').decode().casefold()
    return re.sub(r'[^a-z0-9]+',' ',value).strip()

def vessel_key(value):
    return re.sub(r'^(?:mv|mt|m v|m t) ','',key(value))

def infer_mapping(headers):
    result={}
    for field,aliases in ALIASES.items():
        hits=[h for h in headers if key(h) in {key(field),*[key(x) for x in aliases]}]
        if len(hits)==1:result[field]=hits[0]
    return result

def numeric(value,field,header=''):
    if isinstance(value,bool):raise ValueError('Use a numeric value for '+field)
    if isinstance(value,(int,float)): n=float(value)
    else:
        v=str(value).strip().replace('\u00a0','').replace(' ','')
        v=re.sub(r'(?:tonnes?|tons?|kt|t|h|m|%)$','',v,flags=re.I).strip()
        if ',' in v and '.' not in v:
            # Decimal commas are accepted; three-digit suffixes are ambiguous without a profile.
            if re.fullmatch(r'\d+,\d{3}',v):raise ValueError('Ambiguous decimal/thousands separator for '+field+'; enter an unformatted number')
            v=v.replace(',','.')
        elif ',' in v:raise ValueError('Use unformatted numbers without thousands separators for '+field)
        n=float(v)
    if not math.isfinite(n):raise ValueError('Numeric values must be finite')
    if field=='quantity' and (re.search(r'\bkt\b',str(header),re.I) or re.search(r'\bkt\s*$',str(value),re.I)):n*=1000
    return n

def timestamp(value,zone,date_order='ISO',document_date=''):
    if not isinstance(value,str):raise ValueError('Dates must be text or spreadsheet dates')
    value=value.strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value) or re.fullmatch(r'\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{4})?',value):raise ValueError('Include an explicit operation time; a calendar date alone is not a berth window')
    try:
        result=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:
        if date_order not in ['DMY','MDY']:raise ValueError('Use ISO dates or select the document date order (day/month or month/day)')
        result=None
        formats=['%d/%m/%Y %H:%M','%d/%m/%Y','%d-%m-%Y %H:%M','%d-%m-%Y'] if date_order=='DMY' else ['%m/%d/%Y %H:%M','%m/%d/%Y','%m-%d-%Y %H:%M','%m-%d-%Y']
        for fmt in formats:
            try: result=datetime.strptime(value,fmt);break
            except ValueError:pass
        if result is None and document_date:
            for fmt in (['%d/%m %H:%M','%d/%m'] if date_order=='DMY' else ['%m/%d %H:%M','%m/%d']):
                try:result=datetime.strptime(value+'/'+document_date[:4],fmt+'/%Y');break
                except ValueError:pass
        if result is None:raise ValueError('Date is incomplete or unsupported; enter an explicit date and time')
    if result.tzinfo is None:
        local=result.replace(tzinfo=ZoneInfo(zone),fold=0)
        alternate=result.replace(tzinfo=ZoneInfo(zone),fold=1)
        if local.utcoffset()!=alternate.utcoffset():raise ValueError('Local time is ambiguous at a timezone transition; include its UTC offset')
        result=local
    return result.isoformat()

def local_items(extraction,mapping,table_index=0,header_row=0):
    if extraction.get('tables'):
        tables=extraction['tables']
        if not isinstance(table_index,int) or not 0<=table_index<len(tables):raise ValueError('Select a valid source table')
        table=copy.deepcopy(tables[table_index]);headers=table['headers'];rows=table['rows']
        if header_row:
            if not isinstance(header_row,int) or not 1<=header_row<=len(rows):raise ValueError('Header row is outside the selected table')
            headers=[str(v if v is not None and v!='' else 'Column '+str(i+1)).strip() for i,v in enumerate(rows[header_row-1]['values'])];rows=rows[header_row:]
        if not mapping:mapping=infer_mapping(headers)
        if not isinstance(mapping,dict) or any(k not in FIELDS or not isinstance(v,str) or v not in headers for k,v in mapping.items()):raise ValueError('Map application fields to columns in the selected table')
        if len(set(headers))!=len(headers):raise ValueError('Source headers must be unique; choose another header row or use AI interpretation')
        items=[]
        for row in rows:
            data={};evidence=[]
            for field,header in mapping.items():
                index=headers.index(header);value=row['values'][index] if index<len(row['values']) else None
                if value is not None and str(value).strip():
                    data[field]=value;evidence.append(dict(field=field,ref=row['ref'],quote=str(value),column=header))
            if data:items.append(dict(data=data,evidence=evidence,issues=[],confidence=1))
        if len(items)>500:raise ValueError('Import at most 500 vessel rows at a time; split the document before applying')
        return items,mapping
    # Small text schedules use explicit key:value paragraphs. Unknown prose is left to the model/reviewer.
    items=[];data={};evidence=[]
    for block in extraction.get('blocks',[]):
        for line in block['text'].splitlines():
            if ':' not in line:continue
            label,value=line.split(':',1);field=next((f for f,a in ALIASES.items() if key(label) in {key(f),*[key(x) for x in a]}),None)
            if not field or not value.strip():continue
            if field=='name' and data.get('name'):
                items.append(dict(data=data,evidence=evidence,issues=[],confidence=1));data={};evidence=[]
            data[field]=value.strip();evidence.append(dict(field=field,ref=block['ref'],quote=value.strip()))
    if data:items.append(dict(data=data,evidence=evidence,issues=[],confidence=1))
    if len(items)>500:raise ValueError('Import at most 500 vessel rows at a time')
    return items,{}

def normalize_data(raw,p,evidence,date_order,document_date):
    if not isinstance(raw,dict) or set(raw)-set(FIELDS):raise ValueError('Unsupported import field')
    data={};errors=[]
    for field,value in raw.items():
        if value is None or value=='':continue
        try:
            if field in NUMBERS:
                column=next((x.get('column','') for x in evidence if x['field']==field),'')
                data[field]=numeric(value,field,column)
            elif field in ['eta','start','end']:data[field]=timestamp(value,p['timezone'],date_order,document_date)
            elif field=='ready':
                if isinstance(value,bool):data[field]=value
                elif key(value) in ['yes','true','oui','1','ready','confirmed','pret']:data[field]=True
                elif key(value) in ['no','false','non','0','not ready','unconfirmed']:data[field]=False
                else:raise ValueError('Cargo readiness must be Yes or No')
            elif field=='direction':
                directions={'export':'Export','exportation':'Export','loading':'Export','chargement':'Export','import':'Import','importation':'Import','unloading':'Import','dechargement':'Import'}
                if key(value) not in directions:raise ValueError('Choose Import or Export')
                data[field]=directions[key(value)]
            else:
                if field in ['imo','mmsi'] and isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and int(value)==value:value=str(int(value))
                if field in ['imo','mmsi'] and not re.fullmatch(r'\d{'+('7' if field=='imo' else '9')+r'}',str(value)):raise ValueError('Use a '+('7' if field=='imo' else '9')+' digit '+field.upper())
                if field=='status':
                    statuses={key(v):v for v in ['Scheduled','Waiting','Berthed','Loading','Unloading','Delayed','Completed','Cancelled']}
                    if key(value) not in statuses:raise ValueError('Choose a supported vessel status')
                    value=statuses[key(value)]
                if isinstance(value,(dict,list,bool)):raise ValueError('Use text for '+field)
                data[field]=str(value).strip()[:2000]
        except (ValueError,TypeError,OverflowError) as e:errors.append(field+': '+str(e))
    return data,errors

def find_match(data,calls,explicit=None,force_new=False):
    if force_new:return None,[]
    if explicit:
        found=next((x for x in calls if x['id']==explicit),None)
        return found,([] if found else ['The selected vessel call no longer exists'])
    for identifier in ['call_reference','imo','mmsi']:
        if data.get(identifier):
            matches=[x for x in calls if str(x.get(identifier,''))==str(data[identifier])]
            if identifier!='call_reference' and len(matches)>1:
                dates={data[k][:10] for k in ['eta','start'] if data.get(k)}
                matches=[x for x in matches if any(str(x.get(k,''))[:10] in dates for k in ['eta','start'])]
            if len(matches)==1:return matches[0],[]
            if len(matches)>1:return None,['More than one call matches '+identifier+'; select the correct call']
            if identifier=='call_reference':
                if any(vessel_key(x.get('name'))==vessel_key(data.get('name')) for x in calls):return None,['Unrecognized call reference for an existing vessel. Select the call or explicitly create a new voyage.']
                return None,[]
    if data.get('name'):
        matches=[x for x in calls if vessel_key(x.get('name'))==vessel_key(data['name'])]
        if len(matches)>1:
            dates={data[k][:10] for k in ['eta','start'] if data.get(k)}
            narrowed=[x for x in matches if any(str(x.get(k,''))[:10] in dates for k in ['eta','start'])]
            if len(narrowed)==1:matches=narrowed
        if len(matches)==1:
            supplied=data.get('eta') or data.get('start')
            existing=matches[0].get('eta') or matches[0].get('start')
            if supplied and existing and abs((dt(supplied)-dt(existing)).total_seconds())>7*86400:return None,['Vessel name matches a different planning period. Confirm the call or explicitly create a new voyage.']
            return matches[0],[]
        if len(matches)>1:return None,['Vessel has multiple calls; select a call reference or exact call']
    return None,[]

def resolve_asset(value,assets,label):
    found=[x for x in assets if str(value)==x['id'] or key(value) in [key(x.get('code')),key(x.get('name'))]]
    if len(found)!=1:raise ValueError('Select one configured '+label+': '+str(value))
    return found[0]['id']

def reconcile(c,port,p,batch,check_record):
    calls=records(c,port,'calls');berths=records(c,port,'berths');equipment=records(c,port,'equipment');items=[]
    for index,raw in enumerate(batch.get('items',[])):
        item=copy.deepcopy(raw);item['id']=item.get('id') or str(index+1);item.setdefault('selected',True)
        item['warnings']=list(item.get('issues',[]));item['errors']=[]
        data,errors=normalize_data(item.get('data',{}),p,item.get('evidence',[]),batch.get('date_order','ISO'),batch.get('document_date',''))
        item['errors']+=errors
        item.setdefault('source_data',copy.deepcopy(item.get('data',{})))
        item['normalized_data']=copy.deepcopy(data)
        match,match_errors=find_match(data,calls,item.get('match_id'),item.get('force_new',False));item['errors']+=match_errors
        item['match_id']=match['id'] if match else None;item['base_revision']=match['revision'] if match else 0;item['before']=copy.deepcopy(match)
        proposed=copy.deepcopy(match) if match else dict(id=uid(),name='',status='Scheduled',progress=0,ready=False,priority=3,berth_id=None,equipment_id=None)
        for field,value in data.items():
            if field in ['berth','equipment']:
                try:proposed[field+'_id']=resolve_asset(value,berths if field=='berth' else equipment,field)
                except ValueError as e:item['errors'].append(str(e))
            elif not field.startswith('delay_'):proposed[field]=value
        # Omitted fields keep current values; supplied timing determines a fresh duration.
        if any(k in data for k in ['start','end','duration_hours']):
            proposed.pop('duration_hours',None)
            if 'duration_hours' in data:
                proposed['duration_hours']=data['duration_hours']
                if 'end' not in data:proposed.pop('end',None)
        catalog=p.get('cargo_catalog',[])
        candidates=[r for r in catalog if all(not proposed.get(k) or key(r.get(k,''))==key(proposed[k]) for k in ['direction','product','grade','subgrade'])]
        if len(candidates)==1:
            for k in ['direction','product','grade','subgrade']:proposed[k]=candidates[0].get(k,'')
            proposed['catalog_item_id']=candidates[0]['id']
        elif not match or any(k in data for k in ['product','grade','subgrade','direction']):
            item['errors'].append('Select one exact configured cargo specification (flow, product, grade and sub-grade)')
        if match:
            if data.get('name') and vessel_key(data['name'])==vessel_key(match['name']):proposed['name']=match['name']
            for k in ['loa','draft','imo','mmsi','name']:
                if k in data and proposed.get(k)!=match.get(k):item['errors'].append('Update '+k+' through the vessel/operational form; document schedule imports preserve existing actuals and vessel particulars')
        else:
            if data.get('status') in ['Loading','Unloading','Delayed','Completed'] and 'progress' not in data:item['errors'].append('Operational status requires an explicit progress value; confirm it from the document or use Scheduled')
        item['required_permissions']=[]
        if (match and any(k in data and data[k]!=match.get(k) for k in ['status','progress'])) or (not match and (proposed.get('status')!='Scheduled' or proposed.get('progress')!=0)):
            item['required_permissions'].append('operations.update')
        if match and 'ready' in data and data['ready']!=match.get('ready'):item['required_permissions'].append('readiness.update')
        try:check_record('calls',proposed,p,c,port)
        except (ValueError,HTTPException,KeyError,TypeError) as e:item['errors'].append(str(getattr(e,'detail',e)))
        item['record_errors']=list(item['errors'])
        if all(proposed.get(k) for k in ['eta','start','end','product','quantity','loa','draft']):
            try:
                checks=validate(proposed,calls,berths,equipment,p.get('rules',{}));item['warnings']+=checks['warnings']
            except (ValueError,KeyError,TypeError):item['errors'].append('Complete the operation dates and dimensions before validation')
        item['delay']=None
        if data.get('delay_hours'):
            if data['delay_hours']<=0:item['errors'].append('Delay duration must be positive')
            if not data.get('delay_cause') or not data.get('delay_description'):item['errors'].append('Specify both delay cause and description')
            item['delay']=dict(hours=data['delay_hours'],cause=data.get('delay_cause',''),description=data.get('delay_description',''),department='Operations')
            if data['delay_hours']<=0 or not data.get('delay_cause') or not data.get('delay_description'):item['record_errors']+=item['errors'][len(item['record_errors']):]
            item['warnings'].append('A declared delay requires review and permission to record operational delays')
        item['proposed']=proposed
        item['changes']={k:v for k,v in proposed.items() if k not in ['id','revision','created_at','last_document_import'] and (not match or match.get(k)!=v)}
        item['action']='ambiguous' if match_errors else ('update' if match and (item['changes'] or item['delay'] or item['errors']) else 'unchanged' if match else 'create')
        item['errors']=list(dict.fromkeys(item['errors']));item['warnings']=list(dict.fromkeys(item['warnings']))
        item['confidence']=max(0,min(1,float(item.get('confidence',0))))
        if batch.get('method')=='ai' and not item.get('reviewed'):item['warnings'].append('AI interpretation requires a human review of source evidence before use')
        items.append(item)
    # Conflicts inside the uploaded document must be caught before applying any row.
    matched={x['match_id'] for x in items if x.get('selected') and not x['record_errors'] and x.get('match_id')}
    final_calls=[x for x in calls if x['id'] not in matched]+[x['proposed'] for x in items if x.get('selected') and not x['record_errors']]
    seen=set()
    for item in items:
        if not item.get('selected'):continue
        identity=item['match_id'] or (vessel_key(item['proposed'].get('name')),item['proposed'].get('start'))
        if identity in seen:
            item['errors'].append('Duplicate vessel call in this upload; deselect or merge the repeated row')
            item['record_errors'].append('Duplicate vessel call in this upload; deselect or merge the repeated row')
        seen.add(identity)
        if not item['record_errors']:
            checks=validate(item['proposed'],final_calls,berths,equipment,p.get('rules',{}));item['errors']+=checks['errors']
    batch['items']=items
    chosen=[x for x in items if x['selected'] and x['action']!='unchanged']
    batch['counts']={**{name:sum(x['action']==name for x in items) for name in ['create','update','unchanged','ambiguous']},'selected':len(chosen),'blocked':sum(bool(x['errors']) for x in chosen),'review':sum(bool(x['warnings']) for x in chosen)}
    if not items:batch['status']='Needs interpretation'
    elif not chosen:batch['status']='No changes'
    elif any(x['errors'] for x in chosen):batch['status']='Needs review'
    else:batch['status']='Ready'
    return batch

def revision_check(batch,d):
    if not batch:raise HTTPException(404,'Import not found')
    if batch['revision']!=d.get('revision'):raise ValueError('Import changed. Reload before continuing.')

def editable(batch):
    if batch.get('status') in ['Applied','Drafted','Partially applied','Rolled back']:raise HTTPException(409,'This import has already been applied or drafted; upload the next document version')

def snapshot_version(c,port,u,label):
    for v in records(c,port,'versions'):
        if v['status']=='Published':put(c,port,'versions',dict(v,status='Superseded'),v['id'],v['revision'])
    return put(c,port,'versions',dict(label=label,status='Published',author=u['name'],created_at=now(),calls=records(c,port,'calls'),berths=records(c,port,'berths')))

def apply_row(c,port,p,u,item,import_id,save_record):
    before=record(c,port,'calls',item['match_id']) if item.get('match_id') else None
    if before and before['revision']!=item.get('base_revision',item['proposed'].get('revision')):raise ValueError('The vessel record changed before publication. Reload the import review.')
    call=copy.deepcopy(item['proposed']);call['planned_start']=call['start'];call['planned_end']=call['end']
    call['last_document_import']={'id':import_id,'row':item['id'],'evidence':item.get('evidence',[])}
    call.setdefault('created_at',now())
    result=put(c,port,'calls',call,call['id'],before['revision'] if before else None)
    ledger=dict(item_id=item['id'],call_id=result['id'],before=before,after_revision=result['revision'],delay=None,alerts=[])
    if item.get('delay'):
        old_alerts={x['id'] for x in records(c,port,'alerts')}
        delay=save_record(c,port,'delays',dict(item['delay'],call_id=result['id'],created_at=now(),document_import_id=import_id),u,p)
        ledger['delay']={'id':delay['id'],'revision':delay['revision']}
        ledger['alerts']=[{'id':x['id'],'revision':x['revision']} for x in records(c,port,'alerts') if x['id'] not in old_alerts]
        ledger['after_revision']=record(c,port,'calls',result['id'])['revision']
    return ledger

def mark_import_draft_published(c,port,draft,ledger):
    if not draft.get('import_id'):return
    batch=record(c,port,'imports',draft['import_id'])
    if not batch:return
    batch.setdefault('applied',[]).append(ledger)
    batch['status']='Partially applied' if len(batch['applied'])<len(batch.get('draft_ids',[])) else 'Applied'
    put(c,port,'imports',batch,batch['id'],batch['revision'])


def register_document_imports(app,access,check_record,save_record):
    @app.get('/api/ports/{port}/intelligence/status')
    def model_status(port:str,request:Request):
        with connect() as c:access(c,request,port,'planning.view')
        return ai_status()

    @app.get('/api/ports/{port}/intelligence/analysis')
    def operational_analysis(port:str,request:Request):
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'scenarios.view')
            return analyze_operations(records(c,port,'calls'),records(c,port,'berths'),records(c,port,'equipment'),records(c,port,'delays'),p.get('rules',{}),p.get('demo_clock') or now())

    @app.post('/api/ports/{port}/intelligence/explain')
    async def operational_explanation(port:str,request:Request):
        d=await json_object(request);question=d.get('question','')
        if not isinstance(question,str) or not 1<=len(question.strip())<=2000:raise ValueError('Enter a question up to 2,000 characters')
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'scenarios.view')
            analysis=analyze_operations(records(c,port,'calls'),records(c,port,'berths'),records(c,port,'equipment'),records(c,port,'delays'),p.get('rules',{}),p.get('demo_clock') or now())
        answer=await explain_operations(analysis,question)
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            access(c,request,port,'scenarios.view');audit(c,port,u['id'],'intelligence.explained',port,{'question':question,'finding_ids':[x['id'] for x in analysis.get('findings',[])]})
        return answer

    @app.get('/api/ports/{port}/imports')
    def import_library(port:str,request:Request):
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            access(c,request,port,'planning.view')
            keys=['id','revision','filename','status','created_at','method','counts','summary','draft_ids','setup_candidates']
            return {'batches':[{k:b.get(k) for k in keys} for b in reversed(records(c,port,'imports'))], 'templates':records(c,port,'import_templates')}

    @app.get('/api/ports/{port}/imports/{id}')
    def import_detail(port:str,id:str,request:Request):
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            access(c,request,port,'planning.view');b=record(c,port,'imports',id)
            if not b:raise HTTPException(404,'Import not found')
            return b

    @app.get('/api/ports/{port}/imports/{id}/source')
    def import_source(port:str,id:str,request:Request):
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            access(c,request,port,'planning.view');b=record(c,port,'imports',id)
            if not b:raise HTTPException(404,'Import not found')
            f=record(c,port,'import_files',b['file_id'])
            return Response(base64.b64decode(f['content_base64']),media_type='application/octet-stream',headers={'Content-Disposition':'attachment; filename="'+re.sub(r'[^a-zA-Z0-9._-]','_',b['filename'])+'"'})

    @app.post('/api/ports/{port}/imports/upload')
    async def upload_document(port:str,request:Request):
        d=await json_object(request)
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'planning.draft')
            if len(records(c,port,'imports'))>=200:raise ValueError('This port has reached its 200-document import limit; archive the deployment before adding more')
            template=record(c,port,'import_templates',d.get('template_id','')) if d.get('template_id') else None
            if d.get('template_id') and not template:raise HTTPException(404,'Import template not found')
        filename=d.get('filename','')
        if not isinstance(filename,str) or not filename.strip() or len(filename)>200:raise ValueError('Choose a file with a name up to 200 characters')
        filename=Path(filename.replace('\\','/')).name
        try:
            encoded=d.get('content_base64','')
            if not isinstance(encoded,str) or len(encoded)>MAX_BYTES*4//3+10:raise ValueError()
            content=base64.b64decode(encoded,validate=True)
            if not content or len(content)>MAX_BYTES:raise ValueError()
        except (ValueError,TypeError):raise ValueError('Upload a valid file up to 8 MB')
        setup=d.get('initialize',False)
        if not isinstance(setup,bool):raise ValueError('Initialize must be true or false')
        method=d.get('method','local')
        if method not in ['local','ai']:raise ValueError('Choose local extraction or client-hosted AI')
        date_order=d.get('date_order') or (template or {}).get('date_order','ISO')
        if date_order not in ['ISO','DMY','MDY']:raise ValueError('Choose ISO, day/month/year or month/day/year dates')
        document_date=d.get('document_date','')
        if document_date:
            try:datetime.strptime(document_date,'%Y-%m-%d')
            except (ValueError,TypeError):raise ValueError('Document date must be YYYY-MM-DD')
        context=d.get('context','')
        if not isinstance(context,str) or len(context)>4000:raise ValueError('Document context must be at most 4,000 characters')
        digest=hashlib.sha256(content).hexdigest()
        # Re-upload is idempotent. A different mapping/context can be reviewed on the same batch.
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            access(c,request,port,'planning.draft')
            duplicate=next((b for b in records(c,port,'imports') if b.get('digest')==digest and b.get('method')==method and b.get('initialize',False)==setup and b.get('status')!='Rolled back'),None)
            if duplicate:return duplicate
        extraction=await asyncio.to_thread(extract_document,filename,content)
        mapping=(template or {}).get('mapping',{});table_index=(template or {}).get('table_index',0);header_row=(template or {}).get('header_row',0)
        warnings=list(extraction.get('warnings',[]))
        if method=='ai':
            if not ai_status()['configured']:raise ValueError(ai_status()['message'])
            # The request explicitly selects AI. No document leaves the app for local-only uploads.
            context_port={'name':p['name'],'timezone':p['timezone'],'document_date':document_date,'date_order':date_order,'known_calls':[{k:x.get(k) for k in ['name','imo','mmsi','call_reference','start','eta','product']} for x in records_for(port,'calls')][:1000],'products':p.get('cargo_catalog',[]),'berths':[{k:x.get(k) for k in ['id','code','name']} for x in records_for(port,'berths')],'equipment':[{k:x.get(k) for k in ['id','name','type']} for x in records_for(port,'equipment')]}
            result=await interpret_document(extraction,context_port,filename,content,context)
            items=result['items'];summary=result.get('summary','AI interpretation');warnings+=result.get('warnings',[])
            setup_interpretation=await document_setup.interpret_setup(extraction,context) if setup else []
        else:
            if setup and extraction.get('tables'):
                items=[]
                for index in range(len(extraction['tables'])):
                    extracted,_=local_items(extraction,{},index)
                    items.extend(x for x in extracted if x.get('data',{}).get('name') and any(field in x['data'] for field in ['eta','start','end','quantity','duration_hours']))
                if len(items)>500:raise ValueError('Split this document into imports of at most 500 planning rows')
            else:items,mapping=local_items(extraction,mapping,table_index,header_row)
            summary=f'{len(items)} candidate planning rows extracted locally'
            if extraction.get('needs_ocr'):warnings.append('This document contains image-only content. Provide a text version or use a configured client-hosted vision model for images.')
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'planning.draft')
            # The extraction may have taken time; re-check duplicates and live configuration in the write transaction.
            duplicate=next((b for b in records(c,port,'imports') if b.get('digest')==digest and b.get('method')==method and b.get('initialize',False)==setup and b.get('status')!='Rolled back'),None)
            if duplicate:return duplicate
            source=put(c,port,'import_files',{'content_base64':encoded,'digest':digest})
            batch=dict(filename=filename,digest=digest,file_id=source['id'],method=method,created_at=now(),author_id=u['id'],summary=summary,warnings=warnings,extraction=extraction,mapping=mapping,table_index=table_index,header_row=header_row,date_order=date_order,document_date=document_date,context=context,items=items,applied=[],draft_ids=[],template_id=template['id'] if template else None)
            batch['initialize']=setup
            if setup:
                candidates=document_setup.discover(extraction,items,key)
                if method=='ai':candidates+=setup_interpretation
                truncated=extraction.get('truncated') or any(t.get('truncated') for t in extraction.get('tables',[]))
                if truncated:
                    for candidate in candidates:candidate['issues'].append('Source was truncated; split and re-upload before applying configuration')
                try:access(c,request,port,'config.edit');can_initialize=True
                except HTTPException:can_initialize=False
                batch['setup_candidates']=document_setup.populate(c,port,p,u,candidates,key,check_record,local=method=='local' and not truncated and can_initialize)
            batch=reconcile(c,port,p,batch,check_record)
            if setup and not items:
                batch['status']='Administrator review' if any(x['status']=='Pending administrator' for x in batch.get('setup_candidates',[])) or not batch.get('setup_candidates') else 'Configuration initialized'
                if not batch.get('setup_candidates'):batch['warnings'].append('No supported configuration or planning facts recognized. Administrator interpretation is required.')
            if source_truncated(batch):
                for item in batch['items']:item['errors'].append('Source extraction was truncated; split the document before applying')
                batch['status']='Needs review';batch['counts']['blocked']=batch['counts']['selected']
            saved=put(c,port,'imports',batch)
            audit(c,port,u['id'],'document.extracted',saved['id'],{'filename':filename,'digest':digest,'method':method,'counts':saved['counts']})
            if setup and (any(x['status']=='Pending administrator' for x in saved.get('setup_candidates',[])) or saved['counts'].get('blocked') or method=='ai' or (not items and not saved.get('setup_candidates'))):
                notification(c,port,'Document setup needs administrator review',filename+' contains missing, conflicting or interpreted values. Open Document intelligence to review.',saved['id'])
            if ((template and template.get('auto_apply')) or (setup and items and not any(x['status']=='Pending administrator' for x in saved.get('setup_candidates',[])))) and method=='local' and not (setup and any(x['status']=='Pending administrator' for x in saved.get('setup_candidates',[]))):
                try:
                    # Authorization and policy checks run before any operational mutation.
                    access(c,request,port,'planning.publish')
                    assert_applicable(c,request,port,p,saved,'publish',access,check_record)
                except (HTTPException,ValueError) as e:
                    saved['warnings'].append('Automatic application skipped: '+str(getattr(e,'detail',e)))
                    saved=put(c,port,'imports',saved,saved['id'],saved['revision'])
                else:saved=commit_batch(c,port,p,u,saved,'publish',save_record)
            if setup:
                # Later specification files can satisfy references in earlier uploads.
                for previous in records(c,port,'imports'):
                    if previous['id']==saved['id'] or not previous.get('initialize') or previous['status'] in ['Applied','Drafted','Partially applied','Rolled back']:continue
                    candidates=previous.get('setup_candidates',[])
                    document_setup.populate(c,port,p,u,candidates,key,check_record,local=previous['method']=='local' and can_initialize and not previous['extraction'].get('truncated') and not any(t.get('truncated') for t in previous['extraction'].get('tables',[])))
                    previous=reconcile(c,port,p,previous,check_record)
                    if not previous['items'] and candidates:previous['status']='Administrator review' if any(x['status']=='Pending administrator' for x in candidates) else 'Configuration initialized'
                    if previous['items'] and previous['method']=='local' and can_initialize and not any(x['status']=='Pending administrator' for x in candidates):
                        try:access(c,request,port,'planning.publish');previous=assert_applicable(c,request,port,p,previous,'publish',access,check_record)
                        except (HTTPException,ValueError):pass
                        else:previous=commit_batch(c,port,p,u,previous,'publish',save_record)
                    if previous['status'] not in ['Applied','Drafted','Partially applied','Rolled back']:put(c,port,'imports',previous,previous['id'],previous['revision'])
            return saved

    @app.post('/api/ports/{port}/imports/{id}/setup/{candidate_id}')
    async def resolve_setup(port:str,id:str,candidate_id:str,request:Request):
        d=await json_object(request)
        with connect() as c:
            c.execute('BEGIN IMMEDIATE')
            u,p=access(c,request,port,'config.edit')
            if not document_setup.is_admin(c,u,port):raise HTTPException(403,'Administrator required to resolve document setup')
            batch=record(c,port,'imports',id);revision_check(batch,d)
            candidate=next((x for x in batch.get('setup_candidates',[]) if x['id']==candidate_id),None)
            if not candidate:raise HTTPException(404,'Setup request not found')
            if candidate['status']!='Pending administrator':raise ValueError('This setup request is already resolved')
            if d.get('action')=='skip':
                candidate.update(status='Skipped',resolved_by=u['id'],resolved_at=now())
            elif d.get('action')=='confirm':
                if not isinstance(d.get('data'),dict):raise ValueError('Confirm the setup values')
                if source_truncated(batch) or batch['extraction'].get('truncated') or any(t.get('truncated') for t in batch['extraction'].get('tables',[])):raise ValueError('Split and re-upload the truncated source')
                candidate['data']=d['data']
                document_setup.apply_candidate(c,port,p,u,candidate,key,check_record,confirmed=True)
                if candidate['status']=='Pending administrator':raise ValueError(candidate['issues'][0])
            else:raise ValueError('Choose confirm or skip')
            # Newly confirmed references can make other requests and planning rows valid.
            document_setup.populate(c,port,p,u,batch['setup_candidates'],key,check_record,local=batch['method']=='local')
            if batch['status'] not in ['Applied','Drafted','Partially applied','Rolled back']:
                batch=reconcile(c,port,p,batch,check_record)
            if not batch['items'] and batch.get('setup_candidates'):batch['status']='Administrator review' if any(x['status']=='Pending administrator' for x in batch['setup_candidates']) else 'Configuration initialized'
            saved=put(c,port,'imports',batch,id,batch['revision'])
            audit(c,port,u['id'],'document.setup.reviewed',id,{'candidate':candidate_id,'action':d['action']})
            return saved

    @app.post('/api/ports/{port}/imports/{id}/map')
    async def map_document(port:str,id:str,request:Request):
        d=await json_object(request)
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'planning.draft');b=record(c,port,'imports',id);revision_check(b,d);editable(b)
            if b['method']!='local':raise ValueError('Column mapping is for local extraction; edit AI interpretations in review')
            for k in ['table_index','header_row','mapping','document_date','date_order']:
                if k in d:b[k]=d[k]
            if b.get('date_order') not in ['ISO','DMY','MDY']:raise ValueError('Choose a supported date order')
            b['items'],b['mapping']=local_items(b['extraction'],b.get('mapping',{}),b.get('table_index',0),b.get('header_row',0))
            b=reconcile(c,port,p,b,check_record);saved=put(c,port,'imports',b,id,b['revision']);audit(c,port,u['id'],'document.mapped',id,{'mapping':b['mapping']});return saved

    @app.post('/api/ports/{port}/imports/{id}/review')
    async def review_document(port:str,id:str,request:Request):
        d=await json_object(request)
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'planning.draft');b=record(c,port,'imports',id);revision_check(b,d);editable(b)
            edits=d.get('items',[])
            if not isinstance(edits,list) or len(edits)>500:raise ValueError('Review at most 500 rows')
            known={x['id']:x for x in b['items']};seen=set()
            for edit in edits:
                if not isinstance(edit,dict) or edit.get('id') not in known or edit['id'] in seen:raise ValueError('Select unique rows from this import')
                seen.add(edit['id']);row=known[edit['id']]
                if 'selected' in edit:
                    if not isinstance(edit['selected'],bool):raise ValueError('Row selection must be true or false')
                    row['selected']=edit['selected']
                if 'match_id' in edit:
                    if edit['match_id'] and not record(c,port,'calls',edit['match_id']):raise ValueError('The selected vessel does not belong to this port')
                    row['match_id']=edit['match_id']
                if edit.get('new_call') is True:
                    row['force_new']=True;row['match_id']=None
                elif edit.get('match_id'):row['force_new']=False
                if 'data' in edit:
                    data=edit['data']
                    if not isinstance(data,dict) or set(data)-set(FIELDS):raise ValueError('Unsupported edited planning field')
                    changed={k for k in set(row['data'])|set(data) if row['data'].get(k)!=data.get(k)}
                    row['evidence']=[x for x in row.get('evidence',[]) if x['field'] not in changed]
                    row['manual_fields']=list(set(row.get('manual_fields',[]))|changed);row['data']=data
                row['reviewed']=True
            b=reconcile(c,port,p,b,check_record);saved=put(c,port,'imports',b,id,b['revision']);audit(c,port,u['id'],'document.reviewed',id,{'rows':list(seen)});return saved

    @app.post('/api/ports/{port}/imports/{id}/apply')
    async def apply_document(port:str,id:str,request:Request):
        d=await json_object(request);mode=d.get('mode','draft')
        if mode not in ['draft','publish']:raise ValueError('Choose draft or publish')
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'planning.draft');b=record(c,port,'imports',id);revision_check(b,d);editable(b)
            if mode=='publish':access(c,request,port,'planning.publish')
            b=assert_applicable(c,request,port,p,b,mode,access,check_record)
            return commit_batch(c,port,p,u,b,mode,save_record)

    @app.post('/api/ports/{port}/imports/{id}/template')
    async def save_import_template(port:str,id:str,request:Request):
        d=await json_object(request)
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'config.edit');b=record(c,port,'imports',id);revision_check(b,d)
            name=d.get('name','')
            if not isinstance(name,str) or not 1<=len(name.strip())<=100:raise ValueError('Enter a template name up to 100 characters')
            if b['method']!='local' or not b.get('mapping'):raise ValueError('Save a template from a locally mapped table')
            if not isinstance(d.get('auto_apply',False),bool):raise ValueError('Automatic application must be true or false')
            template=put(c,port,'import_templates',dict(name=name.strip(),mapping=b['mapping'],table_index=b.get('table_index',0),header_row=b.get('header_row',0),date_order=b.get('date_order','ISO'),auto_apply=d.get('auto_apply',False),created_at=now(),author_id=u['id']))
            audit(c,port,u['id'],'import_template.saved',template['id'],template);return template

    @app.post('/api/ports/{port}/imports/{id}/rollback')
    async def rollback_document(port:str,id:str,request:Request):
        d=await json_object(request)
        with connect() as c:
            if request.method == "POST":c.execute("BEGIN IMMEDIATE")
            u,p=access(c,request,port,'planning.publish');b=record(c,port,'imports',id);revision_check(b,d)
            if not b.get('applied') or b['status']=='Rolled back':raise ValueError('Only an applied import can be rolled back; pending proposals remain in Approvals')
            # Validate every revision before reversing any changes.
            for entry in b['applied']:
                current=record(c,port,'calls',entry['call_id'])
                if not current or current['revision']!=entry['after_revision']:raise ValueError('A vessel changed after this import. Review it manually instead of overwriting newer work.')
                for kind,refs in [('delays',[entry['delay']] if entry.get('delay') else []),('alerts',entry.get('alerts',[]))]:
                    for ref in refs:
                        obj=record(c,port,kind,ref['id'])
                        if not obj or obj['revision']!=ref['revision']:raise ValueError('An imported operational event changed. Review it manually before rollback.')
            for entry in b['applied']:
                current=record(c,port,'calls',entry['call_id'])
                restored=entry['before'] or dict(current,status='Cancelled')
                put(c,port,'calls',restored,current['id'],current['revision'])
                for kind,refs in [('delays',[entry['delay']] if entry.get('delay') else []),('alerts',entry.get('alerts',[]))]:
                    for ref in refs:c.execute('DELETE FROM records WHERE id=? AND port_id=? AND kind=?',(ref['id'],port,kind))
            # Withdraw remaining proposals from this import so they cannot publish after reversal.
            for draft_id in b.get('draft_ids',[]):
                draft=record(c,port,'drafts',draft_id)
                if draft and draft['status'] in ['Draft','Submitted','Approved','Clarification requested']:put(c,port,'drafts',dict(draft,status='Rejected'),draft_id,draft['revision'])
            b['status']='Rolled back';b['rolled_back_at']=now();saved=put(c,port,'imports',b,id,b['revision'])
            snapshot_version(c,port,u,'Rollback · '+b['filename']);audit(c,port,u['id'],'document.rolled_back',id,{'ledger':b['applied']});notification(c,port,'Document import rolled back',b['filename'],id);return saved


def records_for(port,kind):
    with connect() as c:return records(c,port,kind)


def assert_applicable(c,request,port,p,batch,mode,access,check_record):
    # Keep reviewed revision baselines; reconciliation must not silently accept concurrent edits.
    for item in batch['items']:
        if item.get('selected') and item.get('match_id'):
            current=record(c,port,'calls',item['match_id'])
            if not current or current['revision']!=item['base_revision']:raise ValueError('A vessel record changed after this import preview. Upload or review the latest document.')
    batch=reconcile(c,port,p,batch,check_record)
    selected=[x for x in batch['items'] if x.get('selected') and x['action']!='unchanged']
    if not selected:raise ValueError('Select at least one changed row')
    if source_truncated(batch):raise ValueError('Split the truncated document before applying')
    for item in selected:
        blocking=item['record_errors'] if mode=='draft' else item['errors']
        if blocking:raise HTTPException(409,{'message':'Resolve import errors before applying','row':item['id'],'errors':blocking})
        if batch['method']=='ai' and not item.get('reviewed'):raise ValueError('Review AI source evidence before applying this row')
        if item.get('issues') and not item.get('reviewed'):raise ValueError('Review uncertain source values before applying')
        if item['action']=='create':access(c,request,port,'calls.create')
        if item.get('delay'):access(c,request,port,'delays.create')
        for permission in item.get('required_permissions',[]):access(c,request,port,permission)
        if mode=='publish' and item['action']=='update':
            eligibility=approval_eligibility(item['before'],item['proposed'],{'errors':item['errors'],'warnings':item['warnings']},p.get('workflow',{}))
            if not eligibility['auto_publish']:raise ValueError('This update requires the configured approval route. Save as drafts and use Approvals.')
        if mode=='publish' and item['warnings']:raise ValueError('Warnings require review through a planning draft')
    return batch


def commit_batch(c,port,p,u,batch,mode,save_record):
    selected=[x for x in batch['items'] if x.get('selected') and x['action']!='unchanged']
    if mode=='publish':
        batch['applied']=[apply_row(c,port,p,u,x,batch['id'],save_record) for x in selected];batch['status']='Applied'
        snapshot_version(c,port,u,'Document import · '+batch['filename'])
    else:
        batch['draft_ids']=[]
        for item in selected:
            proposed=copy.deepcopy(item['proposed']);before=item.get('before') or dict(proposed,revision=0)
            draft=put(c,port,'drafts',dict(call_id=proposed['id'],before=before,proposed=proposed,operation='create' if item['action']=='create' else 'update',reason='Document import: '+batch['filename'],author_id=u['id'],author=u['name'],status='Draft',created_at=now(),validation={'errors':item['errors'],'warnings':item['warnings']},decisions=[],workflow=capture_workflow(c,port,p.get('workflow',{}),u['id']),import_id=batch['id'],import_item_id=item['id'],import_delay=item.get('delay'),import_evidence=item.get('evidence',[]),import_permissions=item.get('required_permissions',[])))
            batch['draft_ids'].append(draft['id'])
        batch['status']='Drafted'
    saved=put(c,port,'imports',batch,batch['id'],batch['revision']);audit(c,port,u['id'],'document.'+mode,batch['id'],{'counts':batch['counts'],'draft_ids':batch['draft_ids']});notification(c,port,'Document import '+('applied' if mode=='publish' else 'drafted'),batch['filename'],batch['id']);return saved


async def json_object(request):
    try: data=await request.json()
    except (ValueError,UnicodeError):raise ValueError('Send a valid JSON object')
    if not isinstance(data,dict):raise ValueError('Send a JSON object')
    return data

def source_truncated(batch):
    extraction=batch['extraction']
    if batch.get('method')=='local' and extraction.get('tables'):
        index=batch.get('table_index',0)
        if isinstance(index,int) and 0<=index<len(extraction['tables']):
            return extraction['tables'][index].get('truncated',extraction.get('truncated',False))
    return extraction.get('truncated',False)
