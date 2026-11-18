"""Port-scoped custom reports. Original workbook observations remain distinguishable from edits."""
import csv
import io
import math
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException, Request
from fastapi.responses import Response
from . import store

DATASETS = {
    'daily_situation': 'Daily situation', 'vessel_lineup': 'Vessel lineup',
    'cargo_lots': 'Cargo specifications / lots', 'berth_plan': 'Berth planning',
    'delays': 'Operational delays', 'actuals': 'Recorded operational actuals',
    'readiness': 'Cargo readiness', 'approvals': 'Approval decisions',
    'plan_changes': 'Schedule changes', 'equipment': 'Equipment availability',
}
LABELS = {
    'vessel':'Vessel', 'call_id':'Vessel call reference', 'phase':'Source situation section',
    'direction':'Import / export', 'product':'Product', 'grade':'Grade', 'subgrade':'Sub-grade',
    'berth':'Quai / berth', 'berth_id':'Berth reference', 'status':'Status',
    'quantity':'Nominated quantity (t)', 'handled':'Cumulative handled (t)',
    'remaining':'Remaining quantity (t)', 'daily_handled':'Workbook reported daily quantity (t)',
    'progress':'Progress (%)', 'eta':'Expected arrival', 'start':'Planned start', 'end':'Planned completion',
    'actual_arrival':'Actual arrival', 'actual_docking':'Actual docking', 'actual_start':'Actual operation start',
    'actual_end':'Actual operation end', 'actual_departure':'Actual departure',
    'customer':'Customer / destination', 'supplier':'Supplier / origin', 'counterparty':'Counterparty',
    'notes':'Remarks', 'source_file':'Source workbook', 'source_sheet':'Source sheet', 'source_row':'Source row / cell',
    'eta_text':'Arrival as written in workbook', 'laycan':'Laycan window', 'incoterm':'Incoterm', 'departure_text':'Departure as written in workbook', 'tolerance':'Cargo tolerance',
    'report_date':'Workbook report date', 'duration_hours':'Duration (h)', 'cause':'Delay cause',
    'department':'Department', 'event_time':'Recorded at', 'author':'Author / reviewer', 'action':'Decision / action',
    'reason':'Reason', 'equipment':'Equipment', 'ready':'Readiness', 'id':'Reference', 'rows':'Records',
}
NUMERIC = {'quantity','handled','remaining','daily_handled','progress','duration_hours','rows'}
BASE = ['vessel','phase','direction','product','grade','subgrade','berth','status','quantity','handled','remaining','daily_handled','eta','start','end','actual_arrival','actual_docking','actual_start','actual_end','actual_departure','customer','supplier','counterparty','notes','report_date','source_file','source_sheet','source_row','eta_text','laycan','incoterm','departure_text','tolerance','call_id']
FIELDS = {
    'daily_situation': BASE, 'vessel_lineup': BASE, 'cargo_lots': BASE,
    'berth_plan': ['vessel','berth','product','quantity','start','end','duration_hours','notes','source_file','source_sheet','source_row','call_id'],
    'actuals': BASE, 'readiness': ['vessel','berth','product','grade','ready','status','quantity','start','end','notes','call_id'],
    'delays': ['vessel','berth','product','cause','department','start','end','duration_hours','notes','event_time','id','call_id'],
    'approvals': ['vessel','berth','status','department','author','action','notes','event_time','id','call_id'],
    'plan_changes': ['vessel','berth','status','author','reason','start','end','event_time','id','call_id'],
    'equipment': ['equipment','berth','status','product','notes','id'],
}
LIST_FILTERS = {'directions':'direction','products':'product','grades':'grade','subgrades':'subgrade','berths':'berth','statuses':'status'}
MAX_ROWS = 10000


def fail(message):
    raise HTTPException(422, message)


def instant(value, tz):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return parsed.replace(tzinfo=tz) if parsed.tzinfo is None else parsed
    except (ValueError, TypeError):
        return None


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def difference(start, end, tz):
    a, b = instant(start,tz), instant(end,tz)
    return round((b-a).total_seconds()/3600,4) if a and b else None


def validate(payload, tz):
    if not isinstance(payload, dict): fail('Report settings must be an object.')
    allowed = {'dataset','origin','start','end','date_basis','directions','products','grades','subgrades','berths','statuses','customer','supplier','search','group_by','columns','limit','format'}
    if set(payload)-allowed: fail('Unknown report option: '+', '.join(sorted(set(payload)-allowed)))
    q = dict(payload)
    q.setdefault('dataset','daily_situation'); q.setdefault('origin','working'); q.setdefault('date_basis','report_date'); q.setdefault('group_by','none')
    if not isinstance(q['dataset'],str) or q['dataset'] not in DATASETS: fail('Choose a supported report dataset.')
    if q['origin'] not in ('working','original'): fail('Origin must be working or original.')
    if q['date_basis'] not in ('report_date','eta','start','end','actual_arrival','actual_start','actual_end','event_time','overlap'): fail('Unsupported date field.')
    if q['group_by'] not in ('none','product','grade','berth','direction','status','day','week','month','year'): fail('Unsupported grouping.')
    for key in ('start','end'):
        value=q.get(key)
        if value and (not isinstance(value,str) or len(value)>40 or not instant(value,tz)): fail('Use valid ISO dates for the report interval.')
    q['_start']=instant(q.get('start'),tz)
    q['_end']=instant(q.get('end'),tz)
    if q['_end'] and len(q.get('end',''))==10: q['_end']+=timedelta(days=1)
    if q['_start'] and q['_end'] and q['_start']>=q['_end']: fail('The end must follow the start date.')
    for key in LIST_FILTERS:
        values=q.get(key,[])
        if not isinstance(values,list) or len(values)>200 or any(not isinstance(v,str) or len(v)>200 for v in values): fail('Invalid '+key+' filter.')
        q[key]=values
    for key in ('search','customer','supplier'):
        if not isinstance(q.get(key,''),str) or len(q.get(key,''))>300: fail('Invalid '+key+' filter.')
    cols=q.get('columns')
    if cols is not None and (not isinstance(cols,list) or not cols or len(cols)>40 or any(v not in FIELDS[q['dataset']] for v in cols) or len(set(cols))!=len(cols)): fail('Choose valid, unique report columns.')
    limit=q.get('limit',500)
    if isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=MAX_ROWS: fail('Row limit must be between 1 and 10000.')
    q['limit']=limit
    return q


def call_row(call, berths, report_date):
    src=call.get('source') or {}
    qty,handled=number(call.get('quantity')),number(call.get('handled_quantity'))
    return {
        'vessel':call.get('name'), 'call_id':call.get('id'), 'phase':call.get('source_phase'),
        'direction':call.get('direction'), 'product':call.get('product'), 'grade':call.get('grade'), 'subgrade':call.get('subgrade'),
        'berth':berths.get(call.get('berth_id'),call.get('source_berth')), 'berth_id':call.get('berth_id'), 'status':call.get('status'),
        'quantity':qty, 'handled':handled, 'remaining':max(0,qty-handled) if qty is not None and handled is not None else None,
        'daily_handled':number(call.get('daily_handled_quantity')), 'progress':number(call.get('progress')),
        **{k:call.get(k) for k in ('eta','start','end','actual_arrival','actual_docking','actual_start','actual_end','actual_departure','notes')},
        'customer':call.get('customer') or call.get('destination'), 'supplier':call.get('supplier') or call.get('origin'),
        'counterparty':call.get('counterparty'), 'eta_text':call.get('eta_text'), 'laycan':call.get('laycan_text'), 'incoterm':call.get('incoterm'), 'departure_text':call.get('departure_text'), 'tolerance':None, 'ready':call.get('ready_status') or ('Ready' if call.get('ready') else 'Not ready'),
        'report_date':report_date,'source_file':src.get('file'),'source_sheet':src.get('sheet'),'source_row':src.get('row',src.get('cell')),
    }


def dataset_rows(c, port_id, p, q, tz):
    originals=q['origin']=='original'
    all_calls=store.records(c,port_id,'calls')
    calls=[dict(x['source_snapshot'],id=x['id']) for x in all_calls if x.get('source_snapshot')] if originals else all_calls
    berths={b['id']:b.get('code',b.get('name',b['id'])) for b in store.records(c,port_id,'berths')}
    report_date=p.get('excel_source',{}).get('report_date')
    base={x['id']:call_row(x,berths,report_date if originals else None) for x in calls}
    dataset=q['dataset']
    notes=['Blank numeric cells mean not reported; zero means a reported zero. Quantities are tonnes.']
    if originals:
        if not calls: notes.append('No immutable workbook snapshot is available for this port.')
        notes.append('Immutable workbook snapshot; daily quantities are observations for '+str(report_date or 'the source date')+', not live meter readings. Planning slots have 12-hour source precision.')
    else:
        notes.append('Current editable operational records. Workbook daily quantities are excluded from working reports; historical daily throughput requires dated measured actuals.')
        for row in base.values():
            row['daily_handled']=None
            progress=number(row.get('progress'))
            if progress is not None and row.get('quantity') is not None:
                row['handled']=round(row['quantity']*progress/100,6)
                row['remaining']=max(0,row['quantity']-row['handled'])
        notes.append('Working handled and remaining tonnage are estimates from current nomination × progress, not measured historical throughput.')
    if dataset in ('vessel_lineup','actuals','readiness') or (dataset=='daily_situation' and not originals):
        rows=list(base.values())
    elif dataset in ('cargo_lots','daily_situation'):
        rows=[]
        if not originals:
            notes.append('Working version has one current cargo specification per vessel call. Choose Original workbook for the original multi-lot breakdown.')
            rows=list(base.values())
        else:
            for call in calls:
                for lot in call.get('cargo_lots',[]):
                    row=dict(base[call['id']]); qty=number(lot.get('quantity')); handled=number(lot.get('handled_quantity'))
                    row.update(product=lot.get('product'),grade=lot.get('grade'),subgrade=lot.get('quality'),quantity=qty,handled=handled,remaining=max(0,qty-handled) if qty is not None and handled is not None else None,daily_handled=number(lot.get('daily_handled_quantity')),counterparty=lot.get('counterparty'),tolerance=lot.get('tolerance'),source_row=lot.get('source_row'))
                    rows.append(row)
    elif dataset=='berth_plan':
        if originals:
            rows=[]
            for x in store.records(c,port_id,'source_plans'):
                src=x.get('source',{})
                rows.append(dict(vessel=x.get('name'),berth=x.get('berth_code'),product=x.get('product'),quantity=number(x.get('quantity')),start=x.get('start'),end=x.get('end'),duration_hours=difference(x.get('start'),x.get('end'),tz),notes=x.get('time_precision'),source_file=src.get('file'),source_sheet=src.get('sheet'),source_row=src.get('cell'),call_id=x.get('call_id'),report_date=report_date))
            notes.append('Rows are planning segments; repeated vessel segments are not unique vessel calls. Planned cargo totals may repeat across source planning grids.')
        else:
            rows=[dict(x,duration_hours=difference(x.get('start'),x.get('end'),tz)) for x in base.values()]
    else:
        if originals:
            return [],notes+['This dataset has no structured original workbook records. Choose Current working version.']
        kind={'delays':'delays','approvals':'drafts','plan_changes':'drafts','equipment':'equipment'}[dataset]
        rows=[]
        for x in store.records(c,port_id,kind):
            callid=x.get('call_id') or (x.get('before') or {}).get('id')
            row=dict(base.get(callid,{})); row.update(id=x['id'],call_id=callid)
            if dataset=='equipment':
                row.update(equipment=x.get('name'),berth=', '.join(berths.get(b,b) for b in x.get('berths',[]) or ([x['berth_id']] if x.get('berth_id') else [])),status=x.get('status'),product=', '.join(str(v) for v in x.get('products',[])),notes=x.get('notes'))
            elif dataset=='delays':
                hours=number(x.get('duration_hours',x.get('hours')))
                row.update(cause=x.get('cause') or x.get('category'),department=x.get('department'),start=x.get('start'),end=x.get('end'),duration_hours=hours if hours is not None else difference(x.get('start'),x.get('end'),tz),notes=x.get('description') or x.get('notes'),event_time=x.get('created_at'))
            elif dataset=='plan_changes':
                proposal=x.get('proposed') or {}; row.update(vessel=(x.get('before') or {}).get('name',row.get('vessel')),berth=berths.get(proposal.get('berth_id')),status=x.get('status'),author=x.get('author'),reason=x.get('reason'),start=proposal.get('start'),end=proposal.get('end'),event_time=x.get('created_at'))
            else:
                for decision in x.get('decisions',[]):
                    rows.append(dict(row,status=x.get('status'),department=decision.get('department'),author=decision.get('author'),action=decision.get('action'),notes=decision.get('comment'),event_time=decision.get('created_at')))
                continue
            rows.append(row)
    return rows,notes


def build_report(c, port_id, p, payload, export=False):
    try: tz=ZoneInfo(p.get('timezone') or 'Africa/Casablanca')
    except (ValueError,KeyError): tz=timezone.utc
    q=validate(payload,tz)
    rows,notes=dataset_rows(c,port_id,p,q,tz)
    filtered=[]
    for row in rows:
        if any(q[key] and str(row.get(field,'')) not in q[key] and not(key=='berths' and row.get('berth_id') in q[key]) for key,field in LIST_FILTERS.items()): continue
        if any(q.get(k) and q[k].casefold() not in str(row.get(k) or '').casefold() for k in ('customer','supplier')): continue
        if q.get('search') and q['search'].casefold() not in ' '.join(str(v or '') for v in row.values()).casefold(): continue
        if q['_start'] or q['_end']:
            basis=q['date_basis']
            if basis=='report_date' and not row.get('report_date'):
                basis='event_time' if q['dataset'] in ('delays','approvals','plan_changes') else 'start'
            a=instant(row.get('start' if basis=='overlap' else basis),tz)
            b=instant(row.get('end'),tz) if basis=='overlap' else a
            if not a or (q['_start'] and (b or a)<q['_start']) or (q['_end'] and a>=q['_end']): continue
        filtered.append(row)
    # Summary uses ungrouped row grain. Berth planning segments never masquerade as unique nominated cargo.
    summary={'records':len(filtered),'vessels':len({r['call_id'] for r in filtered if r.get('call_id')}),'origin':q['origin'],'report_date':p.get('excel_source',{}).get('report_date') if q['origin']=='original' else None}
    for field in ('quantity','handled','remaining','daily_handled','duration_hours'):
        values=[r[field] for r in filtered if field in FIELDS[q['dataset']] and number(r.get(field)) is not None]
        summary[field]=round(sum(values),6) if values else None
    if q['dataset']=='berth_plan': summary['quantity']=None
    fields=FIELDS[q['dataset']]
    if q['group_by']!='none':
        by=q['group_by']; grouped={}
        for row in filtered:
            if by in ('day','week','month','year'):
                basis='start' if q['date_basis']=='overlap' else q['date_basis']
                value_date=row.get(basis)
                if basis=='report_date' and not value_date: value_date=row.get('event_time') or row.get('start')
                when=instant(value_date,tz)
                value=None
                if when:
                    d=when.astimezone(tz).date()
                    value=str(d) if by=='day' else str(d-timedelta(days=d.weekday())) if by=='week' else d.strftime('%Y-%m') if by=='month' else str(d.year)
            else: value=row.get(by)
            group=grouped.setdefault(value,{'group':value,'rows':0,**{f:None for f in NUMERIC if f not in ('rows','progress')}})
            group['rows']+=1
            for f in ('quantity','handled','remaining','daily_handled','duration_hours'):
                if number(row.get(f)) is not None: group[f]=(group[f] or 0)+row[f]
        filtered=list(grouped.values()); fields=['group','rows']+[f for f in ('quantity','handled','remaining','daily_handled','duration_hours') if f in FIELDS[q['dataset']]]
        cols=fields
        notes.append('Grouped totals sum rows of this dataset; records count represents its row grain.')
    else: cols=q.get('columns') or fields[:14]
    definitions=[{'id':f,'label':('Group: '+q['group_by'] if f=='group' else LABELS.get(f,f)),'type':'number' if f in NUMERIC else 'text'} for f in fields]
    limit=MAX_ROWS if export else q['limit']
    if export and len(filtered)>MAX_ROWS: fail('More than 10000 rows. Narrow the report filters before export.')
    return {'dataset':q['dataset'],'title':DATASETS[q['dataset']],'origin':q['origin'],'fields':definitions,'columns':[d for d in definitions if d['id'] in cols], 'rows':[{k:r.get(k) for k in cols} for r in filtered[:limit]],'summary':summary,'total_rows':len(filtered),'truncated':len(filtered)>limit,'notes':notes,'generated_at':store.now()}


def safe_cell(value):
    if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@')): return "'"+value
    return value


def export_report(report, fmt):
    columns=report['columns']; matrix=[[safe_cell(row.get(f['id'])) for f in columns] for row in report['rows']]
    filename='portside-'+report['dataset']+'-'+report['origin']+'.'+fmt
    if fmt=='csv':
        buf=io.StringIO(); writer=csv.writer(buf);writer.writerow([f['label'] for f in columns]);writer.writerows(matrix)
        data=('\ufeff'+buf.getvalue()).encode('utf-8'); mime='text/csv; charset=utf-8'
    elif fmt=='xlsx':
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        wb=Workbook();ws=wb.active;ws.title='Report';ws.append([f['label'] for f in columns])
        for row in matrix: ws.append(row)
        ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions
        for cell in ws[1]: cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='103D5A')
        for col in ws.columns: ws.column_dimensions[col[0].column_letter].width=min(45,max(16,max(len(str(x.value or '')) for x in col[:101])+2))
        meta=wb.create_sheet('Context');meta.append(['Origin',report['origin']]);meta.append(['Generated at',report['generated_at']])
        for note in report['notes']:meta.append([note])
        for key,value in report['summary'].items():meta.append([LABELS.get(key,key),safe_cell(value)])
        buf=io.BytesIO();wb.save(buf);data=buf.getvalue();mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    else:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A3, landscape
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
        from reportlab.lib.styles import getSampleStyleSheet
        from xml.sax.saxutils import escape
        buf=io.BytesIO();doc=SimpleDocTemplate(buf,pagesize=landscape(A3),leftMargin=24,rightMargin=24,topMargin=24,bottomMargin=24)
        style=getSampleStyleSheet();style['BodyText'].fontSize=7;style['BodyText'].leading=9
        story=[Paragraph(escape(report['title']+' — '+report['origin']),style['Title'])]
        for note in report['notes']:story.append(Paragraph(escape(note),style['BodyText']))
        # Wide selections continue in labeled sections rather than shrinking text to illegibility.
        for offset in range(0,len(columns),10):
            if offset:story.append(PageBreak())
            subset=columns[offset:offset+10]
            if offset and columns[0] not in subset:subset=[columns[0]]+subset
            story.append(Spacer(1,10));rows=[[Paragraph(escape(f['label']),style['BodyText']) for f in subset]]
            for row in report['rows']:rows.append([Paragraph(escape(str(row.get(f['id']) if row.get(f['id']) is not None else '')),style['BodyText']) for f in subset])
            table=Table(rows,repeatRows=1,colWidths=[(landscape(A3)[0]-48)/len(subset)]*len(subset));table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#DCEAF1')),('GRID',(0,0),(-1,-1),.3,colors.HexColor('#BDCFD9')),('VALIGN',(0,0),(-1,-1),'TOP')]))
            story.append(table)
        doc.build(story);data=buf.getvalue();mime='application/pdf'
    return Response(data,media_type=mime,headers={'Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store'})


def register_reporting(app, access):
    @app.post('/api/ports/{port}/reports/query')
    def query(port: str, request: Request, payload: dict):
        with store.connect() as c:
            _,p=access(c,request,port,'reports.view')
            return build_report(c,port,p,payload)

    @app.post('/api/ports/{port}/reports/custom-export')
    def download(port: str, request: Request, payload: dict):
        with store.connect() as c:
            u,p=access(c,request,port,'reports.export')
            fmt=payload.get('format','xlsx')
            if fmt not in ('csv','xlsx','pdf'):fail('Choose CSV, XLSX or PDF.')
            report=build_report(c,port,p,payload,export=True)
            response=export_report(report,fmt)
            store.audit(c,port,u['id'],'report.custom-export',detail={'dataset':report['dataset'],'origin':report['origin'],'rows':report['total_rows'],'format':fmt})
            return response
