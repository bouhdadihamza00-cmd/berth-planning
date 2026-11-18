from tests.fixtures import demo_client
"""API integration coverage for saved connector definitions and map asset assignment."""
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import store
from backend.main import app, _LOGIN_ATTEMPTS


class ConfigurationConnectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = store.DB_PATH
        store.DB_PATH = str(Path(self.tmp.name)/'db.sqlite')
        _LOGIN_ATTEMPTS.clear()
        self.client = demo_client( raise_server_exceptions=False)
        self.client.__enter__()
        self.login('admin')

    def tearDown(self):
        self.client.__exit__(None,None,None)
        store.DB_PATH = self.old
        self.tmp.cleanup()

    def login(self, role):
        self.client.post('/api/auth/login',json={'email':role+'@portside.demo','password':'Portside2026!'})

    def definition(self, **changes):
        return {'name':'Loading rate OPC UA','protocol':'opcua','data_type':'production','endpoint':'opc.tcp://127.0.0.1:4840','security_mode':'SignAndEncrypt','security_policy':'Basic256Sha256','credential_ref':'JPH_OPCUA_CREDENTIAL','poll_seconds':10,'tags':[{'source':'ns=2;s=Loader.Rate','target':'loading_rate','unit':'t/h'}],**changes}

    def post(self, data, port='jph'):
        return self.client.post(f'/api/ports/{port}/configuration/connectors',json=data)

    def snapshot(self):
        response=self.client.get('/api/ports/jph/snapshot')
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def test_saved_connectors_are_configuration_only_and_revision_safe(self):
        response=self.post(self.definition())
        self.assertEqual(response.status_code,200,response.text);saved=response.json()
        listed=self.client.get('/api/ports/jph/configuration/connectors').json()
        self.assertEqual(len(listed),1);self.assertTrue(listed[0]['read_only'])
        self.assertIn('configuration only',listed[0]['connection_status'])
        self.assertEqual(listed[0]['endpoint'],'opc.tcp://127.0.0.1:4840')
        updated=self.post({**saved,'poll_seconds':20})
        self.assertEqual(updated.status_code,200,updated.text)
        self.assertEqual(updated.json()['revision'],saved['revision']+1)
        self.assertEqual(self.post(saved).status_code,409)
        url=f'/api/ports/jph/configuration/connectors/{saved["id"]}'
        stale=self.client.request('DELETE',url,json={'revision':saved['revision']})
        self.assertEqual(stale.status_code,409)
        deleted=self.client.request('DELETE',url,json={'revision':updated.json()['revision']})
        self.assertEqual(deleted.status_code,200,deleted.text)
        self.assertEqual(self.client.get('/api/ports/jph/configuration/connectors').json(),[])

    def test_protocol_enums_nodeids_and_embedded_secrets_rejected(self):
        invalid=[
            {'protocol':'mqtt'}, {'data_type':'unknown'}, {'poll_seconds':0}, {'poll_seconds':True},
            {'endpoint':'opc.tcp://user:secret@server:4840'}, {'endpoint':'opc.tcp://server:4840?password=secret'},
            {'endpoint':'opc.tcp://server:4840#token'}, {'endpoint':'https://example.org'},
            {'credential_ref':'a-real-secret-value'}, {'credential_ref':'${PASSWORD}'}, {'password':'secret'},
            {'security_mode':'Invalid'}, {'security_policy':'Invalid'}, {'security_mode':'None'},
            {'tags':[{'source':'not-node-id','target':'rate','unit':'t/h'}]},
            {'tags':[{'source':'i=2258','target':'rate','unit':'t/h'},{'source':'i=2259','target':'rate','unit':'t/h'}]},
            {'tags':[{'source':'i=2258','target':'rate','unit':'t/h','write':True}]},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                response=self.post(self.definition(**changes))
                self.assertEqual(response.status_code,422,response.text)
        api=self.definition(protocol='api',endpoint='https://example.org/inventory',data_type='inventory',tags=[{'source':'$.stocks[0].quantity','target':'inventory','unit':'t'}])
        self.assertEqual(self.post(api).status_code,200)
        for endpoint in ('https://u:p@example.org/data','https://example.org?api_key=secret','file:///tmp/data','opc.tcp://server:4840'):
            response=self.post({**api,'endpoint':endpoint})
            self.assertEqual(response.status_code,422,response.text)

    def test_non_scalar_enums_are_validation_errors(self):
        for key in ('protocol','data_type','security_mode','security_policy'):
            response=self.post(self.definition(**{key:[]}))
            self.assertEqual(response.status_code,422,(key,response.text))

    def test_connector_port_isolation_and_permissions(self):
        saved=self.post(self.definition()).json()
        other='/api/ports/safi/configuration/connectors'
        self.assertEqual(self.client.get(other).json(),[])
        self.assertEqual(self.post(saved,port='safi').status_code,404)
        self.assertEqual(self.client.request('DELETE',other+'/'+saved['id'],json={'revision':saved['revision']}).status_code,404)
        self.login('viewer')
        self.assertEqual(self.client.get('/api/ports/jph/configuration/connectors').status_code,200)
        self.assertEqual(self.post(self.definition()).status_code,403)
        self.client.post('/api/auth/logout')
        self.assertEqual(self.client.get('/api/ports/jph/configuration/connectors').status_code,401)

    def test_mapless_assets_can_be_assigned_removed_and_reassigned(self):
        snapshot=self.snapshot()
        berth={'name':'New landward berth','code':'TEST-Q','status':'Available','geometry':None,'map_visible':False,'length':350,'max_loa':300,'max_draft':14,'cargo':[snapshot['port']['products'][0]['name']],'buffer_hours':1}
        response=self.client.post('/api/ports/jph/berths',json=berth)
        self.assertEqual(response.status_code,200,response.text);berth=response.json()
        equipment={'name':'New handling unit','type':'Conveyor','capacity':1500,'status':'Available','berths':[berth['id']],'geometry':None,'map_visible':False}
        response=self.client.post('/api/ports/jph/equipment',json=equipment)
        self.assertEqual(response.status_code,200,response.text);equipment=response.json()
        snapshot=self.snapshot()
        self.assertIn(berth['id'],[b['id'] for b in snapshot['berths']])
        self.assertFalse(next(b for b in snapshot['berths'] if b['id']==berth['id'])['map_visible'])
        line={'type':'LineString','coordinates':[[-8.62,33.11],[-8.618,33.112]]}
        point={'type':'Point','coordinates':[-8.619,33.111]}
        changes=[{'kind':'berths','id':berth['id'],'revision':berth['revision'],'action':'update','geometry':line},{'kind':'equipment','id':equipment['id'],'revision':equipment['revision'],'action':'update','geometry':point}]
        payload={'port_revision':snapshot['port']['revision'],'changes':changes}
        response=self.client.post('/api/ports/jph/configuration/geography',json=payload)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.client.post('/api/ports/jph/configuration/geography',json=payload).status_code,409)
        snapshot=self.snapshot();berth=next(b for b in snapshot['berths'] if b['id']==berth['id']);equipment=next(e for e in snapshot['equipment'] if e['id']==equipment['id'])
        self.assertEqual(berth['geometry'],line);self.assertTrue(berth['map_visible']);self.assertEqual(equipment['berths'],[berth['id']]);self.assertTrue(equipment['map_visible'])
        response=self.client.post('/api/ports/jph/configuration/geography',json={'port_revision':snapshot['port']['revision'],'changes':[{'kind':'berths','id':berth['id'],'revision':berth['revision'],'action':'remove'}]})
        self.assertEqual(response.status_code,200,response.text)
        snapshot=self.snapshot();berth=next(b for b in snapshot['berths'] if b['id']==berth['id'])
        self.assertFalse(berth['map_visible']);self.assertIsNone(berth['geometry'])
        self.assertEqual(next(e for e in snapshot['equipment'] if e['id']==equipment['id'])['berths'],[berth['id']])
        replacement={'type':'LineString','coordinates':[[-8.621,33.113],[-8.619,33.114]]}
        response=self.client.post('/api/ports/jph/configuration/geography',json={'port_revision':snapshot['port']['revision'],'changes':[{'kind':'berths','id':berth['id'],'revision':berth['revision'],'action':'update','geometry':replacement}]})
        self.assertEqual(response.status_code,200,response.text)
        snapshot=self.snapshot();self.assertEqual(next(b for b in snapshot['berths'] if b['id']==berth['id'])['geometry'],replacement)
        self.assertEqual(len([b for b in snapshot['berths'] if b['id']==berth['id']]),1)
