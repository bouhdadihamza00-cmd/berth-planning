import tempfile
import unittest
from pathlib import Path

from backend import store
from tests.fixtures import demo_client


class DelayChartTest(unittest.TestCase):
    def test_cause_details(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = store.DB_PATH
            store.DB_PATH = str(Path(directory) / 'test.db')
            try:
                with demo_client() as client:
                    response = client.post('/api/auth/login', json=dict(
                        email='admin@portside.demo', password='Portside2026!'))
                    self.assertEqual(response.status_code, 200, response.text)
                    response = client.get('/api/ports/jph/snapshot')
                    self.assertEqual(response.status_code, 200, response.text)
                    stats = response.json()['stats']
                    details = stats['delay_cause_details']
                    self.assertEqual(set(details), set(stats['delay_causes']))
                    for cause, hours in stats['delay_causes'].items():
                        detail = details[cause]
                        self.assertTrue(detail['department'])
                        self.assertGreaterEqual(detail['count'], 1)
                        self.assertAlmostEqual(detail['hours'], hours)
            finally:
                store.DB_PATH = previous
