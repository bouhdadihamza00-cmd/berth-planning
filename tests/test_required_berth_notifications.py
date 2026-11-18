from tests.fixtures import demo_client
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS

class RequiredBerthNotifications(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=patch.object(store,'DB_PATH',str(Path(self.tmp.name)/'test.db'));self.db.start()
        _LOGIN_ATTEMPTS.clear();self.client=demo_client();self.client.__enter__()
        self.login('admin')

    def tearDown(self):
        self.client.__exit__(None,None,None);self.db.stop();self.tmp.cleanup()

    def login(self,name):
        self.assertEqual(self.client.post('/api/auth/login',json={'email':name+'@portside.demo','password':'Portside2026!'}).status_code,200)

    def test_new_call_requires_configured_port_berth(self):
        snapshot=self.client.get('/api/ports/jph/snapshot').json()
        call=dict(snapshot['calls'][0]);call.pop('id');call.pop('revision')
        cargo=snapshot['port']['cargo_catalog'][0]
        call.update({k:cargo[k] for k in ('product','direction','grade','subgrade')})
        call['catalog_item_id']=cargo['id']
        for missing in [None,'','not-a-berth']:
            data=dict(call,berth_id=missing)
            result=self.client.post('/api/ports/jph/calls',json=data)
            self.assertEqual(result.status_code,422)
            self.assertIn('berth',result.text.lower())
        self.assertEqual(len(self.client.get('/api/ports/jph/snapshot').json()['calls']),len(snapshot['calls']))
        result=self.client.post('/api/ports/jph/calls',json=call)
        self.assertEqual(result.status_code,200,result.text)

    def test_read_notification_is_user_specific_idempotent_and_port_scoped(self):
        with store.connect() as db:
            note=store.put(db,'jph','notifications',dict(title='Call details',description='Full notification body',entity='call-0',created_at=store.now(),read_by=[]))
        self.login('viewer')
        path='/api/ports/jph/notifications/'+note['id']+'/read'
        result=self.client.post(path,json={})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['read_by'],['viewer'])
        revision=result.json()['revision']
        self.assertEqual(self.client.post(path,json={}).json()['revision'],revision)
        self.assertEqual(self.client.post('/api/ports/safi/notifications/'+note['id']+'/read',json={}).status_code,403)
        self.login('admin')
        self.assertEqual(self.client.post('/api/ports/safi/notifications/'+note['id']+'/read',json={}).status_code,404)
        self.assertEqual(self.client.get('/api/ports/jph/snapshot').json()['notifications'][-1]['read_by'],['viewer'])
