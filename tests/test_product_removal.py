import json
import unittest
from urllib.parse import quote
from backend import store


class ProductRemoval(unittest.TestCase):
    def setUp(self):
        from tests.test_removal import RemovalTests
        self.helper=RemovalTests(); self.helper.setUp()
    def tearDown(self): self.helper.tearDown()

    def test_unused_product_removes_specs_and_berth_links_atomically(self):
        root=self.helper.base; client=self.helper.client; port=self.helper.port
        with store.connect() as c:
            p=json.loads(c.execute('SELECT data FROM ports WHERE id=?',(port,)).fetchone()['data'])
            p['products'].append({'name':'Unused test product'})
            p.setdefault('cargo_catalog',[]).append({'id':'unused-spec','product':'Unused test product','grade':'Test','subgrade':'Detail'})
            c.execute('UPDATE ports SET data=? WHERE id=?',(json.dumps(p),port))
            berth=store.records(c,port,'berths')[0]
            berth.setdefault('cargo',[]).append('Unused test product')
            store.put(c,port,'berths',berth,berth['id'],berth['revision'])
        p=client.get(root+'/snapshot').json()['port']
        url=root+'/configuration/products/'+quote('Unused test product')
        self.assertEqual(client.request('DELETE',url,json={'revision':p['revision']+1}).status_code,409)
        self.assertEqual(client.request('DELETE',url,json={'revision':p['revision']}).status_code,200)
        after=client.get(root+'/snapshot').json()
        self.assertFalse(any(x['name']=='Unused test product' for x in after['port']['products']))
        self.assertFalse(any(x['id']=='unused-spec' for x in after['port']['cargo_catalog']))
        self.assertFalse(any('Unused test product' in b['cargo'] for b in after['berths']))

    def test_in_use_product_and_unprivileged_deletion_are_blocked(self):
        client=self.helper.client; root=self.helper.base
        snapshot=client.get(root+'/snapshot').json(); product=snapshot['calls'][0]['product']
        url=root+'/configuration/products/'+quote(product)
        self.assertEqual(client.request('DELETE',url,json={'revision':snapshot['port']['revision']}).status_code,409)
        client.post('/api/auth/login',json={'email':'viewer@portside.demo','password':'Portside2026!'})
        self.assertEqual(client.request('DELETE',url,json={'revision':snapshot['port']['revision']}).status_code,403)
