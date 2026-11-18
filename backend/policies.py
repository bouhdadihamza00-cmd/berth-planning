"""Declarative cargo access rules and bounded approval automation."""
import math
from datetime import datetime, timezone


def normalize_rules(rules, berth_ids=None, equipment_ids=None):
    if not isinstance(rules, dict):
        raise ValueError('Planning rules must be an object')
    result = dict(rules)
    items = rules.get('custom_rules', [])
    if not isinstance(items, list) or len(items) > 200:
        raise ValueError('Provide at most 200 planning rules')
    normalized = []
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Each planning rule must be an object')
        identifier = str(item.get('id', '')).strip()
        name = str(item.get('name', '')).strip()
        if not identifier or identifier in seen or not name:
            raise ValueError('Each planning rule needs a unique reference and a name')
        seen.add(identifier)
        if item.get('effect') not in ('allow', 'deny'):
            raise ValueError('Choose Allow or Deny for each planning rule')
        targets = item.get('berth_ids', [])
        if not isinstance(targets, list) or not targets or any(not isinstance(x, str) for x in targets):
            raise ValueError('Select at least one berth for each planning rule')
        if berth_ids is not None and any(x not in berth_ids for x in targets):
            raise ValueError('A planning rule refers to an unknown berth')
        direction = item.get('direction', '')
        if direction not in ('', 'Export', 'Import'):
            raise ValueError('Cargo flow must be Export, Import or Any')
        normalized.append(dict(id=identifier, name=name[:160], enabled=item.get('enabled', True) is not False,
                               effect=item['effect'], berth_ids=list(dict.fromkeys(targets)), direction=direction,
                               **{key: str(item.get(key, '')).strip() for key in ('product', 'grade', 'subgrade')}))
    constraints=rules.get('asset_constraints',[])
    if not isinstance(constraints,list) or len(constraints)>200: raise ValueError('Provide at most 200 asset constraints')
    checked=[]; constraint_ids=set()
    for item in constraints:
        if not isinstance(item,dict): raise ValueError('Invalid asset constraint')
        identifier=item.get('id'); name=item.get('name'); kind=item.get('kind'); field=item.get('field'); value=item.get('value')
        if not isinstance(identifier,str) or not identifier or identifier in constraint_ids or not isinstance(name,str) or not name.strip() or len(name)>160: raise ValueError('Each constraint needs a unique reference and name')
        if kind not in ['berths','equipment'] or field not in (['max_loa','max_draft','buffer_hours'] if kind=='berths' else ['max_loa','max_draft','capacity']): raise ValueError('Choose a supported asset constraint')
        known=berth_ids if kind=='berths' else equipment_ids
        if not isinstance(item.get('asset_id'),str) or not item['asset_id'] or (known is not None and item['asset_id'] not in known): raise ValueError('Select a configured asset')
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0 or value>1000000 or (field!='buffer_hours' and value==0) or (field=='buffer_hours' and value>168): raise ValueError('Enter a valid positive limit, or a safety gap from 0 to 168 hours')
        if not isinstance(item.get('enabled',True),bool): raise ValueError('Constraint enabled setting must be true or false')
        constraint_ids.add(identifier)
        checked.append({k:item[k] for k in ['id','name','kind','asset_id','field','value']} | {'enabled':item.get('enabled',True)})
    result['asset_constraints']=checked
    result['custom_rules'] = normalized
    return result


def constrained_asset(asset,kind,rules=None):
    result=dict(asset)
    for rule in (rules or {}).get('asset_constraints',[]):
        if rule['kind']==kind and rule['asset_id']==asset['id'] and rule.get('enabled',True):
            key=rule['field']; value=rule['value']
            result[key]=(max if key=='buffer_hours' else min)(float(result.get(key,value)),value)
    return result


def policy_errors(call, berth, rules=None):
    matching = [rule for rule in (rules or {}).get('custom_rules', [])
                if rule.get('enabled', True) and all(not rule.get(key) or rule[key] == call.get(key)
                for key in ('direction', 'product', 'grade', 'subgrade'))]
    denied = [rule for rule in matching if rule.get('effect') == 'deny' and berth['id'] in rule.get('berth_ids', [])]
    if denied:
        return ['Denied by planning rule: ' + rule['name'] for rule in denied]
    allowed = [rule for rule in matching if rule.get('effect') == 'allow']
    if allowed and not any(berth['id'] in rule.get('berth_ids', []) for rule in allowed):
        return ['Cargo may only use berths selected in these planning rules: ' + ', '.join(rule['name'] for rule in allowed)]
    return []


def _time(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp


def approval_eligibility(before, proposed, validation, workflow):
    mode = workflow.get('approval_mode', 'manual')
    if mode not in ('manual', 'semi', 'automatic'):
        mode = 'manual'
    reasons = []
    if validation.get('errors'):
        reasons.append('Resolve all planning conflicts')
    if validation.get('warnings'):
        reasons.append('A planner must review the active warnings')
    for key in ('direction', 'product', 'grade', 'subgrade', 'quantity', 'equipment_id'):
        if before.get(key) != proposed.get(key):
            reasons.append('Cargo or equipment changes require a reviewer')
            break
    if before.get('berth_id') != proposed.get('berth_id') and not workflow.get('auto_allow_berth_change', False):
        reasons.append('Berth reassignment requires a reviewer')
    try:
        shift_limit = float(workflow.get('auto_max_shift_hours', 2))
        duration_limit = float(workflow.get('auto_max_duration_change_hours', 2))
        if not all(math.isfinite(x) and 0 <= x <= 720 for x in (shift_limit, duration_limit)):
            raise ValueError('Invalid automation thresholds')
        shift = abs((_time(proposed['start']) - _time(before['start'])).total_seconds()) / 3600
        before_duration = (_time(before['end']) - _time(before['start'])).total_seconds() / 3600
        after_duration = (_time(proposed['end']) - _time(proposed['start'])).total_seconds() / 3600
        if shift > shift_limit:
            reasons.append('Start movement exceeds the automatic approval limit')
        if abs(after_duration - before_duration) > duration_limit:
            reasons.append('Duration change exceeds the automatic approval limit')
    except (ValueError, TypeError, KeyError):
        reasons.append('Automation needs valid dates and thresholds')
    eligible = not reasons and mode != 'manual'
    if mode == 'manual':
        reasons.append('Manual approval is configured')
    return dict(mode=mode, eligible=eligible, auto_approve=eligible,
                auto_publish=eligible and mode == 'automatic', reasons=list(dict.fromkeys(reasons)))
