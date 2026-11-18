from tests.fixtures import demo_client
"""Fresh-workspace initialization, evidence, admin review and duplicate protection."""
import base64
import csv
import io
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS

class DocumentSetupAPI(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=store.DB_PATH
        store.DB_PATH=str(Path(self.tmp.name)/'setup.sqlite');_LOGIN_ATTEMPTS.clear()
        self.client=demo_client(raise_server_exceptions=False);self.client.__enter__()
        self.client.post('/api/auth/login',json={'email':'admin@portside.demo','password':'Portside2026!'})
        response=self.client.post('/api/ports',json={'name':'Fresh workspace','code':'FRESH'})
        self.assertEqual(response.status_code,200,response.text)
        self.port=response.json()['id'];self.root='/api/ports/'+self.port
    def tearDown(self):
        self.client.__exit__(None,None,None);store.DB_PATH=self.old;self.tmp.cleanup()
    def upload(self,rows,filename='setup.csv'):
        stream=io.StringIO();writer=csv.writer(stream);writer.writerows(rows)
        response=self.client.post(self.root+'/imports/upload',json={'filename':filename,'content_base64':base64.b64encode(stream.getvalue().encode()).decode(),'initialize':True})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()
    def snapshot(self):return self.client.get(self.root+'/snapshot').json()
    def test_catalog_populates_from_explicit_facts_and_reupload_is_idempotent(self):
        rows=[['Product','Direction','Grade'],['Sulfur','Import','Standard']]
        batch=self.upload(rows)
        self.assertEqual(batch['setup_candidates'][0]['status'],'Applied')
        self.assertTrue(batch['setup_candidates'][0]['evidence'])
        self.assertEqual(self.snapshot()['port']['cargo_catalog'][0]['product'],'Sulfur')
        again=self.upload(rows)
        self.assertEqual(again['id'],batch['id'])
        self.assertEqual(len(self.snapshot()['port']['cargo_catalog']),1)
    def test_missing_grade_requests_admin_without_inventing_standard(self):
        batch=self.upload([['Product','Direction'],['Sulfur','Import']])
        candidate=batch['setup_candidates'][0]
        self.assertEqual(candidate['status'],'Pending administrator')
        self.assertIn('grade',candidate['issues'][0])
        self.assertFalse(self.snapshot()['port'].get('cargo_catalog'))
        self.assertTrue(any('administrator' in n['title'] for n in self.snapshot()['notifications']))
        response=self.client.post(self.root+'/imports/'+batch['id']+'/setup/'+candidate['id'],json={'revision':batch['revision'],'action':'confirm','data':{'product':'Sulfur','direction':'Import','grade':'Confirmed grade'}})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.snapshot()['port']['cargo_catalog'][0]['grade'],'Confirmed grade')
        stale=self.client.post(self.root+'/imports/'+batch['id']+'/setup/'+candidate['id'],json={'revision':batch['revision'],'action':'skip'})
        self.assertNotEqual(stale.status_code,200)
    def test_complete_berth_created_without_fabricating_map_geometry_and_conflict_is_queued(self):
        self.upload([['Product','Direction','Grade'],['Sulfur','Import','Standard']])
        headers=['Berth','Berth name','Length','Max LOA','Max draft','Buffer hours','Compatible cargo','Status']
        batch=self.upload([headers,['B1','North quay',300,280,14,1,'Sulfur','Available']],'berths.csv')
        self.assertEqual(batch['setup_candidates'][0]['status'],'Applied')
        berth=self.snapshot()['berths'][0]
        self.assertEqual(berth['length'],300);self.assertIsNone(berth['geometry']);self.assertFalse(berth['map_visible'])
        conflict=self.upload([headers,['B1','North quay',400,280,14,1,'Sulfur','Available']],'revision.csv')
        self.assertEqual(conflict['setup_candidates'][0]['status'],'Pending administrator')
        self.assertEqual(self.snapshot()['berths'][0]['length'],300)
    def test_equipment_missing_capacity_stays_an_admin_request(self):
        batch=self.upload([['Vessel','Product','Equipment'],['MV A','Sulfur','Loader A']])
        candidate=next(x for x in batch['setup_candidates'] if x['kind']=='equipment')
        self.assertEqual(candidate['status'],'Pending administrator')
        self.assertFalse(self.snapshot()['equipment'])
    def test_all_workbook_sheets_are_discovered(self):
        import openpyxl
        book=openpyxl.Workbook();book.active.title='Products'
        book.active.append(['Product','Direction','Grade']);book.active.append(['Sulfur','Import','Standard'])
        sheet=book.create_sheet('Berths');sheet.append(['Berth','Berth name','Length','Max LOA','Max draft','Buffer hours','Compatible cargo','Status']);sheet.append(['B1','North',300,280,14,1,'Sulfur','Available'])
        output=io.BytesIO();book.save(output)
        response=self.client.post(self.root+'/imports/upload',json={'filename':'all.xlsx','content_base64':base64.b64encode(output.getvalue()).decode(),'initialize':True})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual([x['status'] for x in response.json()['setup_candidates']],['Applied','Applied'])
        self.assertEqual(len(self.snapshot()['berths']),1)
    def test_conflicting_rows_in_same_document_do_not_choose_first_value(self):
        self.upload([['Product','Direction','Grade'],['Sulfur','Import','Standard']])
        headers=['Berth','Berth name','Length','Max LOA','Max draft','Buffer hours','Compatible cargo','Status']
        batch=self.upload([headers,['B1','North',300,280,14,1,'Sulfur','Available'],['B1','North',400,280,14,1,'Sulfur','Available']],'conflicting.csv')
        self.assertTrue(all(x['status']=='Pending administrator' for x in batch['setup_candidates']))
        self.assertFalse(self.snapshot()['berths'])
    def test_complete_workbook_populates_configuration_and_planning(self):
        import openpyxl
        book=openpyxl.Workbook();book.active.append(['Product','Direction','Grade']);book.active.append(['Sulfur','Import','Standard'])
        b=book.create_sheet('Berths');b.append(['Berth','Berth name','Length','Max LOA','Max draft','Buffer hours','Compatible cargo','Status']);b.append(['B1','North',300,280,14,1,'Sulfur','Available'])
        e=book.create_sheet('Equipment');e.append(['Equipment','Equipment type','Capacity','Status','Served berths']);e.append(['Loader A','Crane',1000,'Available','B1'])
        v=book.create_sheet('Planning');v.append(['Vessel','Product','Direction','Grade','Quantity','Berth','Equipment','ETA','Start','End','LOA','Draft','Ready']);v.append(['MV First','Sulfur','Import','Standard',1000,'B1','Loader A','2027-01-01T08:00:00Z','2027-01-01T09:00:00Z','2027-01-01T12:00:00Z',100,7,'Yes'])
        output=io.BytesIO();book.save(output)
        response=self.client.post(self.root+'/imports/upload',json={'filename':'complete.xlsx','content_base64':base64.b64encode(output.getvalue()).decode(),'initialize':True})
        self.assertEqual(response.status_code,200,response.text)
        batch=response.json()
        self.assertEqual(batch['status'],'Applied',batch)
        self.assertEqual(len(self.snapshot()['calls']),1)
        self.assertEqual(len(self.snapshot()['equipment']),1)
    def test_later_specification_documents_revalidate_earlier_planning(self):
        planning=self.upload([['Vessel','Product','Direction','Grade','Quantity','Berth','Equipment','ETA','Start','End','LOA','Draft','Ready'],['MV First','Sulfur','Import','Standard',1000,'B1','Loader A','2027-01-01T08:00:00Z','2027-01-01T09:00:00Z','2027-01-01T12:00:00Z',100,7,'Yes']],'first-plan.csv')
        self.assertEqual(planning['status'],'Needs review')
        self.upload([['Berth','Berth name','Length','Max LOA','Max draft','Buffer hours','Compatible cargo','Status'],['B1','North',300,280,14,1,'Sulfur','Available']],'berths.csv')
        self.upload([['Equipment','Equipment type','Capacity','Status','Served berths'],['Loader A','Crane',1000,'Available','B1']],'equipment.csv')
        final=self.client.get(self.root+'/imports/'+planning['id']).json()
        self.assertEqual(final['status'],'Applied',final)
        self.assertEqual(len(self.snapshot()['calls']),1)
    def test_non_admin_cannot_resolve_setup_even_with_custom_config_permission(self):
        import json
        batch=self.upload([['Product','Direction'],['Sulfur','Import']]);candidate=batch['setup_candidates'][0]
        with store.connect() as c:
            user=c.execute('SELECT id FROM users WHERE email=?',('viewer@portside.demo',)).fetchone()
            c.execute('INSERT INTO memberships VALUES(?,?,?,?,?)',(user['id'],self.port,'Operations','Custom role',json.dumps(['config.edit','planning.view','planning.draft'])))
        self.client.post('/api/auth/login',json={'email':'viewer@portside.demo','password':'Portside2026!'})
        response=self.client.post(self.root+'/imports/'+batch['id']+'/setup/'+candidate['id'],json={'revision':batch['revision'],'action':'confirm','data':{'product':'Sulfur','direction':'Import','grade':'Standard'}})
        self.assertEqual(response.status_code,403,response.text)
        self.client.post('/api/auth/login',json={'email':'admin@portside.demo','password':'Portside2026!'})
        self.assertFalse(self.snapshot()['port'].get('cargo_catalog'))

class SetupInterpretationEvidence(unittest.IsolatedAsyncioTestCase):
    async def test_ai_configuration_stays_pending_and_rejects_invented_source_refs(self):
        from unittest.mock import patch, AsyncMock
        from backend.document_setup import interpret_setup
        extraction={'blocks':[{'ref':'page-1','text':'Product: Sulfur. Flow: Import.'}],'tables':[]}
        reply={'candidates':[{'kind':'catalog','facts':[{'field':'product','value':'Sulfur','ref':'page-1','quote':'Product: Sulfur'},{'field':'grade','value':'Standard','ref':'invented-page','quote':'Standard'}],'issues':[]}]}
        with patch('backend.planning_ai._structured',new=AsyncMock(return_value=reply)):
            candidates=await interpret_setup(extraction)
        self.assertEqual(candidates[0]['status'],'Pending administrator')
        self.assertEqual(candidates[0]['data'],{'product':'Sulfur'})
        self.assertTrue(any('Unsupported source evidence' in issue for issue in candidates[0]['issues']))
