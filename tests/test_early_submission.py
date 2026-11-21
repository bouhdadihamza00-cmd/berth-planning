import tempfile
import unittest
from pathlib import Path

from backend import store
from tests.fixtures import demo_client


class EarlySubmissionTest(unittest.TestCase):
    def test_submit_aligns_stale_eta_before_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = store.DB_PATH
            store.DB_PATH = str(Path(directory) / 'test.db')
            try:
                with demo_client() as client:
                    response = client.post('/api/auth/login', json=dict(
                        email='admin@portside.demo', password='Portside2026!'))
                    self.assertEqual(response.status_code, 200, response.text)
                    snapshot = client.get('/api/ports/jph/snapshot').json()
                    call = next(c for c in snapshot['calls'] if c['id'] == 'call-7')
                    response = client.post('/api/ports/jph/planning/drafts', json=dict(
                        call_id=call['id'], base_revision=call['revision'],
                        reason='Move the vessel to a later review window',
                        changes=dict(start='2026-12-15T10:00:00Z', end='2026-12-16T10:00:00Z',
                                     eta='2026-12-16T00:00:00Z', ready_at=call['ready_at'])))
                    self.assertEqual(response.status_code, 200, response.text)
                    draft = response.json()
                    self.assertEqual(draft['validation']['errors'], [], draft['validation'])
                    self.assertLessEqual(draft['proposed']['eta'], draft['proposed']['start'])
                    response = client.post(
                        f"/api/ports/jph/planning/drafts/{draft['id']}/submit",
                        json=dict(revision=draft['revision'], comment='Reviewed'))
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['status'], 'Submitted')
            finally:
                store.DB_PATH = previous


if __name__ == '__main__':
    unittest.main()
