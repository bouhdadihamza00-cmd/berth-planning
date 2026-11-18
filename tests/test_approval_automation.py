from tests.fixtures import demo_client
"""API regressions for policy-driven draft approval and publication."""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS
from backend.planning import dt
PORT_ID = 'jph'


class ApprovalAutomationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = store.DB_PATH
        store.DB_PATH = str(Path(self.tmp.name) / 'approval.sqlite')
        _LOGIN_ATTEMPTS.clear()
        self.client = demo_client()
        self.client.__enter__()
        self.login('admin')
        source = self.snap()
        template = next(c for c in source['calls'] if c['status'] == 'Scheduled')
        start = max(dt(c['end']) for c in source['calls']) + timedelta(days=3)
        template = dict(template, name='Approval regression vessel', quantity=1000,
                        start=start.isoformat(), end=(start + timedelta(hours=24)).isoformat(),
                        eta=(start - timedelta(hours=12)).isoformat(), ready=True,
                        ready_at=(start - timedelta(hours=12)).isoformat())
        for key in ['id', 'revision', 'duration_hours']:
            template.pop(key, None)
        self.call = self.ok(self.client.post(self.url('/calls'), json=template))
        checks = self.ok(self.client.post(self.url('/planning/validate'), json=self.call))
        self.assertEqual(checks['errors'], [], checks)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        store.DB_PATH = self.old
        self.tmp.cleanup()

    def url(self, path=''):
        return f'/api/ports/{PORT_ID}{path}'

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def login(self, role):
        self.ok(self.client.post('/api/auth/login', json={'email': role + '@portside.demo', 'password': 'Portside2026!'}))

    def snap(self):
        return self.ok(self.client.get(self.url('/snapshot')))

    def saved_call(self):
        return next(c for c in self.snap()['calls'] if c['id'] == self.call['id'])

    def policy(self, mode, **overrides):
        p = self.snap()['port']
        p['workflow'] = {**p['workflow'], 'approval_mode': mode, 'auto_max_shift_hours': 2,
                         'auto_max_duration_change_hours': 2, 'auto_allow_berth_change': False, **overrides}
        self.ok(self.client.put(self.url(), json=p))

    def draft(self, **changes):
        call = self.saved_call()
        proposed = {'start': (dt(call['start']) + timedelta(hours=1)).isoformat(),
                    'end': (dt(call['end']) + timedelta(hours=1)).isoformat(), **changes}
        return self.ok(self.client.post(self.url('/planning/drafts'), json={
            'call_id': call['id'], 'base_revision': call['revision'],
            'reason': 'Test a bounded scheduling change', 'changes': proposed}))

    def action(self, draft, action):
        return self.client.post(self.url(f'/planning/drafts/{draft["id"]}/{action}'), json={'revision': draft['revision']})

    def test_manual_route_remains_submitted_and_does_not_mutate_call(self):
        self.policy('manual')
        before = self.saved_call()
        result = self.ok(self.action(self.draft(), 'submit'))
        self.assertEqual(result['status'], 'Submitted')
        self.assertFalse(result['automation']['auto_approve'])
        self.assertEqual(result['decisions'], [])
        self.assertEqual(self.saved_call(), before)

    def test_semi_automatic_approves_then_requires_explicit_publication(self):
        self.policy('semi')
        before = self.saved_call()
        versions = len(self.snap()['versions'])
        result = self.ok(self.action(self.draft(), 'submit'))
        self.assertEqual(result['status'], 'Approved')
        self.assertEqual(result['decisions'][0]['action'], 'auto_approve')
        self.assertEqual(self.saved_call(), before)
        self.assertEqual(len(self.snap()['versions']), versions)
        published = self.ok(self.action(result, 'publish'))
        self.assertEqual(published['status'], 'Published')
        self.assertEqual(self.saved_call()['start'], result['proposed']['start'])
        self.assertEqual(len(self.snap()['versions']), versions + 1)

    def test_automatic_admin_submission_publishes_and_versions_atomically(self):
        self.policy('automatic')
        before = self.saved_call()
        versions = self.snap()['versions']
        result = self.ok(self.action(self.draft(), 'submit'))
        self.assertEqual(result['status'], 'Published')
        saved = self.saved_call()
        self.assertEqual(saved['start'], result['proposed']['start'])
        self.assertEqual(saved['revision'], before['revision'] + 1)
        after = self.snap()['versions']
        self.assertEqual(len(after), len(versions) + 1)
        active = [v for v in after if v['status'] == 'Published']
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]['draft_id'], result['id'])
        self.assertEqual(next(c for c in active[0]['calls'] if c['id'] == saved['id'])['start'], saved['start'])

    def test_submitter_without_publish_permission_stops_at_approved(self):
        self.policy('automatic')
        before = self.saved_call()
        versions = len(self.snap()['versions'])
        self.login('supply')
        draft = self.draft()
        result = self.ok(self.action(draft, 'submit'))
        self.assertEqual(result['status'], 'Approved')
        self.assertIn('A permitted publisher', ' '.join(result['automation']['reasons']))
        self.assertEqual(self.saved_call(), before)
        self.assertEqual(len(self.snap()['versions']), versions)
        self.assertEqual(self.action(result, 'publish').status_code, 403)

    def test_threshold_cargo_changes_and_warnings_fall_back_to_review(self):
        self.policy('automatic')
        before = self.saved_call()
        changes = [
            {'start': (dt(before['start']) + timedelta(hours=3)).isoformat(), 'end': (dt(before['end']) + timedelta(hours=3)).isoformat()},
            {'quantity': before['quantity'] + 1},
        ]
        for change in changes:
            with self.subTest(change=change):
                result = self.ok(self.action(self.draft(**change), 'submit'))
                self.assertEqual(result['status'], 'Submitted')
                self.assertFalse(result['automation']['auto_approve'])
        self.ok(self.client.post(self.url(f'/calls/{before["id"]}/actuals'), json={'revision': before['revision'], 'status': 'Delayed'}))
        result = self.ok(self.action(self.draft(), 'submit'))
        self.assertTrue(result['validation']['warnings'])
        self.assertEqual(result['status'], 'Submitted')
        self.assertEqual(self.saved_call()['start'], before['start'])

    def test_physical_conflicts_block_even_automatic_submission(self):
        self.policy('automatic')
        before = self.saved_call()
        duplicate = dict(before, name='Conflicting vessel')
        for key in ['id', 'revision', 'duration_hours']:
            duplicate.pop(key, None)
        self.ok(self.client.post(self.url('/calls'), json=duplicate))
        draft = self.draft()
        self.assertTrue(draft['validation']['errors'])
        response = self.action(draft, 'submit')
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.saved_call(), before)
        saved_draft = next(d for d in self.snap()['drafts'] if d['id'] == draft['id'])
        self.assertEqual(saved_draft['status'], 'Draft')

    def test_tightened_current_policy_blocks_previously_captured_automation(self):
        self.policy('automatic')
        draft = self.draft()
        self.policy('manual')
        result = self.ok(self.action(draft, 'submit'))
        self.assertEqual(result['status'], 'Submitted')
        self.assertTrue(result['automation']['auto_approve'])
        self.assertFalse(result['automation']['current_policy']['auto_approve'])
        self.assertEqual(self.saved_call()['start'], draft['before']['start'])

    def test_stale_call_cannot_be_published_after_automatic_approval(self):
        self.policy('semi')
        approved = self.ok(self.action(self.draft(), 'submit'))
        before = self.saved_call()
        versions = len(self.snap()['versions'])
        changed = self.ok(self.client.post(self.url(f'/calls/{before["id"]}/readiness'), json={
            'revision': before['revision'], 'ready': True, 'ready_at': before['ready_at']}))
        response = self.action(approved, 'publish')
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('record changed', response.text)
        self.assertEqual(self.saved_call(), changed)
        self.assertEqual(len(self.snap()['versions']), versions)


if __name__ == '__main__':
    unittest.main()
