import tempfile
import unittest
from pathlib import Path

from backend import store
from tests.fixtures import demo_client


class DashboardKpisTest(unittest.TestCase):
    def test_catalog_formulas_threshold_validation_and_personal_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = store.DB_PATH
            store.DB_PATH = str(Path(directory) / 'test.db')
            try:
                with demo_client() as client:
                    self.check_dashboard(client)
            finally:
                store.DB_PATH = previous

    def test_custom_variables(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = store.DB_PATH
            store.DB_PATH = str(Path(directory) / 'test.db')
            try:
                with demo_client() as client:
                    self.check_custom_variables(client)
            finally:
                store.DB_PATH = previous

    def test_variable_formulas(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = store.DB_PATH
            store.DB_PATH = str(Path(directory) / 'test.db')
            try:
                with demo_client() as client:
                    self.check_variable_formulas(client)
            finally:
                store.DB_PATH = previous

    def check_variable_formulas(self, client):
        base = '/api/ports/jph'
        self.assertEqual(client.post('/api/auth/login', json=dict(
            email='admin@portside.demo', password='Portside2026!')).status_code, 200)

        def snapshot():
            response = client.get(f'{base}/snapshot')
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        def save(custom):
            body = snapshot()
            current = body['stats']['dashboard_kpis']
            response = client.put(f'{base}/dashboard', json=dict(
                revision=body['port']['revision'], definitions=current['definitions'],
                layout=current['layout'], widgets=current['widgets'], custom_variables=custom))
            self.assertEqual(response.status_code, 200, response.text)
            return snapshot()['stats']['dashboard_kpis']

        custom = {
            'berth_load': dict(name='Berth load', description='Calls per berth.',
                               type='Percent', unit='%', formula='active_calls / configured_berths'),
            'projected': dict(name='Projected calls', description='Traffic plus load.',
                              type='Count', unit='calls', formula='active_calls + berth_load'),
        }
        kpis = save(custom)
        self.assertAlmostEqual(kpis['variable_values']['berth_load'],
                               kpis['variable_values']['active_calls'] / kpis['variable_values']['configured_berths'])
        self.assertAlmostEqual(kpis['variable_values']['projected'],
                               kpis['variable_values']['active_calls'] + kpis['variable_values']['berth_load'])
        self.assertEqual(kpis['custom_variables']['berth_load']['formula'], 'active_calls / configured_berths')

        body = snapshot()
        current = body['stats']['dashboard_kpis']
        for invalid in (
            {'x': {**custom['berth_load'], 'value': 1}},
            {'x': {**custom['berth_load'], 'formula': 'unknown_tag'}},
            {'x': {**custom['berth_load'], 'formula': 'x'}},
            {'x': {**custom['berth_load'], 'formula': ''}},
        ):
            response = client.put(f'{base}/dashboard', json=dict(
                revision=body['port']['revision'], definitions=current['definitions'],
                layout=current['layout'], widgets=current['widgets'], custom_variables=invalid))
            self.assertEqual(response.status_code, 422, response.text)

    def check_custom_variables(self, client):
        base = '/api/ports/jph'
        self.assertEqual(client.post('/api/auth/login', json=dict(
            email='admin@portside.demo', password='Portside2026!')).status_code, 200)

        def catalog():
            response = client.get(f'{base}/snapshot')
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            return body['port']['revision'], body['stats']['dashboard_kpis']

        def save(**changes):
            revision, current = catalog()
            payload = dict(revision=revision, definitions=current['definitions'],
                           layout=current['layout'], widgets=current['widgets'])
            payload.update(changes)
            response = client.put(f'{base}/dashboard', json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            return catalog()[1]

        custom = {'target_berths': dict(name='Berth target', description='Target berths for the shift.',
                                        type='Count', unit='berths', value=7)}
        edited = {'active_calls': 'Vessels currently in port.'}
        kpis = save(custom_variables=custom, variable_descriptions=edited)
        self.assertEqual(kpis['variable_values']['target_berths'], 7)
        self.assertEqual(kpis['variable_names']['target_berths'], 'Berth target')
        self.assertEqual(kpis['variable_types']['target_berths'], 'Count')
        self.assertEqual(kpis['variable_units']['target_berths'], 'berths')
        self.assertEqual(kpis['variables']['active_calls'], edited['active_calls'])
        self.assertIn('active_calls', kpis['builtin_variables'])
        self.assertNotIn('target_berths', kpis['builtin_variables'])

        definition = dict(name='Target', unit='berths', formula='target_berths',
                          thresholds=None, thresholds_enabled=True)
        kpis = save(definitions={**kpis['definitions'], 'target': definition},
                    custom_variables=custom, variable_descriptions=edited)
        self.assertEqual(kpis['values']['target'], 7)

        group = dict(id='kpi_group_9409dabc-1c78-48db-9127-9ad32082502f', width=3, height=2, kpis=[],
                     metrics=[dict(name='Targets', unit='berths', formula='target_berths', icon='ship')])
        response = client.put(f'{base}/dashboard/layout', json=dict(layout=[group], widgets=True))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(catalog()[1]['card_values'], {'target_berths': 7})

        revision, current = catalog()
        for invalid in ({'active_calls': custom['target_berths']},
                        {'bad_var': {**custom['target_berths'], 'value': 'many'}},
                        {'bad_desc': {**custom['target_berths'], 'type': 'Magic'}}):
            response = client.put(f'{base}/dashboard', json=dict(
                revision=revision, definitions=current['definitions'], layout=current['layout'],
                widgets=current['widgets'], custom_variables=invalid))
            self.assertEqual(response.status_code, 422, response.text)
        response = client.put(f'{base}/dashboard', json=dict(
            revision=revision, definitions=current['definitions'], layout=current['layout'],
            widgets=current['widgets'], variable_descriptions={'target_berths': 'Not a platform variable.'}))
        self.assertEqual(response.status_code, 422, response.text)

        remaining = {key: value for key, value in kpis['definitions'].items() if key != 'target'}
        kpis = save(definitions=remaining, custom_variables={}, variable_descriptions={})
        self.assertNotIn('target_berths', kpis['variables'])
        self.assertNotIn('target_berths', kpis['variable_values'])
        self.assertEqual(kpis['variables']['active_calls'], 'Vessels in port or at anchorage')

    def check_dashboard(self, client):
        base = '/api/ports/jph'
        def sign_in(name):
            response = client.post('/api/auth/login', json=dict(
                email=f'{name}@portside.demo', password='Portside2026!'))
            self.assertEqual(response.status_code, 200, response.text)
        def snapshot():
            response = client.get(f'{base}/snapshot')
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        sign_in('admin')
        before = snapshot()
        catalog = before['stats']['dashboard_kpis']
        self.assertEqual(len(catalog['layout']), 8)
        self.assertIn('waiting_hours_export_7d', catalog['variables'])
        self.assertEqual(len(catalog['variables']), len(catalog['variable_names']))
        self.assertEqual(len(catalog['variables']), len(catalog['variable_values']))
        self.assertEqual(len(catalog['variables']), len(catalog['variable_types']))
        self.assertEqual(len(catalog['variables']), len(catalog['variable_units']))
        self.assertEqual(catalog['variable_names']['active_calls'], 'Active calls')
        self.assertEqual(catalog['variable_names']['waiting_hours_export_7d'], 'Waiting time · export · 7d')
        self.assertEqual((catalog['variable_types']['berth_occupancy_pct'], catalog['variable_units']['berth_occupancy_pct']), ('Percent', '%'))
        self.assertEqual((catalog['variable_types']['cargo_tonnes_all_7d'], catalog['variable_units']['cargo_tonnes_all_7d']), ('Quantity', 't'))
        self.assertIsInstance(catalog['variable_values']['configured_berths'], int)
        self.assertIn('active_calls', catalog['variable_values'])
        payload = dict(revision=before['port']['revision'], definitions={
            'traffic': dict(name='Traffic', unit='calls', formula='active + upcoming_arrivals',
                            thresholds=dict(direction='higher', warning=4, danger=2)),
            'ratio': dict(name='Ratio', unit='%', formula='traffic / 0'),
        }, layout=[dict(id='traffic', width=4)])
        result = client.put(f'{base}/dashboard', json=payload)
        self.assertEqual(result.status_code, 200, result.text)
        after = snapshot()
        kpis = after['stats']['dashboard_kpis']
        self.assertEqual(kpis['values']['traffic'], after['stats']['active'] + after['stats']['upcoming'])
        self.assertIsNone(kpis['values']['ratio'])
        self.assertEqual(kpis['layout'], payload['layout'])
        payload['revision'] = after['port']['revision']
        for formula in ('ratio + 1', 'missing + 1', 'active()', '2 ** 99'):
            payload['definitions']['traffic']['formula'] = formula
            result = client.put(f'{base}/dashboard', json=payload)
            self.assertEqual(result.status_code, 422, result.text)

        sign_in('operations')
        self.assertEqual(client.put(f'{base}/dashboard', json=payload).status_code, 403)
        personal = [dict(id='ratio', width=1), dict(id='active', width=3)]
        result = client.put(f'{base}/dashboard/layout', json=dict(layout=personal))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], personal)
        sign_in('admin')
        self.assertNotIn('personal_layout', snapshot()['stats']['dashboard_kpis'])
        sign_in('operations')
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=None)).status_code, 200)
        self.assertNotIn('personal_layout', snapshot()['stats']['dashboard_kpis'])

        widgets = [dict(id='widget_map', width=5.5, height=4), dict(id='traffic', width=2, height=2)]
        result = client.put(f'{base}/dashboard/layout', json=dict(layout=widgets, widgets=True))
        self.assertEqual(result.status_code, 200, result.text)
        saved = snapshot()['stats']['dashboard_kpis']
        self.assertEqual(saved['personal_layout'], widgets)
        self.assertTrue(saved['personal_widgets'])
        self.assertIn('widget_delays', saved['widget_catalog'])
        self.assertEqual(saved['widget_catalog']['widget_map']['min_width'], 1.5)
        invalid = [dict(id='widget_map', width=1, height=1)]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=invalid, widgets=True)).status_code, 422)
        invalid = [dict(id='widget_map', width=5.25, height=4)]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=invalid, widgets=True)).status_code, 422)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], widgets)

        group = dict(id='kpi_group_9409dabc-1c78-48db-9127-9ad32082502f', width=3, height=2, kpis=['active', 'ratio'])
        combined = [group, dict(id='widget_weather', width=5, height=2), dict(id='widget_calls', width=3, height=2)]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=combined, widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], combined)
        duplicate = [*combined, dict(id='active', width=1)]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=duplicate, widgets=True)).status_code, 422)

        simple = dict(name='Calls in port', unit='calls', formula='active_calls', icon='ship')
        formula = dict(name='Total traffic', unit='calls', formula='active + upcoming_arrivals')
        preview = client.post(f'{base}/dashboard/kpi-preview', json=formula)
        self.assertEqual(preview.status_code, 200, preview.text)
        summary = snapshot()['stats']
        self.assertEqual(preview.json()['value'], summary['active'] + summary['upcoming'])
        invalid = dict(name='Bad input', unit='', formula='unknown_name + 1')
        self.assertEqual(client.post(f'{base}/dashboard/kpi-preview', json=invalid).status_code, 422)
        empty_card = dict(id=group['id'], width=2, height=2, kpis=[], metrics=[])
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[empty_card], widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], [empty_card])
        compact = {**empty_card, 'width': 1, 'metrics': [simple]}
        del compact['height']
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[compact], widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], [compact])
        configured_card = {**empty_card, 'metrics': [simple, formula]}
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[configured_card], widgets=True)).status_code, 200)
        saved = snapshot()['stats']['dashboard_kpis']
        self.assertEqual(saved['personal_layout'], [configured_card])
        self.assertEqual(saved['card_values'], {'active_calls': summary['active'], formula['formula']: preview.json()['value']})

        first = dict(id='active', width=1, position=dict(column=3, row=2, tracks=30))
        second = dict(id='upcoming', width=1, position=dict(column=7, row=2, tracks=30))
        map_widget = dict(id='widget_map', width=4, height=3, position=dict(column=9, row=1, tracks=30))
        positioned = [map_widget, first, second]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=positioned, widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], positioned)
        overlap = [map_widget, {**first, 'position': dict(column=9, row=2, tracks=30)}]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=overlap, widgets=True)).status_code, 422)

        weather = dict(id='widget_weather', width=3)
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[weather], widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], [weather])

        invalid_weather = {**weather, 'height': 2}
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[invalid_weather], widgets=True)).status_code, 422)

        clock = dict(id='widget_clock', width=1)
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[clock], widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], [clock])
