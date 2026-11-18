"""Explicit synthetic fixtures; application startup never imports this module."""
import json
from fastapi.testclient import TestClient
from backend import store
from tests.demo_seed import seed


def initialize_demo():
    store.initialize()
    with store.connect() as c:
        if c.execute('SELECT 1 FROM organizations').fetchone():
            return
        seed(c)
        p = json.loads(c.execute("SELECT data FROM ports WHERE id='jph'").fetchone()['data'])
        p['cargo_catalog'] = [dict(id='JPH-0001', product='Fertilizer', direction='Export', grade='DAP', subgrade='DAP Example')]
        for i, product in enumerate(p['products'], 2):
            p['cargo_catalog'].append(dict(id=f'TEST-{i}', product=product['name'], direction=product['direction'], grade='Standard', subgrade=''))
        p['cargo_catalog'].append(dict(id='TEST-unused', product='Fertilizer', direction='Export', grade='Test grade', subgrade=''))
        c.execute("UPDATE ports SET data=? WHERE id='jph'", (json.dumps(p),))
        for row in c.execute("SELECT id,data FROM records WHERE port_id='jph' AND kind='calls'").fetchall():
            d=json.loads(row['data'])
            match=next(x for x in p['cargo_catalog'] if x['product']==d['product'] and x['grade']==d['grade'])
            d['catalog_item_id']=match['id'];d['subgrade']=''
            c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(d),row['id']))


def demo_client(**kwargs):
    from backend.main import app
    initialize_demo()
    return TestClient(app, **kwargs)
