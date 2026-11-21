from tests.fixtures import demo_client
"""API acceptance tests against a fresh temporary SQLite database."""
import copy, io, json, os, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS

class Acceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(); cls.old=store.DB_PATH; store.DB_PATH=str(Path(cls.tmp.name)/'test.db')
        cls.client=demo_client(); cls.client.__enter__()
    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None); store.DB_PATH=cls.old; cls.tmp.cleanup()
    def setUp(self):
        _LOGIN_ATTEMPTS.clear()
        self.login('admin')
    def login(self,name):
        r=self.client.post('/api/auth/login',json={'email':name+'@portside.demo','password':'Portside2026!'}); self.assertEqual(r.status_code,200,r.text)
    def snapshot(self,port='jph'):
        r=self.client.get(f'/api/ports/{port}/snapshot'); self.assertEqual(r.status_code,200,r.text); return r.json()
    def test_01_port_creation(self):
        r=self.client.post('/api/ports',json={'name':'Acceptance Test Port','code':'ATP','admin_id':'planner'}); self.assertEqual(r.status_code,200,r.text); p=r.json(); self.assertIsNone(p['boundary'])
        self.login('planner'); self.assertIn(p['id'],[p['id'] for p in self.client.get('/api/ports').json()]); self.assertEqual(self.snapshot(p['id'])['berths'],[])
    def test_02_geographic_configuration_propagates(self):
        p=self.client.post('/api/ports',json={'name':'Geographic Test Port','code':'GEO'}).json(); id=p['id']; p['boundary']={'type':'Polygon','coordinates':[[[-8.62,33.1],[-8.61,33.1],[-8.61,33.12],[-8.62,33.1]]]}; r=self.client.put('/api/ports/'+id,json=p); self.assertEqual(r.status_code,200,r.text)
        for i in range(3):
            r=self.client.post(f'/api/ports/{id}/berths',json={'name':f'Berth {i}','code':f'T{i}','terminal':'Test','length':250,'max_loa':240,'max_draft':13,'cargo':[],'buffer_hours':1,'status':'Available','geometry':{'type':'LineString','coordinates':[[-8.615,33.11+i*.001],[-8.614,33.11+i*.001]]}}); self.assertEqual(r.status_code,200,r.text)
        r=self.client.post(f'/api/ports/{id}/equipment',json={'name':'Test loader','capacity':1800,'status':'Available','berths':[r.json()['id']],'geometry':{'type':'Point','coordinates':[-8.615,33.111]}}); self.assertEqual(r.status_code,200,r.text)
        s=self.snapshot(id); self.assertEqual(len(s['berths']),3); self.assertEqual(len(s['equipment']),1); self.assertEqual(s['port']['boundary'],p['boundary'])
    def test_03_department_permissions(self):
        self.login('production'); c=self.snapshot()['calls'][0]
        r=self.client.post('/api/ports/jph/calls/'+c['id']+'/readiness',json={'ready':True,'revision':c['revision']}); self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.client.post('/api/ports/jph/planning/drafts/missing/publish',json={}).status_code,403)
        self.login('supply'); self.assertEqual(self.client.post('/api/ports/jph/calls',json=self.call_data()).status_code,200)
        self.login('operations'); self.assertEqual(self.client.post('/api/ports/jph/delays',json={'call_id':'call-1','cause':'Operations','hours':.5,'description':'Test operational hold','department':'Operations'}).status_code,200)
    def call_data(self):
        t=datetime.now(timezone.utc)+timedelta(days=15)
        return {'name':'MV Acceptance','imo':'9512345','mmsi':'242555555','loa':190,'draft':11,'product':'Fertilizer','quantity':12000,'direction':'Export','grade':'DAP','subgrade':'DAP Example','catalog_item_id':'JPH-0001','eta':t.isoformat(),'start':(t+timedelta(hours=2)).isoformat(),'end':(t+timedelta(hours=15)).isoformat(),'ready':True,'berth_id':'berth-1','equipment_id':'eq-1','priority':2,'status':'Scheduled','progress':0}
    def test_04_scheduling_and_persistence(self):
        data=self.call_data(); data['name']='MV Persistence'; r=self.client.post('/api/ports/jph/calls',json=data); self.assertEqual(r.status_code,200,r.text)
        id=r.json()['id']; self.assertTrue(any(x['id']==id for x in self.snapshot()['calls']))
        with store.connect() as c: self.assertEqual(store.record(c,'jph','calls',id)['name'],data['name'])
    def test_05_overlap_blocks_submission(self):
        s=self.snapshot(); c=next(x for x in s['calls'] if x['id']=='call-7'); other=next(x for x in s['calls'] if x['id']=='call-2')
        r=self.client.post('/api/ports/jph/planning/drafts',json={'call_id':c['id'],'base_revision':c['revision'],'reason':'Test occupied berth allocation','changes':{'berth_id':'berth-2','equipment_id':'eq-2','start':other['start'],'end':other['end']}}); self.assertEqual(r.status_code,200,r.text); d=r.json(); self.assertTrue(any('overlap' in e for e in d['validation']['errors']))
        r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/submit',json={'revision':d['revision']}); self.assertEqual(r.status_code,409,r.text)
    def test_06_approval_and_versioning(self):
        self.login('planner'); created=self.client.post('/api/ports/jph/calls',json=self.call_data()).json(); t=datetime.now(timezone.utc)+timedelta(days=20)
        r=self.client.post('/api/ports/jph/planning/drafts',json={'call_id':created['id'],'base_revision':created['revision'],'reason':'Move operation to a later clear window','changes':{'start':t.isoformat(),'end':(t+timedelta(hours=15)).isoformat()}}); self.assertEqual(r.status_code,200,r.text); d=r.json(); self.assertEqual(d['validation']['errors'],[])
        before=self.snapshot(); self.assertEqual(next(x for x in before['calls'] if x['id']==created['id'])['start'],created['start'])
        d=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/submit',json={'revision':d['revision']}).json()
        self.login('approver'); r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/approve',json={'revision':d['revision'],'comment':'Operations clearance confirmed'}); self.assertEqual(r.status_code,200,r.text); d=r.json(); self.assertEqual(d['status'],'Approved')
        r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/publish',json={'revision':d['revision']}); self.assertEqual(r.status_code,200,r.text)
        after=self.snapshot(); self.assertEqual(len(after['versions']),len(before['versions'])+1); self.assertEqual(next(x for x in after['calls'] if x['id']==created['id'])['start'],t.isoformat())
        self.assertEqual(self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/publish',json={'revision':d['revision']}).status_code,409)
    def test_07_disabled_tracking_has_no_simulated_fallback(self):
        s=self.snapshot(); self.assertEqual(s['ais']['provider'],'marinetraffic-client'); self.assertEqual(s['ais']['positions'],[])
    def test_08_delay_propagates(self):
        self.login('operations'); before=self.snapshot(); hours=2.5
        r=self.client.post('/api/ports/jph/delays',json={'call_id':'call-4','equipment_id':'eq-4','cause':'Maintenance / Equipment','hours':hours,'description':'Acceptance test conveyor breakdown','department':'Operations'}); self.assertEqual(r.status_code,200,r.text)
        after=self.snapshot(); self.assertAlmostEqual(after['stats']['delay_hours']-before['stats']['delay_hours'],hours); self.assertEqual(next(e for e in after['equipment'] if e['id']=='eq-4')['status'],'Outage'); self.assertGreater(len(after['alerts']),len(before['alerts']))
        self.login('admin'); eq=next(e for e in after['equipment'] if e['id']=='eq-4'); self.client.put('/api/ports/jph/equipment/eq-4',json={**eq,'status':'Available'})
    def test_09_scenario_isolated_and_feasible(self):
        before=self.snapshot(); r=self.client.post('/api/ports/jph/scenarios/run',json={'closed_berth':'berth-1','name':'Closure test','rate_factor':1}); self.assertEqual(r.status_code,200,r.text); result=r.json(); self.assertIn(result['status'],['Optimal','Feasible'],result); self.assertTrue(all(c['berth_id']!='berth-1' for c in result['calls']))
        from backend.planning import validate
        for call in result['calls']: self.assertEqual(validate(call,result['calls'],before['berths'],before['equipment'])['errors'],[])
        self.assertEqual(before['calls'],self.snapshot()['calls'])
    def test_10_report_files(self):
        for f in ['csv','xlsx','pdf']:
            r=self.client.get('/api/ports/jph/reports/export?format='+f); self.assertEqual(r.status_code,200,r.text[:200] if f=='csv' else '')
            self.assertGreater(len(r.content),100)
            if f=='pdf': self.assertTrue(r.content.startswith(b'%PDF'))
            if f=='xlsx':
                from openpyxl import load_workbook
                wb=load_workbook(io.BytesIO(r.content)); self.assertEqual(wb.active.cell(1,1).value,'name'); self.assertGreater(wb.active.max_row,10)
    def test_11_tenant_isolation(self):
        self.login('isolated'); self.assertEqual([p['id'] for p in self.client.get('/api/ports').json()],['other-port'])
        for suffix in ['snapshot','calls','users','audit','reports/export']:
            self.assertEqual(self.client.get('/api/ports/jph/'+suffix).status_code,403)
        self.assertEqual(self.client.post('/api/ports/jph/calls',json=self.call_data()).status_code,403)
        self.login('planner'); self.assertEqual(self.client.get('/api/ports/other-port/snapshot').status_code,403)
    def test_12_geometry_update_preserves_history(self):
        s=self.snapshot(); b=s['berths'][0]; historical=copy.deepcopy(s['versions'][0]['berths']); b['max_draft']=14.25; b['geometry']['coordinates'][0][0]-=.0001
        r=self.client.put('/api/ports/jph/berths/'+b['id'],json=b); self.assertEqual(r.status_code,200,r.text)
        after=self.snapshot(); self.assertEqual(next(x for x in after['berths'] if x['id']==b['id'])['max_draft'],14.25); self.assertEqual(after['versions'][0]['berths'],historical)
        self.assertEqual(self.client.put('/api/ports/jph/berths/'+b['id'],json=b).status_code,409)
    def test_13_safety_and_equipment_constraints(self):
        s=self.snapshot(); c=copy.deepcopy(next(x for x in s['calls'] if x['id']=='call-7')); c.update(loa=500,draft=30,product='Sulfur',ready=False)
        r=self.client.post('/api/ports/jph/planning/validate',json=c); self.assertEqual(r.status_code,200,r.text); text=' '.join(r.json()['errors']); self.assertIn('length',text); self.assertIn('draft',text); self.assertIn('incompatible',text); self.assertIn('readiness',text)
    def test_14_geometry_and_readonly_rejection(self):
        p=self.snapshot()['port']; p['boundary']={'type':'Polygon','coordinates':[[[0,0],[1,1],[2,2],[0,0]]]}; self.assertEqual(self.client.put('/api/ports/jph',json=p).status_code,422)
        self.login('viewer'); self.assertEqual(self.client.post('/api/ports/jph/calls',json=self.call_data()).status_code,403)
        self.assertEqual(self.client.post('/api/ports/jph/scenarios/run',json={}).status_code,403)
    def test_15a_admin_can_approve_own_workflow_for_testing(self):
        c=self.client.post('/api/ports/jph/calls',json=self.call_data()).json()
        t=datetime.now(timezone.utc)+timedelta(days=24)
        r=self.client.post('/api/ports/jph/planning/drafts',json={'call_id':c['id'],'base_revision':c['revision'],'reason':'Test administrator approval override','changes':{'start':t.isoformat(),'end':(t+timedelta(hours=15)).isoformat()}})
        self.assertEqual(r.status_code,200,r.text); d=r.json()
        r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/submit',json={'revision':d['revision']}); self.assertEqual(r.status_code,200,r.text); d=r.json()
        r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/approve',json={'revision':d['revision']}); self.assertEqual(r.status_code,200,r.text); d=r.json()
        self.assertEqual(d['status'],'Approved'); self.assertTrue(d['decisions'][0]['admin_override'])
    def test_15c_non_admin_author_cannot_self_approve(self):
        self.login('supply')
        c=self.client.post('/api/ports/jph/calls',json=self.call_data()).json()
        t=datetime.now(timezone.utc)+timedelta(days=24)
        r=self.client.post('/api/ports/jph/planning/drafts',json={'call_id':c['id'],'base_revision':c['revision'],'reason':'Test separate departmental approval','changes':{'start':t.isoformat(),'end':(t+timedelta(hours=15)).isoformat()}})
        self.assertEqual(r.status_code,200,r.text); d=r.json()
        r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/submit',json={'revision':d['revision']}); self.assertEqual(r.status_code,200,r.text); d=r.json()
        r=self.client.post(f'/api/ports/jph/planning/drafts/{d["id"]}/approve',json={'revision':d['revision']}); self.assertEqual(r.status_code,403,r.text)
    def test_15b_impossible_scenario_explains_failure(self):
        r=self.client.post('/api/ports/jph/scenarios/run',json={'closed_berth':'berth-3'})
        self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['status'],'Infeasible'); self.assertIn('no compatible',' '.join(r.json()['reasons']))
    def test_15_session_and_cross_origin(self):
        self.assertNotIn('password',self.client.get('/api/auth/me').json()); self.assertEqual(self.client.post('/api/auth/logout',headers={'Origin':'https://untrusted.example'},json={}).status_code,403)
        self.client.post('/api/auth/logout',json={}); self.assertEqual(self.client.get('/api/ports').status_code,401)

    def test_16_login_rate_limit(self):
        _LOGIN_ATTEMPTS.clear()
        for i in range(20):
            self.assertEqual(self.client.post('/api/auth/login',json={'email':'missing@demo','password':'wrong'}).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={'email':'missing@demo','password':'wrong'}).status_code,429)

if __name__=='__main__': unittest.main()
