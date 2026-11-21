import unittest
from fastapi import HTTPException
from backend.approval_workflow import normalize_workflow,completed,decision_step

class ApprovalSteps(unittest.TestCase):
    def setUp(self):
        self.steps=[{'id':'first','name':'Technical review','user_ids':['one','two'],'department':'','decision':'all'},{'id':'last','name':'Release','user_ids':['three'],'department':'','decision':'any'}]
        self.workflow={'steps':self.steps,'mode':'sequential'}
    def test_all_reviewers_and_step_order_are_enforced(self):
        decisions=[{'action':'approve','step_id':'first','user_id':'one'}]
        self.assertFalse(completed(self.steps[0],decisions))
        with self.assertRaises(HTTPException):decision_step(self.workflow,decisions,'three')
        with self.assertRaises(HTTPException):decision_step(self.workflow,decisions,'one')
        self.assertEqual(decision_step(self.workflow,decisions,'two')['id'],'first')
        decisions.append({'action':'approve','step_id':'first','user_id':'two'})
        self.assertTrue(completed(self.steps[0],decisions))
        self.assertEqual(decision_step(self.workflow,decisions,'three')['id'],'last')
    def test_parallel_stages_and_any_reviewer(self):
        self.workflow['mode']='parallel'
        self.assertEqual(decision_step(self.workflow,[],'three')['id'],'last')
        self.steps[0]['decision']='any'
        self.assertTrue(completed(self.steps[0],[{'action':'approve','step_id':'first','user_id':'two'}]))
    def test_invalid_reviewers_and_empty_routes_are_rejected(self):
        for steps in [[],[dict(self.steps[0],user_ids=['unknown'])],[dict(self.steps[0],department='Operations')]]:
            with self.assertRaises(ValueError):normalize_workflow({'steps':steps},['Operations'],[{'id':'one','department':'Operations'}])

class ApprovalStepsAPI(unittest.TestCase):
    def setUp(self):
        from tests.test_document_imports_api import DocumentImportsAPI
        self.helper=DocumentImportsAPI();self.helper.setUp()
    def tearDown(self):self.helper.tearDown()
    def __getattr__(self,name):
        if name=='helper':raise AttributeError(name)
        return getattr(self.helper,name)
    def test_named_steps_cannot_be_skipped(self):
        batch,_=self.good_upload();self.assertEqual(self.apply(batch).status_code,200)
        snapshot=self.snapshot();call=next(x for x in snapshot['calls'] if x['name']=='IMPORT ATLAS')
        members=self.client.get(self.root+'/configuration/reviewers').json()
        admin=next(x['id'] for x in members if x['id']=='admin');other=next(x['id'] for x in members if x['id']=='approver')
        port=snapshot['port'];port['workflow']={**port['workflow'],'segregation':False,'mode':'sequential','approval_mode':'manual','steps':[{'id':'first','name':'Operations review','department':'','user_ids':[admin],'decision':'any'},{'id':'last','name':'Final approval','department':'','user_ids':[other],'decision':'any'}]}
        result=self.client.put(self.root,json=port);self.assertEqual(result.status_code,200,result.text)
        response=self.client.post(self.root+'/planning/drafts',json={'call_id':call['id'],'base_revision':call['revision'],'reason':'Testing explicit approval stages','changes':{}})
        self.assertEqual(response.status_code,200,response.text);draft=response.json()
        response=self.client.post(self.root+'/planning/drafts/'+draft['id']+'/submit',json={'revision':draft['revision']});self.assertEqual(response.status_code,200,response.text);draft=response.json()
        # A reviewer assigned only to the final step cannot approve ahead of sequence.
        self.login('approver');response=self.client.post(self.root+'/planning/drafts/'+draft['id']+'/approve',json={'revision':draft['revision']});self.assertEqual(response.status_code,403,response.text)
        # A superadmin override is a testing convenience that clears every outstanding step at once.
        self.login('admin');response=self.client.post(self.root+'/planning/drafts/'+draft['id']+'/approve',json={'revision':draft['revision']});self.assertEqual(response.status_code,200,response.text);draft=response.json();self.assertEqual(draft['status'],'Approved')
        self.assertEqual([d['step_id'] for d in draft['decisions']],['first','last'])
        self.assertTrue(all(d['admin_override'] for d in draft['decisions']))
