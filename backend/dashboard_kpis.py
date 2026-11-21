"""Shared KPI definitions and arithmetic over the dashboard's measured data."""
import ast
import keyword
import math
import operator
import re
from datetime import timedelta

DEFAULTS = {
    'active': ('Active vessel calls', '', 'active_calls'),
    'upcoming': ('Upcoming arrivals', '', 'upcoming_arrivals'),
    'utilization': ('Berth utilization', '%', 'berth_occupancy_pct'),
    'waiting': ('Avg. waiting time', 'h', 'waiting_hours'),
    'turnaround': ('Avg. turnaround', 'h', 'turnaround_hours'),
    'adherence': ('Schedule adherence', '%', 'adherence_pct'),
    'delays': ('Operational delays', 'h', 'delay_hours'),
    'conflicts': ('Planning conflicts', '', 'planning_conflicts'),
}
WIDGETS = {
    'widget_map': dict(name='Map', width=5, height=4, min_width=1.5, min_height=3, width_step=0.5),
    'widget_operations': dict(name='Ongoing operations', width=3, height=2, min_width=2, min_height=2),
    'widget_berths': dict(name='Berth status', width=3, height=2, min_width=2, min_height=2),
    'widget_cargo': dict(name='Cargo throughput', width=3, height=2, min_width=2, min_height=2),
    'widget_delays': dict(name='Operational delays', width=3, height=2, min_width=2, min_height=2),
    'widget_alerts': dict(name='Alerts & planning risks', width=2, height=2, min_width=2, min_height=2),
    'widget_calls': dict(name='Vessel calls', width=3, height=2, min_width=2, min_height=2, optional=True),
    'widget_weather': dict(name='Weather', width=2, height=2, min_width=2, min_height=2, optional=True),
}
VARIABLES = {
    'active_calls': 'Vessels in port or at anchorage',
    'upcoming_arrivals': 'Arrivals in the next 48 hours',
    'berth_occupancy_pct': 'Occupied berths, percent',
    'waiting_hours': 'Average waiting time, 30 days',
    'turnaround_hours': 'Average turnaround, 30 days',
    'adherence_pct': 'Starts within one hour of plan, percent',
    'delay_hours': 'Recorded operational delay hours',
    'planning_conflicts': 'Calls with planning conflicts',
    'open_alerts': 'Open alerts',
    'configured_berths': 'Configured berths',
}
for days in (7, 30, 90):
    for direction in ('all', 'import', 'export'):
        for metric, label in (
            ('completed', 'Completed calls'), ('cargo_tonnes', 'Cargo handled, tonnes'),
            ('waiting_hours', 'Average waiting time, hours'), ('turnaround_hours', 'Average turnaround, hours'),
        ):
            VARIABLES[f'{metric}_{direction}_{days}d'] = f'{label} · {direction} · {days} days'

OPERATORS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def formula_tree(formula):
    try:
        node = ast.parse(formula.strip(), mode='eval').body
    except SyntaxError as exc:
        raise ValueError('Enter an arithmetic formula using KPI or variable names.') from exc
    for part in ast.walk(node):
        if isinstance(part, (ast.Name, ast.Load, ast.BinOp, ast.UnaryOp, ast.UAdd, ast.USub, *OPERATORS)):
            continue
        if isinstance(part, ast.Constant) and type(part.value) in (int, float) and abs(part.value) <= 1e15:
            continue
        raise ValueError('Formulas support numbers, names, parentheses, and +, −, ×, ÷.')
    return node


def evaluate(node, lookup):
    if isinstance(node, ast.Name):
        return lookup(node.id)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp):
        value = evaluate(node.operand, lookup)
        return None if value is None else -value if isinstance(node.op, ast.USub) else value
    left, right = evaluate(node.left, lookup), evaluate(node.right, lookup)
    if left is None or right is None:
        return None
    try:
        result = OPERATORS[type(node.op)](left, right)
        return result if math.isfinite(result) else None
    except ArithmeticError:
        return None


def definitions(config):
    saved = config.get('definitions', {})
    return {
        **{key: {'name': name, 'unit': unit, 'formula': '', 'source': source, **saved.get(key, {})}
           for key, (name, unit, source) in DEFAULTS.items()},
        **{key: item for key, item in saved.items() if key not in DEFAULTS},
    }


def normalize_dashboard(config):
    if not isinstance(config, dict) or not isinstance(config.get('definitions'), dict) or not isinstance(config.get('layout'), list):
        raise ValueError('Supply KPI definitions and a dashboard layout.')
    saved = config['definitions']
    if len(set(saved) | set(DEFAULTS)) > 32:
        raise ValueError('Keep at most 32 KPI definitions.')
    normalized = {}
    dependencies = {}
    known = set(saved) | set(DEFAULTS) | set(VARIABLES)
    for key, item in saved.items():
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,39}', key) or keyword.iskeyword(key) or key in VARIABLES or key in WIDGETS or not isinstance(item, dict):
            raise ValueError('Choose a unique KPI ID using lowercase letters, digits and underscores.')
        name, unit, expression = (item.get(field) for field in ('name', 'unit', 'formula'))
        if not all(isinstance(value, str) for value in (name, unit, expression)) or not 1 <= len(name.strip()) <= 80 or len(unit) > 12 or len(expression) > 240:
            raise ValueError('Provide a KPI name, a unit of up to 12 characters and a formula of up to 240 characters.')
        thresholds = item.get('thresholds')
        if thresholds is not None:
            if not isinstance(thresholds, dict):
                raise ValueError('Choose a threshold direction and two limits.')
            direction, warning, danger = (thresholds.get(field) for field in ('direction', 'warning', 'danger'))
            if (direction not in ('higher', 'lower') or
                any(type(n) not in (int, float) or abs(n) > 1e15 or not math.isfinite(n) for n in (warning, danger)) or
                not (danger < warning if direction == 'higher' else warning < danger)):
                raise ValueError('Red must be beyond amber in the selected direction.')
            thresholds = dict(direction=direction, warning=warning, danger=danger)
        refs = {n.id for n in ast.walk(formula_tree(expression)) if isinstance(n, ast.Name)} if expression.strip() else set()
        if not expression.strip() and key not in DEFAULTS:
            raise ValueError(f'Enter a formula for {name}.')
        if refs - known:
            raise ValueError(f'Unknown KPI or variable: {", ".join(sorted(refs - known))}.')
        dependencies[key] = refs & saved.keys()
        thresholds_enabled = item.get('thresholds_enabled', True)
        if not isinstance(thresholds_enabled, bool):
            raise ValueError('Choose a valid KPI color mode.')
        normalized[key] = dict(name=name.strip(), unit=unit.strip(), formula=expression.strip(), thresholds=thresholds if thresholds_enabled else None, thresholds_enabled=thresholds_enabled)
    visited = set()
    def visit(key, ancestors):
        if key in ancestors:
            raise ValueError(f'Circular KPI formula involving {key}.')
        if key not in visited:
            for dependency in dependencies[key]:
                visit(dependency, ancestors | {key})
            visited.add(key)
    for key in dependencies:
        visit(key, set())
    widgets = config.get('widgets') is True
    layout = normalize_layout(config['layout'], set(saved) | set(DEFAULTS), widgets)
    return dict(definitions=normalized, layout=layout, **({'widgets': True} if widgets else {}))


def normalize_card_metric(metric, available):
    if not isinstance(metric, dict):
        raise ValueError('Supply a label and calculation for the KPI.')
    name, unit, formula = (metric.get(field) for field in ('name', 'unit', 'formula'))
    if (not all(isinstance(value, str) for value in (name, unit, formula))
            or not 1 <= len(name.strip()) <= 80 or len(unit) > 12 or not 1 <= len(formula.strip()) <= 240):
        raise ValueError('Enter a label, a calculation, and an optional unit up to 12 characters.')
    refs = {node.id for node in ast.walk(formula_tree(formula)) if isinstance(node, ast.Name)}
    unknown = refs - (set(available) | set(VARIABLES))
    if unknown:
        raise ValueError(f'Unknown KPI or variable: {", ".join(sorted(unknown))}.')
    return dict(name=name.strip(), unit=unit.strip(), formula=formula.strip())


def normalize_layout(cards, available, widgets=False):
    available = set(available)
    widget_ids = set(WIDGETS) if widgets else set()
    if not isinstance(cards, list) or len(cards) > len(available | widget_ids) + (12 if widgets else 0):
        raise ValueError('Choose a valid dashboard layout.')
    layout = []
    seen = set()
    used_kpis = set()
    for card in cards:
        if not isinstance(card, dict) or not isinstance(card.get('id'), str):
            raise ValueError('Choose a valid widget.')
        key, width = card['id'], card.get('width')
        group = card.get('kpis')
        metrics = card.get('metrics')
        widget = WIDGETS.get(key) if widgets else None
        if group is not None or metrics is not None:
            group = [] if group is None else group
            metrics = [] if metrics is None else metrics
            if (not widgets or not re.fullmatch(r'kpi_group_[0-9a-f-]{36}', key)
                    or not isinstance(group, list) or len(group) > len(available)
                    or not isinstance(metrics, list) or len(metrics) > 12
                    or any(not isinstance(item, str) or item not in available for item in group)
                    or len(group) != len(set(group)) or used_kpis.intersection(group)):
                raise ValueError('Choose existing KPIs once each for the KPI card.')
            used_kpis.update(group)
            widget = dict(min_width=2, min_height=2)
        elif key in available and key not in used_kpis:
            used_kpis.add(key)
        elif key not in widget_ids:
            raise ValueError('Choose existing widgets and KPIs once each.')
        min_width, min_height = (widget['min_width'], widget['min_height']) if widget else (1, 1)
        max_width, max_height = (8, 4) if widget else (4, 2)
        width_step = widget.get('width_step', 1) if widget else 1
        if (key in seen or type(width) not in (int, float)
                or not min_width <= width <= max_width or width % width_step != 0):
            raise ValueError('Choose each available widget once and a supported width.')
        height = card.get('height', 1)
        if type(height) is not int or not min_height <= height <= max_height:
            raise ValueError('Choose a supported height for each widget.')
        seen.add(key)
        entry = dict(id=key, width=width, **({'height': height} if height != 1 else {}))
        if group is not None:
            entry['kpis'] = group
            if metrics or 'metrics' in card:
                entry['metrics'] = [normalize_card_metric(metric, available) for metric in metrics]
        layout.append(entry)
    return layout


def dashboard_kpis(config, stats, calls, berths, now, dt, personal_layout=(), preview_formulas=()):
    variables = dict(
        active_calls=stats['active'], upcoming_arrivals=stats['upcoming'],
        berth_occupancy_pct=stats['utilization'] if berths else None,
        waiting_hours=stats['waiting'], turnaround_hours=stats['turnaround'],
        adherence_pct=stats['adherence'], delay_hours=stats['delay_hours'],
        planning_conflicts=len(stats['conflicts']), open_alerts=stats['open_alerts'],
        configured_berths=len(berths),
    )
    completed = [(call, dt(call['actual_end'])) for call in calls if call['status'] == 'Completed' and call.get('actual_end')]
    for days in (7, 30, 90):
        recent = [call for call, end in completed if now - timedelta(days=days) <= end <= now]
        for direction in ('all', 'import', 'export'):
            group = [call for call in recent if direction == 'all' or call.get('direction', '').lower() == direction]
            suffix = f'{direction}_{days}d'
            variables[f'completed_{suffix}'] = len(group)
            variables[f'cargo_tonnes_{suffix}'] = sum(float(call.get('quantity') or 0) for call in group)
            for metric, field in (('waiting_hours', 'actual_start'), ('turnaround_hours', 'actual_departure')):
                hours = [max(0, (dt(call[field]) - dt(call['actual_arrival'])).total_seconds()/3600)
                         for call in group if call.get(field) and call.get('actual_arrival')]
                variables[f'{metric}_{suffix}'] = sum(hours)/len(hours) if hours else None
    catalog = definitions(config)
    values = {}
    def resolve(key):
        if key in variables:
            return variables[key]
        if key not in catalog:
            return None
        if key not in values:
            expression = catalog[key]['formula']
            values[key] = evaluate(formula_tree(expression), resolve) if expression else variables[DEFAULTS[key][2]]
        return values[key]
    for key in catalog:
        resolve(key)
    layout = config.get('layout', [dict(id=key, width=1) for key in DEFAULTS])
    formulas = set(preview_formulas)
    for card in [*layout, *personal_layout]:
        formulas.update(metric['formula'] for metric in card.get('metrics', []))
    return dict(definitions=catalog, values=values, variables=VARIABLES, widget_catalog=WIDGETS,
                widgets=config.get('widgets', False), layout=layout,
                card_values={formula: evaluate(formula_tree(formula), resolve) for formula in formulas})
