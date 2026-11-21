"""One unfinished workflow per vessel call, with an administrator review override."""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from backend import store
from backend.main import _LOGIN_ATTEMPTS
from backend.planning import dt
from tests.fixtures import demo_client

PORT = 'jph'


class SingleActiveWorkflow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = store.DB_PATH
        store.DB_PATH = str(Path(self.tmp.name) / 'single-workflow.sqlite')
        _LOGIN_ATTEMPTS.clear()
        self.client = demo_client()
        self.client.__enter__()
        self.login('admin')
        source = self.snap()
        template = next(c for c in source['calls'] if c['status'] == 'Scheduled')
        start = max(dt(c['end']) for c in source['calls']) + timedelta(days=4)
        template = dict(template, name='One workflow vessel', quantity=1000,
                        start=start.isoformat(), end=(start + timedelta(hours=24)).isoformat(),
                        eta=(start - timedelta(hours=12)).isoformat(), ready=True,
                        ready_at=(start - timedelta(hours=12)).isoformat())
        for key in ['id', 'revision', 'duration_hours']:
            template.pop(key, None)
        self.call = self.ok(self.client.post(self.url('/calls'), json=template))

    def tearDown(self):
        self.client.__exit__(None, None, None)
        store.DB_PATH = self.old
        self.tmp.cleanup()

    def url(self, path=''):
        return f'/api/ports/{PORT}{path}'

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def login(self, role):
        self.ok(self.client.post('/api/auth/login', json={
            'email': role + '@portside.demo', 'password': 'Portside2026!'}))

    def snap(self):
        return self.ok(self.client.get(self.url('/snapshot')))

    def draft(self):
        call = next(c for c in self.snap()['calls'] if c['id'] == self.call['id'])
        changes = {'start': (dt(call['start']) + timedelta(hours=1)).isoformat(),
                   'end': (dt(call['end']) + timedelta(hours=1)).isoformat()}
        return self.ok(self.client.post(self.url('/planning/drafts'), json={
            'call_id': call['id'], 'base_revision': call['revision'],
            'reason': 'Test one active workflow per call', 'changes': changes}))

    def action(self, draft, action):
        return self.client.post(self.url(f'/planning/drafts/{draft["id"]}/{action}'),
                                json={'revision': draft['revision'], 'comment': 'Reviewed'})

    def test_second_draft_is_blocked_until_first_workflow_is_rejected(self):
        first = self.draft()
        duplicate = self.client.post(self.url('/planning/drafts'), json={
            'call_id': self.call['id'], 'base_revision': self.call['revision'],
            'reason': 'Attempt a second concurrent workflow', 'changes': {}})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertIn('active workflow', duplicate.text)
        submitted = self.ok(self.action(first, 'submit'))
        self.assertEqual(submitted['status'], 'Submitted')
        duplicate = self.client.post(self.url('/planning/drafts'), json={
            'call_id': self.call['id'], 'base_revision': self.call['revision'],
            'reason': 'Attempt a second concurrent workflow', 'changes': {}})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        rejected = self.ok(self.action(submitted, 'reject'))
        self.assertEqual(rejected['status'], 'Rejected')
        self.draft()

    def test_deleting_a_draft_releases_the_call(self):
        first = self.draft()
        duplicate = self.client.post(self.url('/planning/drafts'), json={
            'call_id': self.call['id'], 'base_revision': self.call['revision'],
            'reason': 'Attempt a second concurrent workflow', 'changes': {}})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.ok(self.client.delete(self.url(f'/planning/drafts/{first["id"]}?revision={first["revision"]}')))
        self.draft()

    def test_approval_releases_the_call_and_is_recorded_as_admin_override(self):
        first = self.ok(self.action(self.draft(), 'submit'))
        approved = self.ok(self.action(first, 'approve'))
        self.assertEqual(approved['status'], 'Approved')
        self.assertTrue(approved['decisions'][0]['admin_override'])
        self.draft()

    def test_admin_override_completes_explicit_sequential_steps(self):
        reviewers = self.ok(self.client.get(self.url('/configuration/reviewers')))
        admin = next(x['id'] for x in reviewers if x['id'] == 'admin')
        approver = next(x['id'] for x in reviewers if x['id'] == 'approver')
        port = self.snap()['port']
        port['workflow'] = {**port['workflow'], 'segregation': True, 'mode': 'sequential',
                            'approval_mode': 'manual', 'steps': [
                                {'id': 'first', 'name': 'Operations review', 'department': '',
                                 'user_ids': [admin, approver], 'decision': 'any'},
                                {'id': 'last', 'name': 'Final release', 'department': '',
                                 'user_ids': [approver], 'decision': 'any'}]}
        self.ok(self.client.put(self.url(), json=port))
        submitted = self.ok(self.action(self.draft(), 'submit'))
        approved = self.ok(self.action(submitted, 'approve'))
        self.assertEqual(approved['status'], 'Approved')
        self.assertEqual([d['step_id'] for d in approved['decisions']], ['first', 'last'])
        self.assertTrue(all(d['admin_override'] for d in approved['decisions']))


if __name__ == '__main__':
    unittest.main()
