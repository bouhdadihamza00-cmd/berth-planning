from tests.fixtures import demo_client
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS


class WorkflowRemoval(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=patch.object(store,'DB_PATH',str(Path(self.tmp.name)/'test.db'));self.db.start()
        _LOGIN_ATTEMPTS.clear()
        self.client=demo_client();self.client.__enter__()
        self.login('planner')
        with store.connect() as db:
            call=store.records(db,'jph','calls')[0]
            self.call_before=call
            # Deliberately invalid proposal: termination must not require a valid plan.
            self.draft=store.put(db,'jph','drafts',dict(author_id='planner',author='Planner',status='Submitted',
                              call_id=call['id'],before=call,proposed={},reason='Removal test',decisions=[]))

    def tearDown(self):
        self.client.__exit__(None,None,None);self.db.stop();self.tmp.cleanup()

    def login(self,user):
        self.assertEqual(self.client.post('/api/auth/login',json={'email':('isolated' if user=='other' else user)+'@portside.demo','password':'Portside2026!'}).status_code,200)

    def url(self): return '/api/ports/jph/planning/drafts/'+self.draft['id']

    def test_author_can_terminate_then_delete_without_changing_published_call(self):
        result=self.client.post(self.url()+'/terminate',json={'revision':self.draft['revision']})
        self.assertEqual(result.status_code,200,result.text)
        cancelled=result.json();self.assertEqual(cancelled['status'],'Cancelled')
        self.assertEqual(self.client.post(self.url()+'/submit',json={'revision':cancelled['revision']}).status_code,409)
        self.assertEqual(self.client.delete(self.url()+'?revision='+str(self.draft['revision'])).status_code,409)
        self.assertEqual(self.client.delete(self.url()+'?revision='+str(cancelled['revision'])).status_code,200)
        with store.connect() as db:
            self.assertIsNone(store.record(db,'jph','drafts',self.draft['id']))
            self.assertEqual(store.record(db,'jph','calls',self.call_before['id']),self.call_before)
            events=[r[0] for r in db.execute('SELECT action FROM audit WHERE entity_id=?',(self.draft['id'],))]
            self.assertIn('draft.terminated',events);self.assertIn('draft.deleted',events)

    def test_non_author_and_other_port_cannot_remove_workflow(self):
        self.login('approver')
        self.assertEqual(self.client.post(self.url()+'/terminate',json={'revision':1}).status_code,403)
        self.assertEqual(self.client.delete(self.url()+'?revision=1').status_code,403)
        self.login('other')
        self.assertEqual(self.client.delete(self.url()+'?revision=1').status_code,403)
        self.assertEqual(self.client.post(self.url()+'/terminate',json={'revision':1}).status_code,403)

    def test_published_workflow_can_be_deleted_but_not_terminated_and_versions_remain(self):
        with store.connect() as db:
            self.draft=store.put(db,'jph','drafts',dict(self.draft,status='Published'),self.draft['id'],self.draft['revision'])
            version=store.put(db,'jph','versions',dict(draft_id=self.draft['id'],status='Published',calls=[self.call_before]))
        self.assertEqual(self.client.post(self.url()+'/terminate',json={'revision':self.draft['revision']}).status_code,409)
        self.assertEqual(self.client.delete(self.url()+'?revision='+str(self.draft['revision'])).status_code,200)
        with store.connect() as db:self.assertEqual(store.record(db,'jph','versions',version['id']),version)
