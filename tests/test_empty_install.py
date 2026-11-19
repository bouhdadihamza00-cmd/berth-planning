import json
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS
from scripts.create_workspace import create_workspace


class EmptyInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = store.DB_PATH
        store.DB_PATH = str(Path(self.tmp.name) / 'clean.sqlite')
        _LOGIN_ATTEMPTS.clear()

    def tearDown(self):
        store.DB_PATH = self.old
        self.tmp.cleanup()

    def test_startup_is_empty_and_restart_preserves_user_data(self):
        with TestClient(app):
            with store.connect() as c:
                for table in ['organizations', 'ports', 'users', 'memberships', 'records', 'sessions']:
                    self.assertEqual(c.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0, table)
        port = create_workspace('owner@example.org', 'unique-test-password', 'My organization', 'My port')
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/auth/login', json={'email':'admin@portside.demo', 'password':'Portside2026!'}).status_code, 401)
            self.assertEqual(client.post('/api/auth/login', json={'email':'owner@example.org', 'password':'unique-test-password'}).status_code, 200)
            snapshot = client.get(f'/api/ports/{port}/snapshot').json()
            for key in ['berths', 'equipment', 'calls', 'alerts', 'delays', 'drafts', 'versions']:
                self.assertEqual(snapshot[key], [], key)
            self.assertEqual(snapshot['port']['cargo_catalog'], [])
            self.assertFalse(snapshot['port']['integration']['enabled'])
            with store.connect() as c:
                store.put(c, port, 'zones', {'name':'My zone'}, 'my-zone')
        store.initialize()
        with store.connect() as c:
            self.assertEqual(store.records(c, port, 'zones')[0]['name'], 'My zone')
        with self.assertRaisesRegex(ValueError, 'already has users'):
            create_workspace('other@example.org', 'another-test-password', 'Other', 'Other')

    def test_port_details_edit_preserves_configuration_and_records(self):
        port = create_workspace('owner@example.org', 'unique-test-password', 'Org', 'Original')
        with TestClient(app) as client:
            client.post('/api/auth/login', json={'email':'owner@example.org', 'password':'unique-test-password'})
            with store.connect() as c:
                store.put(c, port, 'zones', {'name':'Keep zone'}, 'keep-zone')
            before = client.get(f'/api/ports/{port}/snapshot').json()
            payload = dict(revision=before['port']['revision'], name='Renamed port', code='NEW', timezone='UTC', center=[-9, 32])
            response = client.put(f'/api/ports/{port}', json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            after = client.get(f'/api/ports/{port}/snapshot').json()
            for key, value in payload.items():
                if key != 'revision': self.assertEqual(after['port'][key], value)
            for key, value in before['port']['rules'].items():
                self.assertEqual(after['port']['rules'][key], value)
            for key in ['integration', 'boundary', 'departments', 'cargo_catalog']:
                self.assertEqual(after['port'][key], before['port'][key])
            self.assertEqual(after['zones'], before['zones'])
            self.assertNotEqual(client.put(f'/api/ports/{port}', json=payload).status_code, 200)
            payload['revision'] = after['port']['revision']
            payload['name'] = '   '
            self.assertEqual(client.put(f'/api/ports/{port}', json=payload).status_code, 422)

    def test_https_proxy_login_uses_secure_cookie_and_checks_origin(self):
        from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
        create_workspace('owner@example.org', 'unique-test-password', 'Org', 'Port')
        proxy = ProxyHeadersMiddleware(app, trusted_hosts='*')
        with TestClient(proxy, base_url='http://trial.example.test') as client:
            headers = {'x-forwarded-proto':'https', 'origin':'https://trial.example.test'}
            response = client.post('/api/auth/login', headers=headers, json={'email':'owner@example.org', 'password':'unique-test-password'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn('Secure', response.headers['set-cookie'])
            self.assertIn('HttpOnly', response.headers['set-cookie'])
            headers['origin'] = 'https://other.example.test'
            self.assertEqual(client.post('/api/auth/logout', headers=headers).status_code, 403)

    def test_cloud_bootstrap_creates_only_once_and_preserves_records(self):
        from unittest.mock import patch
        from scripts.start_trial import initialize_trial
        settings = dict(PORTOPS_DB=store.DB_PATH, PORTSIDE_SETUP_EMAIL='trial@example.org',
                        PORTSIDE_SETUP_PASSWORD='test-trial-password')
        with patch.dict('os.environ', settings):
            self.assertTrue(initialize_trial())
            with store.connect() as db:
                port = db.execute('SELECT id FROM ports').fetchone()[0]
                self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0], 0)
                store.put(db, port, 'zones', {'name':'Keep client setup'}, 'keep')
            with patch.dict('os.environ', {'PORTSIDE_SETUP_PASSWORD':''}):
                self.assertFalse(initialize_trial())
            with store.connect() as db:
                self.assertEqual(store.records(db, port, 'zones')[0]['name'], 'Keep client setup')
                self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 1)

    def test_cloud_bootstrap_requires_first_login_credentials(self):
        from unittest.mock import patch
        from scripts.start_trial import initialize_trial
        with patch.dict('os.environ', {'PORTOPS_DB':store.DB_PATH, 'PORTSIDE_SETUP_EMAIL':'', 'PORTSIDE_SETUP_PASSWORD':''}):
            with self.assertRaisesRegex(ValueError, 'first startup'):
                initialize_trial()
            with store.connect() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 0)

    def test_setup_validates_before_creating_accounts(self):
        for args in [('invalid', 'long-enough-password', 'Org', 'Port'), ('a@b.org', 'short', 'Org', 'Port'), ('a@b.org', 'long-enough-password', '', 'Port')]:
            with self.assertRaises(ValueError):
                create_workspace(*args)

    def test_private_preview_cannot_be_exported_to_public_assets(self):
        from scripts.export_preview import build
        with self.assertRaisesRegex(ValueError, 'ignored exports/'):
            build(store.ROOT / 'frontend' / 'private-preview.html')
