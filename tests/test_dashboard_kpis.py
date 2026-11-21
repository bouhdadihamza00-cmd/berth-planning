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
        combined = [group, dict(id='widget_weather', width=2, height=2), dict(id='widget_calls', width=3, height=2)]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=combined, widgets=True)).status_code, 200)
        self.assertEqual(snapshot()['stats']['dashboard_kpis']['personal_layout'], combined)
        duplicate = [*combined, dict(id='active', width=1)]
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=duplicate, widgets=True)).status_code, 422)

        simple = dict(name='Calls in port', unit='calls', formula='active_calls')
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
        configured_card = {**empty_card, 'metrics': [simple, formula]}
        self.assertEqual(client.put(f'{base}/dashboard/layout', json=dict(layout=[configured_card], widgets=True)).status_code, 200)
        saved = snapshot()['stats']['dashboard_kpis']
        self.assertEqual(saved['personal_layout'], [configured_card])
        self.assertEqual(saved['card_values'], {'active_calls': summary['active'], formula['formula']: preview.json()['value']})
