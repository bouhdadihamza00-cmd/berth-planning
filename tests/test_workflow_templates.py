import copy
import unittest


class WorkflowTemplatesTests(unittest.TestCase):
    def setUp(self):
        from tests.test_removal import RemovalTests
        self.helper = RemovalTests()
        self.helper.setUp()
        self.client = self.helper.client
        self.root = self.helper.base

    def tearDown(self):
        self.helper.tearDown()

    def port(self):
        return self.client.get(self.root + '/snapshot').json()['port']

    def template(self, id, name):
        return {'id': id, 'name': name, 'mode': 'sequential', 'segregation': False, 'steps': [
            {'id': 'review', 'name': 'Review', 'department': 'Operations', 'user_ids': [], 'decision': 'any'}]}

    def save(self, templates, active='default', port=None):
        p = port or self.port()
        return self.client.put(self.root, json={**p, 'workflow_templates': templates, 'workflow': {**p['workflow'], 'template_id': active}})

    def test_create_activate_remove_and_preserve_captured_proposals(self):
        templates = [self.template('default', 'Schedule approval'), self.template('route-two', 'Two-stage review')]
        templates[1]['steps'].append({**templates[1]['steps'][0], 'id': 'final', 'name': 'Final release', 'decision': 'all'})
        response = self.save(templates)
        self.assertEqual(response.status_code, 200, response.text)
        snapshot = self.client.get(self.root + '/snapshot').json()
        call = snapshot['calls'][0]
        response = self.client.post(self.root + '/planning/drafts', json={'call_id': call['id'], 'base_revision': call['revision'], 'reason': 'Capture original review route', 'changes': {}})
        self.assertEqual(response.status_code, 200, response.text)
        draft = response.json()
        captured = copy.deepcopy(draft['workflow'])
        self.assertEqual(self.save(templates, 'route-two').status_code, 200)
        p = self.port()
        self.assertEqual(p['workflow']['template_id'], 'route-two')
        self.assertEqual(len(p['workflow']['steps']), 2)
        self.assertEqual(self.save([templates[0]], 'route-two').status_code, 409)
        self.assertEqual(self.save([templates[1]], 'route-two').status_code, 200)
        drafts = self.client.get(self.root + '/drafts').json()
        self.assertEqual(next(d for d in drafts if d['id'] == draft['id'])['workflow'], captured)
        self.assertEqual(len(self.port()['workflow_templates']), 1)

    def test_invalid_templates_and_stale_revision_are_rejected(self):
        valid = self.template('default', 'Default')
        for templates in [[], [valid, valid], [{**valid, 'steps': []}], [{**valid, 'name': ''}], [{**valid, 'steps': [{**valid['steps'][0], 'department': '', 'user_ids': ['missing']}]}]]:
            with self.subTest(templates=templates):
                self.assertIn(self.save(templates).status_code, [409, 422])
        old = self.port()
        self.assertEqual(self.save([valid]).status_code, 200)
        self.assertEqual(self.save([valid], port=old).status_code, 409)

    def test_viewers_cannot_manage_templates(self):
        self.client.post('/api/auth/login', json={'email': 'viewer@portside.demo', 'password': 'Portside2026!'})
        self.assertEqual(self.save([self.template('default', 'Default')]).status_code, 403)
