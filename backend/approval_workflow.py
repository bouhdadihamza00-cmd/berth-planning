"""Explicit approval stages with captured reviewers and any/all decisions."""
import copy
import json
from fastapi import HTTPException
from .store import records

ACTIVE_DRAFT_STATUSES = ('Draft', 'Submitted', 'Clarification requested')


def active_draft_for_call(c, port, call_id, exclude=None):
    """Return the unfinished workflow blocking a new draft for this vessel call."""
    return next((d for d in records(c, port, 'drafts')
                 if d.get('call_id') == call_id
                 and d.get('status') in ACTIVE_DRAFT_STATUSES
                 and d['id'] != exclude), None)


def reviewers(c, port):
    result=[]
    for row in c.execute('SELECT u.id,u.name,u.active,m.department,m.permissions FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.port_id=?',(port,)):
        if row['active'] and 'approvals.approve' in json.loads(row['permissions']):
            result.append({'id':row['id'],'name':row['name'],'department':row['department']})
    return result


def normalize_workflow(workflow, departments, members):
    if 'steps' not in workflow:return workflow
    steps=workflow['steps']
    if not isinstance(steps,list) or not 1<=len(steps)<=50:raise ValueError('Configure between 1 and 50 approval steps')
    known={x['id']:x for x in members};seen=set();result=[]
    for item in steps:
        if not isinstance(item,dict):raise ValueError('Invalid approval step')
        identifier=item.get('id');name=item.get('name','');department=item.get('department','');users=item.get('user_ids',[])
        if not isinstance(identifier,str) or not identifier or identifier in seen or not isinstance(name,str) or not name.strip():raise ValueError('Each approval step needs a unique ID and name')
        seen.add(identifier)
        if department and department not in departments:raise ValueError('Unknown approval department')
        if not isinstance(users,list) or any(not isinstance(x,str) or x not in known for x in users):raise ValueError('Choose active port members with approval permission')
        if department and users:raise ValueError('Choose either a department or named reviewers for each step')
        if not department and not users:raise ValueError('Assign reviewers to every approval step')
        if department and not any(x['department']==department for x in members):raise ValueError('The selected department has no active reviewers with approval permission')
        if item.get('decision') not in ['any','all']:raise ValueError('Choose any or all reviewers')
        result.append({'id':identifier,'name':name.strip()[:160],'department':department,'user_ids':list(dict.fromkeys(users)),'decision':item['decision']})
    return {**workflow,'steps':result,'departments':list(dict.fromkeys(x['department'] for x in result if x['department']))}


def capture_workflow(c,port,workflow,author_id=None):
    captured=copy.deepcopy(workflow)
    if captured.get('steps'):
        members=reviewers(c,port)
        for step in captured['steps']:
            if step.get('department'):step['user_ids']=[x['id'] for x in members if x['department']==step['department']]
            if captured.get('segregation') and author_id:step['user_ids']=[id for id in step['user_ids'] if id!=author_id]
            if not step.get('user_ids'):raise ValueError('An approval step has no eligible reviewers; ask an administrator to update the route')
    return captured


def completed(step,decisions):
    approved={d['user_id'] for d in decisions if d['action']=='approve' and d.get('step_id')==step['id']}
    required=set(step.get('user_ids',[]))
    if not required:return False
    if any(d['action']=='approve' and d.get('step_id')==step['id'] and d.get('admin_override') for d in decisions):return True
    return required<=approved if step['decision']=='all' else bool(required & approved)


def decision_step(workflow,decisions,user_id,requested=None,override=False):
    remaining=[step for step in workflow['steps'] if not completed(step,decisions)]
    if workflow.get('mode','sequential')=='sequential':remaining=remaining[:1]
    if override:
        allowed=remaining
    else:
        allowed=[step for step in remaining if user_id in step.get('user_ids',[]) and not any(d['action']=='approve' and d.get('step_id')==step['id'] and d['user_id']==user_id for d in decisions)]
    if requested:allowed=[step for step in allowed if step['id']==requested]
    if not allowed:raise HTTPException(403,'You are not an outstanding reviewer in an active approval step')
    return allowed[0]
