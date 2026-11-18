"""Custom reports use synthetic calls, including escaping and port isolation."""
import tempfile
import unittest
from pathlib import Path
from backend import store
from backend.main import _LOGIN_ATTEMPTS
from backend.reporting import safe_cell
from tests.fixtures import demo_client


class CustomReportsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=store.DB_PATH
        store.DB_PATH=str(Path(self.tmp.name)/'reports.sqlite')
        _LOGIN_ATTEMPTS.clear();self.client=demo_client();self.client.__enter__()
        self.client.post('/api/auth/login',json={'email':'admin@portside.demo','password':'Portside2026!'})

    def tearDown(self):
        self.client.__exit__(None,None,None);store.DB_PATH=self.old;self.tmp.cleanup()

    def test_working_calls_and_original_observations_remain_distinct(self):
        url='/api/ports/jph/reports/query'
        working=self.client.post(url,json={'dataset':'vessel_lineup','origin':'working'}).json()
        self.assertEqual(working['total_rows'],16)
        original=self.client.post(url,json={'dataset':'vessel_lineup','origin':'original'}).json()
        self.assertEqual(original['total_rows'],0)
        other=self.client.post('/api/ports/safi/reports/query',json={'dataset':'vessel_lineup','origin':'working'}).json()
        self.assertEqual(other['total_rows'],0)

    def test_exports_all_formats_and_formula_safety(self):
        for fmt in ['csv','xlsx','pdf']:
            response=self.client.post('/api/ports/jph/reports/custom-export',json={'dataset':'vessel_lineup','origin':'working','columns':['vessel','quantity'],'format':fmt})
            self.assertEqual(response.status_code,200,response.text[:100] if fmt=='csv' else fmt)
            self.assertGreater(len(response.content),100)
            self.assertIn('portside-',response.headers['content-disposition'])
        for value in ['=CMD()','+SUM(A1)','-1+1','@SUM(A1)','\t=CMD()']:
            self.assertTrue(safe_cell(value).startswith("'"))
        self.assertEqual(safe_cell(-3),-3)
        self.assertIsNone(safe_cell(None))

    def test_report_permission_and_invalid_dataset(self):
        self.assertEqual(self.client.post('/api/ports/jph/reports/query',json={'dataset':'unknown'}).status_code,422)
        self.client.post('/api/auth/logout')
        self.assertEqual(self.client.post('/api/ports/jph/reports/query',json={'dataset':'vessel_lineup'}).status_code,401)
