from tests.fixtures import demo_client
import json
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS


class RemovalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = store.DB_PATH
        store.DB_PATH = str(Path(self.tmp.name) / 'db.sqlite')
        _LOGIN_ATTEMPTS.clear()
        self.client = demo_client()
        self.client.__enter__()
        self.client.post('/api/auth/login', json={'email': 'admin@portside.demo', 'password': 'Portside2026!'})
        self.port = self.client.get('/api/ports').json()[0]['id']
        self.base = f'/api/ports/{self.port}'
        self.me = self.client.get('/api/auth/me').json()['id']

    def tearDown(self):
        self.client.__exit__(None, None, None)
        store.DB_PATH = self.old
        self.tmp.cleanup()

    def add(self, kind, **data):
        with store.connect() as c:
            return store.put(c, self.port, kind, data)

    def remove(self, kind, item, revision=None):
        return self.client.delete(f'{self.base}/{kind}/{item["id"]}?revision={revision or item["revision"]}')

    def test_membership_removal_preserves_account_and_history(self):
        target = self.client.get(self.base + '/users').json()[-1]
        if target['id'] == self.me:
            target = self.client.get(self.base + '/users').json()[0]
        self.assertNotEqual(target['id'], self.me)
        self.assertEqual(self.client.delete(self.base + f'/users/{target["id"]}/membership').status_code, 200)
        self.assertNotIn(target['id'], [u['id'] for u in self.client.get(self.base + '/users').json()])
        with store.connect() as c:
            self.assertIsNotNone(c.execute('SELECT 1 FROM users WHERE id=?', (target['id'],)).fetchone())
            self.assertIsNotNone(c.execute("SELECT 1 FROM audit WHERE action='user.membership.removed' AND entity_id=?", (target['id'],)).fetchone())
        self.assertEqual(self.client.delete(self.base + f'/users/{self.me}/membership').status_code, 409)

    def test_membership_removal_requires_permission(self):
        self.client.post('/api/auth/login', json={'email': 'viewer@portside.demo', 'password': 'Portside2026!'})
        self.assertEqual(self.client.delete(self.base + f'/users/{self.me}/membership').status_code, 403)

    def test_record_revision_dependencies_and_audit(self):
        berth = self.add('berths', name='Unused berth', code='TEST')
        self.assertEqual(self.remove('berths', berth, 99).status_code, 409)
        call = self.add('calls', name='Linked', berth_id=berth['id'], status='Completed')
        self.assertEqual(self.remove('berths', berth).status_code, 409)
        draft = self.add('drafts', proposed={'id': call['id']})
        self.assertEqual(self.remove('calls', call).status_code, 409)
        with store.connect() as c:
            c.execute('DELETE FROM records WHERE id=?', (draft['id'],))
        self.assertEqual(self.remove('calls', call).status_code, 200)
        self.assertEqual(self.remove('berths', berth).status_code, 200)
        with store.connect() as c:
            self.assertIsNotNone(c.execute("SELECT 1 FROM audit WHERE action='berths.deleted' AND entity_id=?", (berth['id'],)).fetchone())

    def test_notification_removal_is_personal(self):
        n = self.add('notifications', title='Test', description='Test', read_by=[])
        url = self.base + f'/notifications/{n["id"]}/inbox'
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertNotIn(n['id'], [x['id'] for x in self.client.get(self.base + '/snapshot').json()['notifications']])
        with store.connect() as c:
            self.assertEqual(store.record(c, self.port, 'notifications', n['id'])['hidden_by'], [self.me])
        self.client.post('/api/auth/login', json={'email': 'viewer@portside.demo', 'password': 'Portside2026!'})
        self.assertIn(n['id'], [x['id'] for x in self.client.get(self.base + '/snapshot').json()['notifications']])

    def test_processed_import_is_retained(self):
        b = self.add('imports', filename='history.xlsx', status='Partially applied')
        self.assertEqual(self.remove('imports', b).status_code, 409)
        pending = self.add('imports', filename='unused.xlsx', status='Ready for review')
        self.assertEqual(self.remove('imports', pending).status_code, 200)

    def test_port_removal_is_revision_checked_and_empty_only(self):
        created = self.client.post('/api/ports', json={'name': 'Temporary test port'}).json()
        url = f'/api/ports/{created["id"]}'
        self.assertEqual(self.client.delete(url + '?revision=999').status_code, 409)
        self.assertEqual(self.client.delete(url + '?revision=1').status_code, 200)
        current = self.client.get('/api/ports').json()[0]
        self.assertEqual(self.client.delete(f'/api/ports/{current["id"]}?revision={current["revision"]}').status_code, 409)

    def test_removal_rejects_unprivileged_records_and_missing_members(self):
        self.assertEqual(self.client.delete(self.base + '/users/missing/membership').status_code, 404)
        item = self.add('alerts', title='Admin only')
        self.client.post('/api/auth/login', json={'email': 'viewer@portside.demo', 'password': 'Portside2026!'})
        self.assertEqual(self.remove('alerts', item).status_code, 403)

    def test_berth_rule_links_block_removal(self):
        berth = self.add('berths', name='Rule berth')
        with store.connect() as c:
            row = c.execute('SELECT data FROM ports WHERE id=?', (self.port,)).fetchone()
            p = json.loads(row['data'])
            p.setdefault('rules', {})['custom_rules'] = [{'berth_ids': [berth['id']]}]
            c.execute('UPDATE ports SET data=? WHERE id=?', (json.dumps(p), self.port))
        self.assertEqual(self.remove('berths', berth).status_code, 409)

    def test_membership_reviewer_and_last_manager_are_protected(self):
        target = next(u for u in self.client.get(self.base + '/users').json() if u['id'] != self.me and not u['superadmin'])
        with store.connect() as c:
            row = c.execute('SELECT data FROM ports WHERE id=?', (self.port,)).fetchone()
            p = json.loads(row['data'])
            p['workflow'] = {'steps': [{'user_ids': [target['id']]}]}
            c.execute('UPDATE ports SET data=? WHERE id=?', (json.dumps(p), self.port))
        url = self.base + f'/users/{target["id"]}/membership'
        self.assertEqual(self.client.delete(url).status_code, 409)
        with store.connect() as c:
            p['workflow'] = {}
            c.execute('UPDATE ports SET data=? WHERE id=?', (json.dumps(p), self.port))
            c.execute('UPDATE memberships SET permissions=? WHERE port_id=?', ('[]', self.port))
        self.assertEqual(self.client.delete(url).status_code, 409)
