"""Shared hard constraints for drafts, publication, and scenario recommendations."""
import math
from .policies import policy_errors, constrained_asset
from datetime import datetime, timezone, timedelta

def dt(v):
    x=datetime.fromisoformat(v.replace('Z','+00:00'))
    return x.replace(tzinfo=timezone.utc) if x.tzinfo is None else x

def _stamp(value):
    try: return dt(value) if value else None
    except (TypeError, ValueError): return None

def align_forecast_for_earlier_start(before, proposed):
    """Keep ETA/cargo-ready forecasts usable when a planned start is moved earlier."""
    before=before or {}; proposed=dict(proposed or {})
    if not proposed.get('start') or before.get('actual_arrival'): return proposed
    start=_stamp(proposed.get('start')); eta=_stamp(proposed.get('eta'))
    if not start or not eta or start>=eta: return proposed
    old_start=_stamp(before.get('start')); old_eta=_stamp(before.get('eta'))
    lead=(old_start-old_eta).total_seconds()/3600 if old_start and old_eta else 0
    if not math.isfinite(lead) or lead<0: lead=0
    proposed['eta']=(start-timedelta(hours=lead)).isoformat()
    ready=_stamp(proposed.get('ready_at'))
    if ready and start<ready:
        old_ready=_stamp(before.get('ready_at'))
        ready_lead=(old_start-old_ready).total_seconds()/3600 if old_start and old_ready else 0
        if not math.isfinite(ready_lead) or ready_lead<0: ready_lead=0
        proposed['ready_at']=(start-timedelta(hours=ready_lead)).isoformat()
    return proposed

def overlap(a,b,buffer=0): return dt(a['start']) < dt(b['end'])+timedelta(hours=buffer) and dt(a['end'])+timedelta(hours=buffer)>dt(b['start'])

def compatible(call,berth,equipment,rules=None):
    berth=constrained_asset(berth,"berths",rules)
    if equipment: equipment=constrained_asset(equipment,"equipment",rules)
    errors=policy_errors(call,berth,rules)
    if float(call.get('loa',0))>float(berth.get('max_loa',0)): errors.append('Vessel length exceeds the berth limit')
    if float(call.get('draft',0))>float(berth.get('max_draft',0)): errors.append('Vessel draft exceeds the berth limit')
    if call.get('product') not in berth.get('cargo',[]): errors.append('Cargo is incompatible with this berth')
    if berth.get('status') in ['Closed','Maintenance']: errors.append('Berth is unavailable')
    if equipment:
        if float(call.get('loa',0))>float(equipment.get('max_loa',math.inf)): errors.append('Vessel length exceeds the equipment constraint')
        if float(call.get('draft',0))>float(equipment.get('max_draft',math.inf)): errors.append('Vessel draft exceeds the equipment constraint')
        if berth['id'] not in equipment.get('berths',[]): errors.append('Equipment cannot serve this berth')
        if equipment.get('status')!='Available': errors.append('Required equipment is unavailable')
    else: errors.append('Required equipment has not been assigned')
    return errors

def validate(call,calls,berths,equipment,rules=None):
    errors=[]; warnings=[]
    b=next((b for b in berths if b['id']==call.get('berth_id')),None)
    e=next((e for e in equipment if e['id']==call.get('equipment_id')),None)
    if not b: return {'errors':['Assign a configured berth'], 'warnings':[]}
    b=constrained_asset(b,"berths",rules)
    if e: e=constrained_asset(e,"equipment",rules)
    errors+=compatible(call,b,e,rules)
    start,end=dt(call['start']),dt(call['end'])
    if end<=start: errors.append('Completion must be after the start')
    if start<dt(call['eta']): errors.append('The operation starts before vessel arrival')
    if call.get('actual_arrival') and start<dt(call['actual_arrival']): errors.append('The operation starts before vessel arrival')
    if call.get('ready_at'):
        try:
            if start<dt(call['ready_at']): errors.append('Cargo will not be available at the planned start')
        except ValueError:
            errors.append('Cargo readiness time is invalid')
    if not call.get('ready',False): errors.append('Cargo readiness has not been confirmed')
    if e and (end-start).total_seconds()>0 and float(call['quantity'])/((end-start).total_seconds()/3600)>float(e.get('capacity',0)):
        errors.append('Required handling rate exceeds equipment capacity')
    for other in calls:
        if other['id']==call.get('id') or other.get('status') in ['Completed','Cancelled']: continue
        if other.get('berth_id')==b['id'] and overlap(call,other,float(b.get('buffer_hours',1))): errors.append(f'Berth overlap or safety buffer with {other["name"]}')
        if e and other.get('equipment_id')==e['id'] and overlap(call,other): errors.append(f'Equipment double-booked with {other["name"]}')
    if call.get('status')=='Delayed': warnings.append('This operation has an active delay. Review the recovery forecast.')
    return {'errors':list(dict.fromkeys(errors)),'warnings':warnings}

def optimize(calls,berths,equipment,scenario,rules=None):
    from ortools.sat.python import cp_model
    berths=[constrained_asset(b,"berths",rules) for b in berths]
    equipment=[constrained_asset(e,"equipment",rules) for e in equipment]
    jobs=[dict(c) for c in calls if c.get('status') not in ['Completed','Cancelled']]
    if not jobs: return {'status':'Feasible','calls':[],'waiting_hours':0,'added_delay_hours':0,'engine':'OR-Tools CP-SAT','reasons':[]}
    base=min(dt(c['start']) for c in jobs).replace(minute=0,second=0,microsecond=0)
    model=cp_model.CpModel(); horizon=24*30*4
    by_berth={b['id']:[] for b in berths}; by_eq={e['id']:[] for e in equipment}
    choices={}; starts={}; ends={}; terms=[]; reasons=[]
    for c in jobs:
        original=max(0,math.ceil((dt(c['start'])-base).total_seconds()/900))
        earliest=max(original, math.ceil((dt(c['eta'])-base).total_seconds()/900))
        if c.get('ready_at'): earliest=max(earliest,math.ceil((dt(c['ready_at'])-base).total_seconds()/900))
        if scenario.get('call_id')==c['id']: earliest+=math.ceil(float(scenario.get('delay_hours',0))*4)
        duration=max(1,math.ceil((dt(c['end'])-dt(c['start'])).total_seconds()/900))
        rate_factor=float(scenario.get('rate_factor',1))
        if rate_factor<=0: raise ValueError('Rate factor must be positive')
        duration=math.ceil(duration/rate_factor)
        s=model.new_int_var(earliest,horizon,'s'+c['id']); end=model.new_int_var(0,horizon,'e'+c['id']); model.add(end==s+duration)
        starts[c['id']]=s; ends[c['id']]=end; options=[]
        for b in berths:
            if b['id']==scenario.get('closed_berth'): continue
            for e in equipment:
                if e['id']==scenario.get('outage_equipment'): continue
                if compatible(c,b,e,rules) or not c.get('ready'): continue
                if float(c['quantity'])/(duration/4)>float(e.get('capacity',0)): continue
                chosen=model.new_bool_var(c['id']+b['id']+e['id'])
                interval=model.new_optional_interval_var(s,duration,end,chosen,'i'+chosen.name)
                # Berth safety buffer extends occupancy, independently of equipment use.
                buffer=math.ceil(float(b.get('buffer_hours',1))*4)
                bend=model.new_int_var(0,horizon+buffer,'be'+chosen.name); model.add(bend==end+buffer)
                binterval=model.new_optional_interval_var(s,duration+buffer,bend,chosen,'bi'+chosen.name)
                by_berth[b['id']].append(binterval); by_eq[e['id']].append(interval)
                options.append(chosen); choices[(c['id'],b['id'],e['id'])]=chosen
                if b['id']!=c.get('berth_id'): terms.append(chosen*4)
        if not options: reasons.append(f'{c["name"]}: no compatible available berth and equipment with confirmed cargo readiness.')
        else: model.add_exactly_one(options)
        terms.append((s-original)*max(1,int(c.get('priority',1))))
    if reasons: return {'status':'Infeasible','reasons':reasons,'calls':[],'engine':'OR-Tools CP-SAT'}
    for intervals in [*by_berth.values(),*by_eq.values()]: model.add_no_overlap(intervals)
    model.minimize(sum(terms)); solver=cp_model.CpSolver(); solver.parameters.max_time_in_seconds=8; solver.parameters.num_search_workers=2
    result=solver.solve(model)
    if result not in [cp_model.OPTIMAL,cp_model.FEASIBLE]: return {'status':'Infeasible' if result==cp_model.INFEASIBLE else 'No solution within time limit','reasons':['No feasible schedule found in the 30-day horizon.'],'calls':[],'engine':'OR-Tools CP-SAT'}
    output=[]; added=0; waiting=0
    for c in jobs:
        for (id,b,e),v in choices.items():
            if id==c['id'] and solver.value(v): c.update(berth_id=b,equipment_id=e); break
        newstart=base+timedelta(minutes=15*solver.value(starts[c['id']]))
        added+=max(0,(newstart-dt(c['start'])).total_seconds()/3600)
        waiting+=max(0,(newstart-dt(c['eta'])).total_seconds()/3600)
        c['start']=newstart.isoformat(); c['end']=(base+timedelta(minutes=15*solver.value(ends[c['id']]))).isoformat(); output.append(c)
    return {'status':'Optimal' if result==cp_model.OPTIMAL else 'Feasible','calls':output,'added_delay_hours':round(added,1),'waiting_hours':round(waiting,1),'objective':solver.objective_value,'engine':'OR-Tools CP-SAT','reasons':['Minimizes priority-weighted start delay and berth reassignments. Quarter-hour resolution; 30-day horizon.']}
