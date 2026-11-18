"""Local runner boundary: no remote requests, truncation or unbounded output."""
import json,os,unittest
from unittest.mock import patch
import httpx
from backend import planning_ai as ai

class LocalOllama(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.env=patch.dict(os.environ,{'PORTOPS_AI_PROVIDER':'client_hosted','PORTOPS_AI_PROTOCOL':'ollama','PORTOPS_AI_BASE_URL':'http://127.0.0.1:11434','PORTOPS_AI_MODEL':'qwen3-vl:8b','PORTOPS_AI_API_KEY':'','PORTOPS_AI_VISION':'true','PORTOPS_AI_MAX_OUTPUT_TOKENS':'4096','PORTOPS_AI_CONTEXT_TOKENS':'16384','PORTOPS_AI_TIMEOUT_SECONDS':'300','PORTOPS_AI_MAX_INPUT_CHARS':'48000'})
  self.env.start();self.addCleanup(self.env.stop);self.requests=[]
 def transport(self,reason='stop'):
  original=httpx.AsyncClient
  def handle(request):
   self.requests.append(request)
   return httpx.Response(200,json={'done':True,'done_reason':reason,'message':{'role':'assistant','content':json.dumps({'answer':'Review loader readiness.','citations':[]})}})
  return patch.object(ai.httpx,'AsyncClient',side_effect=lambda **kw:original(transport=httpx.MockTransport(handle),**kw))
 async def test_native_connection_preserves_full_prompt_and_bounds_generation(self):
  with self.transport():result=await ai._structured('system','question',ai.EXPLANATION_SCHEMA,'test')
  self.assertEqual(result['answer'],'Review loader readiness.')
  body=json.loads(self.requests[0].content)
  self.assertFalse(body['truncate']);self.assertFalse(body['think']);self.assertFalse(body['stream'])
  self.assertEqual(body['options']['num_ctx'],16384);self.assertEqual(body['options']['num_predict'],4096)
  self.assertEqual(body['format'],ai.EXPLANATION_SCHEMA)
  self.assertIn('"citations"',body['messages'][0]['content'])
  self.assertEqual(str(self.requests[0].url),'http://127.0.0.1:11434/api/chat')
 async def test_incomplete_generation_is_not_accepted(self):
  with self.transport('length'),self.assertRaisesRegex(ValueError,'did not complete'):
   await ai._structured('system','question',ai.EXPLANATION_SCHEMA,'test')
 async def test_native_extraction_omits_missing_fields_without_changing_shared_schema(self):
  with self.transport():await ai._structured('system','question',ai.EXTRACTION_SCHEMA,'port_planning_document')
  data=json.loads(self.requests[0].content)['format']['properties']['items']['items']['properties']['data']
  self.assertEqual(data['required'],[])
  self.assertFalse(data['additionalProperties'])
  self.assertEqual(set(data['properties']),set(ai.DATA_FIELDS))
  self.assertEqual(ai.DATA_SCHEMA['required'],list(ai.DATA_FIELDS))
 async def test_large_input_is_rejected_before_network(self):
  with self.transport(),patch.dict(os.environ,{'PORTOPS_AI_MAX_INPUT_CHARS':'1000'}),self.assertRaisesRegex(ValueError,'input limit'):
   await ai._structured('system','X'*1001,ai.EXPLANATION_SCHEMA,'test')
  self.assertEqual(self.requests,[])
 async def test_vision_uses_embedded_bytes_not_remote_urls(self):
  image={'type':'image_url','image_url':{'url':'data:image/png;base64,YWJj'}}
  with self.transport():await ai._structured('system','question',ai.EXPLANATION_SCHEMA,'test',image)
  self.assertEqual(json.loads(self.requests[0].content)['messages'][1]['images'],['YWJj'])
  with self.transport(),self.assertRaisesRegex(ValueError,'embedded'):
   await ai._structured('system','question',ai.EXPLANATION_SCHEMA,'test',{'image_url':{'url':'https://example.com/image'}})
 def test_bad_limits_and_protocol_disable_connection(self):
  for value in ['bad','0','901']:
   with patch.dict(os.environ,{'PORTOPS_AI_TIMEOUT_SECONDS':value}):self.assertFalse(ai.ai_status()['configured'])
  with patch.dict(os.environ,{'PORTOPS_AI_PROTOCOL':'unknown'}):self.assertFalse(ai.ai_status()['configured'])

if __name__=='__main__':unittest.main()
