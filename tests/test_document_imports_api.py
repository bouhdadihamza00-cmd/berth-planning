from tests.fixtures import demo_client
"""Document-to-planning public API integration and migration guarantees."""
import base64
import copy
import csv
import io
import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS
from backend.planning import dt

PORT = 'jph'

class DocumentImportsAPI(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=store.DB_PATH
        store.DB_PATH=str(Path(self.tmp.name)/'db.sqlite');_LOGIN_ATTEMPTS.clear()
        self.client=demo_client(raise_server_exceptions=False);self.client.__enter__();self.login('admin')
        self.initial=self.snapshot();self.root='/api/ports/'+PORT
        self.template=next(c for c in self.initial['calls'] if c.get('catalog_item_id') and c.get('equipment_id') and c.get('berth_id'))
        self.start=max(dt(c['end']) for c in self.initial['calls'])+timedelta(days=3)
    def tearDown(self):
        self.client.__exit__(None,None,None);store.DB_PATH=self.old;self.tmp.cleanup()
    def login(self,role):
        response=self.client.post('/api/auth/login',json={'email':role+'@portside.demo','password':'Portside2026!'})
        self.assertEqual(response.status_code,200,response.text)
    def snapshot(self):
        response=self.client.get('/api/ports/'+PORT+'/snapshot');self.assertEqual(response.status_code,200,response.text);return response.json()
    def row(self,name='IMPORT ATLAS',**changes):
        c=self.template
        row={key:c.get(key,'') for key in ['direction','product','grade','subgrade']}
        row.update(name=name,quantity=1000,berth=next(b['code'] for b in self.initial['berths'] if b['id']==c['berth_id']),equipment=next(e['name'] for e in self.initial['equipment'] if e['id']==c['equipment_id']),eta=(self.start-timedelta(hours=1)).isoformat(),start=self.start.isoformat(),end=(self.start+timedelta(hours=24)).isoformat(),loa=190,draft=10,ready=True,priority=3)
        row.update(changes);return row
    def csv_bytes(self,rows):
        target=io.StringIO(newline='');headers=list(dict.fromkeys(key for row in rows for key in row))
        writer=csv.DictWriter(target,fieldnames=headers);writer.writeheader();writer.writerows(rows);return target.getvalue().encode()
    def upload(self,rows=None,**options):
        raw=options.pop('raw',None) or self.csv_bytes(rows or [self.row()])
        response=self.client.post(self.root+'/imports/upload',json={'filename':options.pop('filename','latest-plan.csv'),'content_base64':base64.b64encode(raw).decode(),'method':'local',**options})
        return response,raw
    def good_upload(self,rows=None,**options):
        response,raw=self.upload(rows,**options);self.assertEqual(response.status_code,200,response.text);return response.json(),raw
    def apply(self,batch,mode='publish'):
        return self.client.post(self.root+'/imports/'+batch['id']+'/apply',json={'revision':batch['revision'],'mode':mode})
    def review(self,batch,items=None):
        response=self.client.post(self.root+'/imports/'+batch['id']+'/review',json={'revision':batch['revision'],'items':items or [{'id':x['id'],'data':x['data'],'selected':x['selected'],'match_id':x.get('match_id')} for x in batch['items']]})
        self.assertEqual(response.status_code,200,response.text);return response.json()
    def test_upload_is_preview_only_source_preserved_and_repeat_idempotent(self):
        batch,raw=self.good_upload()
        self.assertEqual(batch['status'],'Ready',batch);self.assertEqual(batch['counts']['create'],1)
        self.assertEqual(batch['items'][0]['errors'],[])
        self.assertTrue(batch['items'][0]['evidence'][0]['ref'].endswith('R2'))
        self.assertEqual(self.snapshot()['calls'],self.initial['calls'])
        again,_=self.good_upload();self.assertEqual(again['id'],batch['id']);self.assertEqual(again['revision'],batch['revision'])
        source=self.client.get(self.root+'/imports/'+batch['id']+'/source');self.assertEqual(source.content,raw)
        self.assertIn('attachment',source.headers['content-disposition'])
        library=self.client.get(self.root+'/imports').json();self.assertEqual(len(library['batches']),1)
        self.assertNotIn('content_base64',str(library))
    def test_new_call_publish_version_and_rollback_preserve_record(self):
        batch,_=self.good_upload();response=self.apply(batch);self.assertEqual(response.status_code,200,response.text);batch=response.json()
        self.assertEqual(batch['status'],'Applied');after=self.snapshot();self.assertEqual(len(after['calls']),len(self.initial['calls'])+1)
        created=next(c for c in after['calls'] if c['name']=='IMPORT ATLAS');self.assertEqual(created['quantity'],1000)
        self.assertEqual(len(after['versions']),len(self.initial['versions'])+1)
        rollback=self.client.post(self.root+'/imports/'+batch['id']+'/rollback',json={'revision':batch['revision']})
        self.assertEqual(rollback.status_code,200,rollback.text);self.assertEqual(rollback.json()['status'],'Rolled back')
        restored=next(c for c in self.snapshot()['calls'] if c['id']==created['id']);self.assertEqual(restored['status'],'Cancelled')
        self.assertEqual(next(c for c in self.snapshot()['calls'] if c['id']==self.template['id']),self.template)
        self.assertNotEqual(self.apply(batch).status_code,200)
    def test_manual_policy_updates_require_draft_then_department_publication(self):
        row={'name':self.template['name'],'call_reference':self.template.get('call_reference',''),'start':self.start.isoformat(),'end':(self.start+timedelta(hours=24)).isoformat()}
        batch,_=self.good_upload([row]);batch=self.review(batch,[{'id':batch['items'][0]['id'],'data':batch['items'][0]['data'],'selected':True,'match_id':self.template['id']}]);self.assertEqual(batch['items'][0]['match_id'],self.template['id'])
        blocked=self.apply(batch);self.assertEqual(blocked.status_code,422,blocked.text)
        self.assertIn('approval',blocked.text.lower())
        response=self.apply(batch,'draft');self.assertEqual(response.status_code,200,response.text);batch=response.json();self.assertEqual(batch['status'],'Drafted')
        self.assertEqual(next(c for c in self.snapshot()['calls'] if c['id']==self.template['id'])['start'],self.template['start'])
        draft=next(d for d in self.snapshot()['drafts'] if d['id']==batch['draft_ids'][0])
        draft=self.step(draft,'submit');self.login('approver');draft=self.step(draft,'approve');draft=self.step(draft,'publish')
        self.assertEqual(draft['status'],'Published');self.assertEqual(next(c for c in self.snapshot()['calls'] if c['id']==self.template['id'])['start'],self.start.isoformat())
    def step(self,draft,action):
        response=self.client.post(self.root+'/planning/drafts/'+draft['id']+'/'+action,json={'revision':draft['revision'],'comment':'Document source checked'})
        self.assertEqual(response.status_code,200,response.text);return response.json()
    def test_new_nomination_draft_is_created_only_at_publication(self):
        batch,_=self.good_upload();response=self.apply(batch,'draft');self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(len(self.snapshot()['calls']),len(self.initial['calls']))
        draft=next(d for d in self.snapshot()['drafts'] if d['id']==response.json()['draft_ids'][0]);self.assertEqual(draft['operation'],'create')
        draft=self.step(draft,'submit');self.login('approver');draft=self.step(draft,'approve');draft=self.step(draft,'publish')
        self.assertEqual(draft['status'],'Published');self.assertEqual(len(self.snapshot()['calls']),len(self.initial['calls'])+1)
    def test_stale_vessel_and_stale_import_revision_block_mutations(self):
        batch,_=self.good_upload([{'name':self.template['name'],'start':self.start.isoformat(),'end':(self.start+timedelta(hours=24)).isoformat()}])
        batch=self.review(batch,[{'id':batch['items'][0]['id'],'data':batch['items'][0]['data'],'selected':True,'match_id':self.template['id']}])
        changed=self.client.post(self.root+'/calls/'+self.template['id']+'/actuals',json={'revision':self.template['revision'],'progress':self.template['progress']})
        self.assertEqual(changed.status_code,200,changed.text)
        response=self.apply(batch,'draft');self.assertEqual(response.status_code,409,response.text);self.assertIn('changed',response.text)
        fresh,_=self.good_upload([self.row(name='IMPORT VEGA')]);reviewed=self.review(fresh)
        stale=self.client.post(self.root+'/imports/'+fresh['id']+'/review',json={'revision':fresh['revision'],'items':[]})
        self.assertEqual(stale.status_code,409,stale.text);self.assertGreater(reviewed['revision'],fresh['revision'])
    def test_mapping_and_manual_correction_refresh_evidence(self):
        batch,_=self.good_upload()
        mapping=self.client.post(self.root+'/imports/'+batch['id']+'/map',json={'revision':batch['revision'],'mapping':batch['mapping'],'table_index':0,'header_row':0,'date_order':'ISO'})
        self.assertEqual(mapping.status_code,200,mapping.text);batch=mapping.json()
        item=copy.deepcopy(batch['items'][0]);item['data']['quantity']=2000
        reviewed=self.review(batch,[{'id':item['id'],'data':item['data'],'selected':True,'match_id':None}])
        changed=reviewed['items'][0];self.assertEqual(changed['proposed']['quantity'],2000)
        self.assertIn('quantity',changed['manual_fields']);self.assertFalse(any(e['field']=='quantity' for e in changed['evidence']))
    def test_permissions_and_port_isolation(self):
        batch,_=self.good_upload();other='/api/ports/safi/imports/'+batch['id']
        self.assertEqual(self.client.get(other).status_code,404)
        self.assertEqual(self.client.get(other+'/source').status_code,404)
        self.login('viewer')
        self.assertEqual(self.client.get(self.root+'/imports').status_code,200)
        response,_=self.upload();self.assertEqual(response.status_code,403)
        self.assertEqual(self.apply(batch).status_code,403)
        self.client.post('/api/auth/logout');self.assertEqual(self.client.get(self.root+'/imports').status_code,401)
    def test_trusted_local_template_automatically_applies_only_valid_authorized_upload(self):
        batch,_=self.good_upload();response=self.client.post(self.root+'/imports/'+batch['id']+'/template',json={'revision':batch['revision'],'name':'Trusted company lineup','auto_apply':True})
        self.assertEqual(response.status_code,200,response.text);template=response.json()
        automatic,_=self.good_upload([self.row(name='IMPORT TRUSTED')],template_id=template['id'])
        self.assertEqual(automatic['status'],'Applied',automatic)
        self.assertTrue(any(c['name']=='IMPORT TRUSTED' for c in self.snapshot()['calls']))
        broken,_=self.good_upload([self.row(name='IMPORT BLOCKED',draft=99)],template_id=template['id'])
        self.assertNotEqual(broken['status'],'Applied')
        self.assertFalse(any(c['name']=='IMPORT BLOCKED' for c in self.snapshot()['calls']))
    def test_invalid_inputs_and_duplicate_rows_never_modify_plan(self):
        response,_=self.upload(raw=b'name,start\nUNKNOWN,04/05/2023\n')
        self.assertEqual(response.status_code,200,response.text);batch=response.json();self.assertTrue(batch['items'][0]['errors'])
        self.assertNotEqual(self.apply(batch).status_code,200)
        duplicate,_=self.good_upload([self.row(),self.row()]);self.assertTrue(any('Duplicate' in e for x in duplicate['items'] for e in x['errors']))
        self.assertNotEqual(self.apply(duplicate).status_code,200)
        for payload in [{}, {'filename':'bad.csv','content_base64':'@notbase64','method':'local'}, {'filename':'bad.exe','content_base64':base64.b64encode(b'x').decode(),'method':'local'}]:
            r=self.client.post(self.root+'/imports/upload',json=payload);self.assertIn(r.status_code,[400,422],r.text)
        self.assertEqual(self.snapshot()['calls'],self.initial['calls'])
    def test_imported_delay_requires_review_and_is_recorded_only_on_publication(self):
        batch,_=self.good_upload([self.row(name='IMPORT DELAY',delay_hours=3,delay_cause='Operations',delay_description='Conveyor access delayed in the company plan')])
        self.assertTrue(batch['items'][0]['warnings'])
        self.assertNotEqual(self.apply(batch).status_code,200)
        self.assertEqual(self.snapshot()['delays'],self.initial['delays'])
        response=self.apply(batch,'draft');self.assertEqual(response.status_code,200,response.text)
        draft=next(d for d in self.snapshot()['drafts'] if d['id']==response.json()['draft_ids'][0])
        draft=self.step(draft,'submit');self.login('approver');draft=self.step(draft,'approve');draft=self.step(draft,'publish')
        after=self.snapshot();created=next(c for c in after['calls'] if c['name']=='IMPORT DELAY')
        self.assertEqual(created['status'],'Delayed')
        delay=next(d for d in after['delays'] if d['call_id']==created['id']);self.assertEqual(delay['hours'],3)
        batch=self.client.get(self.root+'/imports/'+batch['id']).json()
        rollback=self.client.post(self.root+'/imports/'+batch['id']+'/rollback',json={'revision':batch['revision']})
        self.assertEqual(rollback.status_code,200,rollback.text)
        self.assertEqual(self.snapshot()['delays'],self.initial['delays'])
        self.assertEqual(next(c for c in self.snapshot()['calls'] if c['id']==created['id'])['status'],'Cancelled')

    def test_rollback_refuses_to_overwrite_work_after_the_import(self):
        batch,_=self.good_upload();response=self.apply(batch);self.assertEqual(response.status_code,200,response.text);batch=response.json()
        created=next(c for c in self.snapshot()['calls'] if c['name']=='IMPORT ATLAS')
        changed=self.client.post(self.root+'/calls/'+created['id']+'/actuals',json={'revision':created['revision'],'progress':25})
        self.assertEqual(changed.status_code,200,changed.text)
        rollback=self.client.post(self.root+'/imports/'+batch['id']+'/rollback',json={'revision':batch['revision']})
        self.assertEqual(rollback.status_code,409,rollback.text)
        current=next(c for c in self.snapshot()['calls'] if c['id']==created['id']);self.assertEqual(current['progress'],25);self.assertNotEqual(current['status'],'Cancelled')

    def test_unconfigured_ai_fails_without_network_or_cloud_fallback(self):
        with patch.dict(os.environ,{'PORTOPS_AI_PROVIDER':'disabled','PORTOPS_AI_BASE_URL':'','PORTOPS_AI_MODEL':'','OPENAI_API_KEY':''},clear=False):
            status=self.client.get(self.root+'/intelligence/status');self.assertEqual(status.status_code,200,status.text);self.assertFalse(status.json()['configured'])
            response,_=self.upload(method='ai');self.assertEqual(response.status_code,422,response.text)
            self.assertEqual(self.snapshot()['calls'],self.initial['calls'])

    def test_incomplete_neighbor_does_not_crash_preview_or_mutate_valid_rows(self):
        incomplete=self.row(name='INCOMPLETE',end='not a date')
        batch,_=self.good_upload([self.row(),incomplete])
        self.assertEqual(len(batch['items']),2)
        self.assertTrue(batch['items'][1]['errors'])
        response=self.apply(batch);self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(self.snapshot()['calls'],self.initial['calls'])

    def test_operational_status_requires_existing_authority_and_remains_a_proposal(self):
        batch,_=self.good_upload([self.row(name='IMPORT ACTIVE',status='Loading',progress=25)])
        response=self.apply(batch,'draft');self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.snapshot()['calls'],self.initial['calls'])
        draft=next(d for d in self.snapshot()['drafts'] if d['id'] in response.json()['draft_ids'])
        self.assertIn('operations.update',draft['import_permissions'])
        self.assertEqual(draft['proposed']['status'],'Loading');self.assertEqual(draft['proposed']['progress'],25)

    def test_json_arrays_are_validation_errors(self):
        for suffix in ['/imports/upload','/intelligence/explain']:
            r=self.client.post(self.root+suffix,json=[]);self.assertEqual(r.status_code,422,r.text)

    def test_ai_receives_client_context_but_cannot_bypass_human_review(self):
        from unittest.mock import AsyncMock
        row=self.row(name='AI REVIEW')
        result={'items':[{'data':row,'evidence':[],'issues':[],'confidence':1.0}],'summary':'Model interpretation','warnings':[]}
        status={'configured':True,'provider':'client-hosted','model':'company-model','external':False,'vision':False,'message':'Ready'}
        model=AsyncMock(return_value=result)
        with patch('backend.document_imports.ai_status',return_value=status),patch('backend.document_imports.interpret_document',model):
            batch,_=self.good_upload(method='ai',document_date='2023-11-28')
        self.assertEqual(model.call_args.args[1]['document_date'],'2023-11-28')
        self.assertTrue(model.call_args.args[1]['known_calls'])
        response=self.apply(batch);self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(self.snapshot()['calls'],self.initial['calls'])
        batch=self.review(batch)
        response=self.apply(batch,'draft');self.assertEqual(response.status_code,200,response.text)

    def test_pdf_and_word_key_value_plans_produce_valid_cited_previews(self):
        from reportlab.pdfgen.canvas import Canvas
        from tests.test_document_extract import docx_bytes
        from xml.sax.saxutils import escape
        for extension in ['pdf','docx']:
            values=self.row(name='DOCUMENT '+extension.upper())
            lines=[str(k)+': '+str(v) for k,v in values.items()]
            if extension=='pdf':
                target=io.BytesIO();pdf=Canvas(target);text=pdf.beginText(40,790);text.setLeading(15)
                for line in lines:text.textLine(line)
                pdf.drawText(text);pdf.save();raw=target.getvalue()
            else:raw=docx_bytes(''.join('<w:p><w:r><w:t>'+escape(line)+'</w:t></w:r></w:p>' for line in lines))
            response,_=self.upload(raw=raw,filename='plan.'+extension)
            self.assertEqual(response.status_code,200,response.text);batch=response.json()
            self.assertEqual(batch['status'],'Ready',batch['items'])
            self.assertEqual(batch['items'][0]['proposed']['quantity'],1000)
            self.assertTrue(batch['items'][0]['evidence'])
            self.assertEqual(self.snapshot()['calls'],self.initial['calls'])

    def test_review_confirms_normalized_units_without_double_conversion(self):
        row=self.row(name='UNIT REVIEW');row['quantity (kt)']=2.5;del row['quantity']
        batch,_=self.good_upload([row]);item=batch['items'][0]
        self.assertEqual(item['normalized_data']['quantity'],2500)
        self.assertEqual(item['proposed']['quantity'],2500)
        batch=self.review(batch,[{'id':item['id'],'data':item['normalized_data'],'selected':True,'match_id':None}])
        self.assertEqual(batch['items'][0]['proposed']['quantity'],2500)
        self.assertEqual(batch['items'][0]['source_data']['quantity'],'2.5')

if __name__=='__main__':unittest.main()
