from tests.fixtures import demo_client
import unittest,tempfile,copy
from pathlib import Path
from fastapi.testclient import TestClient
from backend import store
from backend.main import app,_LOGIN_ATTEMPTS
class RevisionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.old=store.DB_PATH;store.DB_PATH=str(Path(self.tmp.name)/'db.sqlite');_LOGIN_ATTEMPTS.clear();self.client=demo_client();self.client.__enter__();self.client.post('/api/auth/login',json={'email':'admin@portside.demo','password':'Portside2026!'})
 def tearDown(self):self.client.__exit__(None,None,None);store.DB_PATH=self.old;self.tmp.cleanup()
 def snap(self):return self.client.get('/api/ports/jph/snapshot').json()
 def test_map_removal_persists_without_breaking_calls(self):
  s=self.snap();changes=[{'kind':kind,'id':x['id'],'revision':x['revision'],'action':'remove'} for kind in ['berths','equipment','zones'] for x in s[kind]]
  r=self.client.post('/api/ports/jph/configuration/geography',json={'port_revision':s['port']['revision'],'boundary':None,'changes':changes});self.assertEqual(r.status_code,200,r.text)
  after=self.snap();self.assertIsNone(after['port']['boundary']);self.assertFalse(any(x.get('geometry') for x in after['berths']+after['equipment']));self.assertEqual(s['calls'],after['calls'])
  store.initialize();self.assertFalse(any(x.get('geometry') for x in self.snap()['berths']))
 def test_map_batch_stale_revision_is_atomic(self):
  s=self.snap();b=s['berths'][0];e=s['equipment'][0];r=self.client.post('/api/ports/jph/configuration/geography',json={'port_revision':s['port']['revision'],'changes':[{'kind':'berths','id':b['id'],'revision':b['revision'],'action':'remove'},{'kind':'equipment','id':e['id'],'revision':e['revision']-1,'action':'remove'}]});self.assertEqual(r.status_code,409);self.assertEqual(self.snap()['berths'],s['berths'])
 def test_department_management(self):
  root='/api/ports/jph/configuration/departments';r=self.client.post(root,json={'action':'add','name':'Marine Services'});self.assertEqual(r.status_code,200,r.text);self.assertIn('Marine Services',self.snap()['port']['departments'])
  r=self.client.post(root,json={'action':'rename','name':'Marine Services','new_name':'Marine Control'});self.assertEqual(r.status_code,200,r.text)
  r=self.client.post(root,json={'action':'remove','name':'Operations'});self.assertEqual(r.status_code,409)
 def test_rules_save_changes_validation(self):
  s=self.snap();b=s['berths'][0];r=self.client.post('/api/ports/jph/configuration/rules',json={'port_revision':s['port']['revision'],'rules':{'buffer_hours':2,'default_duration_hours':36,'snap_minutes':30},'berths':[{'id':b['id'],'revision':b['revision'],'max_loa':180,'max_draft':10,'buffer_hours':2,'status':'Available'}]});self.assertEqual(r.status_code,200,r.text)
  after=self.snap();self.assertEqual(after['port']['rules']['default_duration_hours'],36);self.assertTrue(any(x['call_id']=='call-1' for x in after['stats']['conflicts']))

 def test_call_duration_and_catalog_validation(self):
  d={'berth_id':'berth-1','name':'MV Catalogue test','direction':'Export','product':'Fertilizer','grade':'DAP','subgrade':'DAP Example','catalog_item_id':'JPH-0001','quantity':12000,'loa':190,'draft':11,'eta':'2026-12-01T00:00:00+00:00','start':'2026-12-01T01:00:00+00:00','duration_hours':12,'ready':True}
  r=self.client.post('/api/ports/jph/calls',json=d);self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['end'],'2026-12-01T13:00:00+00:00');self.assertEqual(r.json()['duration_hours'],12)
  bad={**d,'subgrade':'Unlisted cargo variant'};self.assertEqual(self.client.post('/api/ports/jph/calls',json=bad).status_code,422)
  bad={**d,'direction':'Import'};self.assertEqual(self.client.post('/api/ports/jph/calls',json=bad).status_code,422)
  bad={**d,'end':'2026-12-01T15:00:00+00:00'};self.assertEqual(self.client.post('/api/ports/jph/calls',json=bad).status_code,422)
 def test_invalid_rules_do_not_partially_save(self):
  s=self.snap();b=s['berths'][0];r=self.client.post('/api/ports/jph/configuration/rules',json={'port_revision':s['port']['revision'],'rules':{'snap_minutes':0},'berths':[]});self.assertEqual(r.status_code,422);self.assertEqual(s['port'],self.snap()['port'])
 def test_geography_requires_configuration_permission(self):
  self.client.post('/api/auth/login',json={'email':'viewer@portside.demo','password':'Portside2026!'})
  r=self.client.post('/api/ports/jph/configuration/geography',json={'port_revision':self.snap()['port']['revision'],'boundary':None,'changes':[]});self.assertEqual(r.status_code,403)
