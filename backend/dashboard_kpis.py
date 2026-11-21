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
    'widget_map': dict(name='Map', width=5, height=4, min_width=1.5, min_height=3, max_height=8, width_step=0.5),
    'widget_operations': dict(name='Ongoing operations', width=3, height=2, min_width=2, min_height=2),
    'widget_berths': dict(name='Berth status', width=3, height=2, min_width=2, min_height=2),
    'widget_cargo': dict(name='Cargo throughput', width=3, height=2, min_width=2, min_height=2),
    'widget_delays': dict(name='Operational delays', width=3, height=2, min_width=2, min_height=2),
    'widget_alerts': dict(name='Alerts & planning risks', width=2, height=2, min_width=2, min_height=2),
    'widget_calls': dict(name='Vessel calls', width=3, height=2, min_width=2, min_height=2, optional=True),
    'widget_clock': dict(name='Port clock', width=1, height=1, min_width=1, min_height=1, max_width=4, max_height=2, optional=True),  # legacy; merged into widget_weather
    'widget_weather': dict(name='Weather & clock', width=5, height=2, min_width=3, max_width=5, min_height=1, max_height=2, optional=True),
}
CARD_ICONS = ("activity", "anchor", "calendar-clock", "chart-column", "clipboard-check",
              "clock-alert", "container", "gauge", "hourglass", "package", "ship", "timer", "triangle-alert")
CUSTOM_VARIABLE_TYPES = ('Count', 'Percent', 'Duration', 'Quantity')
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

# Short display names; the identifier in VARIABLES is the tag used in formulas.
VARIABLE_NAMES = {
    'active_calls': 'Active calls',
    'upcoming_arrivals': 'Upcoming arrivals',
    'berth_occupancy_pct': 'Berth occupancy',
    'waiting_hours': 'Waiting time',
    'turnaround_hours': 'Turnaround',
    'adherence_pct': 'Schedule adherence',
    'delay_hours': 'Delay hours',
    'planning_conflicts': 'Planning conflicts',
    'open_alerts': 'Open alerts',
    'configured_berths': 'Configured berths',
}
for days in (7, 30, 90):
    for direction in ('all', 'import', 'export'):
        for metric, label in (('completed', 'Completed'), ('cargo_tonnes', 'Cargo tonnes'),
                              ('waiting_hours', 'Waiting time'), ('turnaround_hours', 'Turnaround')):
            VARIABLE_NAMES[f'{metric}_{direction}_{days}d'] = f'{label} · {direction} · {days}d'

# Display type and unit for the platform variables table.
VARIABLE_TYPES = {
    'active_calls': 'Count', 'upcoming_arrivals': 'Count',
    'berth_occupancy_pct': 'Percent', 'waiting_hours': 'Duration',
    'turnaround_hours': 'Duration', 'adherence_pct': 'Percent',
    'delay_hours': 'Duration', 'planning_conflicts': 'Count',
    'open_alerts': 'Count', 'configured_berths': 'Count',
}
VARIABLE_UNITS = {
    'active_calls': 'calls', 'upcoming_arrivals': 'calls',
    'berth_occupancy_pct': '%', 'waiting_hours': 'h',
    'turnaround_hours': 'h', 'adherence_pct': '%',
    'delay_hours': 'h', 'planning_conflicts': 'calls',
    'open_alerts': 'alerts', 'configured_berths': 'berths',
}
for days in (7, 30, 90):
    for direction in ('all', 'import', 'export'):
        suffix = f'{direction}_{days}d'
        for metric in ('completed', 'cargo_tonnes', 'waiting_hours', 'turnaround_hours'):
            key = f'{metric}_{suffix}'
            VARIABLE_TYPES[key] = {'completed': 'Count', 'cargo_tonnes': 'Quantity'}.get(metric, 'Duration')
            VARIABLE_UNITS[key] = {'completed': 'calls', 'cargo_tonnes': 't'}.get(metric, 'h')

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


def normalize_variables(config, definition_keys=()):
    """Validate port-specific variables and description edits on built-ins."""
    custom = config.get('custom_variables', {})
    overrides = config.get('variable_descriptions', {})
    if not isinstance(custom, dict) or not isinstance(overrides, dict):
        raise ValueError('Supply valid platform variables.')
    if len(custom) > 50:
        raise ValueError('Keep at most 50 custom variables.')
    normalized = {}
    for key, item in custom.items():
        if (not re.fullmatch(r'[a-z][a-z0-9_]{0,39}', key) or keyword.iskeyword(key)
                or key in VARIABLES or key in WIDGETS or key in definition_keys):
            raise ValueError('Choose a unique variable ID using lowercase letters, digits and underscores.')
        if not isinstance(item, dict):
            raise ValueError('Supply the variable name, description, type and a value or formula.')
        name, description, kind, unit = (item.get(field) for field in ('name', 'description', 'type', 'unit'))
        if (not all(isinstance(text, str) for text in (name, description, kind, unit))
                or not 1 <= len(name.strip()) <= 80 or not 1 <= len(description.strip()) <= 240
                or kind not in CUSTOM_VARIABLE_TYPES or len(unit) > 12):
            raise ValueError('Provide a name, description, type and unit of up to 12 characters.')
        value, formula = item.get('value'), item.get('formula', '')
        fixed = type(value) in (int, float) and abs(value) <= 1e15 and math.isfinite(value)
        expression = formula.strip() if isinstance(formula, str) else ''
        if fixed == bool(expression):
            raise ValueError('Enter either a fixed numeric value or a formula.')
        entry = dict(name=name.strip(), description=description.strip(), type=kind, unit=unit.strip())
        if expression:
            if len(expression) > 240:
                raise ValueError('Keep formulas under 240 characters.')
            formula_tree(expression)
            entry['formula'] = expression
        else:
            entry['value'] = value
        normalized[key] = entry
    dependencies = {}
    for key, item in normalized.items():
        if 'formula' in item:
            refs = {node.id for node in ast.walk(formula_tree(item['formula'])) if isinstance(node, ast.Name)}
            unknown = refs - set(VARIABLES) - set(normalized)
            if unknown:
                raise ValueError(f'Unknown variable: {", ".join(sorted(unknown))}.')
            dependencies[key] = refs & set(normalized)
    visited = set()
    def visit(key, ancestors):
        if key in ancestors:
            raise ValueError(f'Circular variable formula involving {key}.')
        if key not in visited:
            for dependency in dependencies.get(key, ()):
                visit(dependency, ancestors | {key})
            visited.add(key)
    for key in dependencies:
        visit(key, set())
    descriptions = {}
    for key, text in overrides.items():
        if key not in VARIABLES or not isinstance(text, str) or not 1 <= len(text.strip()) <= 240:
            raise ValueError('Edit descriptions only for platform variables.')
        descriptions[key] = text.strip()
    return normalized, descriptions


def normalize_dashboard(config):
    if not isinstance(config, dict) or not isinstance(config.get('definitions'), dict) or not isinstance(config.get('layout'), list):
        raise ValueError('Supply KPI definitions and a dashboard layout.')
    saved = config['definitions']
    custom, descriptions = normalize_variables(config, set(saved) | set(DEFAULTS))
    if len(set(saved) | set(DEFAULTS)) > 32:
        raise ValueError('Keep at most 32 KPI definitions.')
    normalized = {}
    dependencies = {}
    known = set(saved) | set(DEFAULTS) | set(VARIABLES) | set(custom)
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
    layout = normalize_layout(config['layout'], set(saved) | set(DEFAULTS), widgets, set(custom))
    return dict(definitions=normalized, layout=layout, **({'widgets': True} if widgets else {}),
                **({'custom_variables': custom} if custom else {}),
                **({'variable_descriptions': descriptions} if descriptions else {}))


def normalize_card_metric(metric, available, variables=()):
    if not isinstance(metric, dict):
        raise ValueError('Supply a label and calculation for the KPI.')
    name, unit, formula = (metric.get(field) for field in ('name', 'unit', 'formula'))
    if (not all(isinstance(value, str) for value in (name, unit, formula))
            or not 1 <= len(name.strip()) <= 80 or len(unit) > 12 or not 1 <= len(formula.strip()) <= 240):
        raise ValueError('Enter a label, a calculation, and an optional unit up to 12 characters.')
    refs = {node.id for node in ast.walk(formula_tree(formula)) if isinstance(node, ast.Name)}
    unknown = refs - (set(available) | set(VARIABLES) | set(variables))
    if unknown:
        raise ValueError(f'Unknown KPI or variable: {", ".join(sorted(unknown))}.')
    icon = metric.get('icon', '')
    if icon != '' and icon not in CARD_ICONS:
        raise ValueError('Choose an available KPI icon.')
    return dict(name=name.strip(), unit=unit.strip(), formula=formula.strip(), **({'icon': icon} if icon else {}))


def normalize_layout(cards, available, widgets=False, variables=()):
    available = set(available)
    widget_ids = set(WIDGETS) if widgets else set()
    if not isinstance(cards, list) or len(cards) > len(available | widget_ids) + (12 if widgets else 0):
        raise ValueError('Choose a valid dashboard layout.')
    layout = []
    seen = set()
    used_kpis = set()
    occupied = set()
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
            minimum = 1 if not group and len(metrics) <= 1 else 2
            widget = dict(min_width=minimum, min_height=minimum) if minimum == 2 else None
        elif key in available and key not in used_kpis:
            used_kpis.add(key)
        elif key not in widget_ids:
            raise ValueError('Choose existing widgets and KPIs once each.')
        min_width, min_height = (widget['min_width'], widget['min_height']) if widget else (1, 1)
        max_width, max_height = (widget.get('max_width', 8), widget.get('max_height', 4)) if widget else (4, 2)
        width_step = widget.get('width_step', 1) if widget else 1
        if (key in seen or type(width) not in (int, float)
                or not min_width <= width <= max_width or width % width_step != 0):
            raise ValueError('Choose each available widget once and a supported width.')
        height = card.get('height', 1)
        if type(height) is not int or not min_height <= height <= max_height:
            raise ValueError('Choose a supported height for each widget.')
        if key == 'widget_weather' and (height, width) not in ((1, 3), (2, 5)):
            raise ValueError('Choose a 1 × 3 or 2 × 5 Weather widget.')
        seen.add(key)
        entry = dict(id=key, width=width, **({'height': height} if height != 1 else {}))
        if group is not None:
            entry['kpis'] = group
            if metrics or 'metrics' in card:
                entry['metrics'] = [normalize_card_metric(metric, available, variables) for metric in metrics]
        position = card.get('position')
        if position is not None:
            if not widgets or not isinstance(position, dict):
                raise ValueError('Choose a valid widget position.')
            column, row, tracks = (position.get(field) for field in ('column', 'row', 'tracks'))
            if (any(type(value) is not int for value in (column, row, tracks))
                    or not 4 <= tracks <= 128 or tracks % 2 or not 1 <= row <= 256
                    or not 1 <= column <= tracks - min(tracks, width * 2) + 1):
                raise ValueError('Choose a widget position inside the dashboard.')
            cells = {(tracks, x, y) for x in range(column, column + int(min(tracks, width * 2)))
                     for y in range(row, row + height)}
            if cells & occupied:
                raise ValueError('Widgets cannot overlap.')
            occupied.update(cells)
            entry['position'] = dict(column=column, row=row, tracks=tracks)
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
    custom = config.get('custom_variables', {})
    overrides = config.get('variable_descriptions', {})
    custom_values = {}
    visiting = set()
    def resolve_custom(key):
        if key in custom_values:
            return custom_values[key]
        item = custom.get(key)
        if item is None or key in visiting:
            return None
        visiting.add(key)
        try:
            if 'formula' in item:
                custom_values[key] = evaluate(formula_tree(item['formula']), lambda name: (
                    resolve_custom(name) if name in custom else variables.get(name)))
            else:
                custom_values[key] = item.get('value')
        finally:
            visiting.discard(key)
        return custom_values[key]
    for key in custom:
        resolve_custom(key)
    variables.update(custom_values)
    descriptions = {**VARIABLES, **{key: item['description'] for key, item in custom.items()}}
    descriptions.update({key: text for key, text in overrides.items() if key in VARIABLES})
    names = {**VARIABLE_NAMES, **{key: item['name'] for key, item in custom.items()}}
    kinds = {**VARIABLE_TYPES, **{key: item['type'] for key, item in custom.items()}}
    units = {**VARIABLE_UNITS, **{key: item['unit'] for key, item in custom.items()}}
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
    return dict(definitions=catalog, values=values, variables=descriptions, variable_names=names,
                variable_types=kinds, variable_units=units, builtin_variables=list(VARIABLES),
                custom_variables=custom, variable_descriptions=overrides,
                variable_values=variables, widget_catalog=WIDGETS, card_icons=CARD_ICONS,
                widgets=config.get('widgets', False), layout=layout,
                card_values={formula: evaluate(formula_tree(formula), resolve) for formula in formulas})
