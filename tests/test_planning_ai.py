"""Provider-boundary and calculated operational evidence tests; never call a live model."""
import json
import math
import os
import unittest
from unittest.mock import patch

import httpx

from backend import planning_ai as ai


class ClientHostedAI(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'PORTOPS_AI_PROTOCOL':'openai','PORTOPS_AI_PROVIDER': 'client_hosted', 'PORTOPS_AI_BASE_URL': 'http://127.0.0.1:8001/v1',
            'PORTOPS_AI_MODEL': 'company-planning-model', 'PORTOPS_AI_API_KEY': '',
            'OPENAI_API_KEY': 'unrelated-cloud-credential', 'PORTOPS_AI_VISION': 'false'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.source = {'format': 'csv', 'blocks': [], 'tables': [{'name': 'Schedule',
            'headers': ['Vessel', 'Quantity'], 'rows': [{'ref': 'Schedule!R2', 'values': ['MV TEST', 1000]}]}],
            'needs_ocr': False, 'truncated': False}
        self.result = {'items': [{'data': {'name': 'MV TEST', 'quantity': 1000},
            'evidence': [{'field': 'name', 'ref': 'Schedule!R2', 'quote': 'MV TEST'},
                         {'field': 'quantity', 'ref': 'Schedule!R2', 'quote': '1000'}],
            'issues': [], 'confidence': .95}], 'summary': 'One explicit nomination.', 'warnings': []}
        self.requests = []

    def provider(self, content=None, status=200, raw=None, finish='stop'):
        real_client = httpx.AsyncClient
        def handler(request):
            self.requests.append(request)
            body = raw if raw is not None else {'choices': [{'message': {'content': json.dumps(content if content is not None else self.result)}, 'finish_reason': finish}]}
            return httpx.Response(status, json=body)
        transport = httpx.MockTransport(handler)
        return patch.object(ai.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=transport, **kw))

    def test_configuration_is_client_only_and_never_exposes_secrets(self):
        status = ai.ai_status()
        self.assertTrue(status['configured']); self.assertFalse(status['external'])
        self.assertEqual(status['provider'], 'client-hosted')
        self.assertEqual(status['endpoint_host'], '127.0.0.1:8001')
        self.assertNotIn('credential', json.dumps(status))
        with patch.dict(os.environ, {'PORTOPS_AI_PROVIDER': 'openai'}):
            self.assertFalse(ai.ai_status()['configured'])
        for base in ('https://api.openai.com/v1', 'http://company.example/v1', 'http://user:secret@localhost/v1', 'http://localhost:bad/v1'):
            with patch.dict(os.environ, {'PORTOPS_AI_BASE_URL': base}):
                self.assertFalse(ai.ai_status()['configured'], base)
        with patch.dict(os.environ, {'PORTOPS_AI_BASE_URL': 'https://ai.company.example/v1', 'PORTOPS_AI_API_KEY': 'company-secret'}):
            self.assertTrue(ai.ai_status()['configured']); self.assertTrue(ai.ai_status()['external'])
            self.assertNotIn('company-secret', json.dumps(ai.ai_status()))

    async def test_structured_extraction_uses_only_explicit_endpoint(self):
        with self.provider():
            result = await ai.interpret_document(self.source, {'timezone': 'Africa/Casablanca'}, 'planning.csv')
        self.assertEqual(result['items'][0]['data']['quantity'], 1000)
        self.assertEqual(result['items'][0]['issues'], [])
        self.assertEqual(len(self.requests), 1)
        req = self.requests[0]
        self.assertEqual(str(req.url), 'http://127.0.0.1:8001/v1/chat/completions')
        self.assertNotIn('authorization', req.headers)
        payload = json.loads(req.content)
        self.assertEqual(payload['response_format']['type'], 'json_schema')
        self.assertTrue(payload['response_format']['json_schema']['strict'])
        self.assertNotIn('tools', payload)
        self.assertIn('UNTRUSTED DATA', payload['messages'][0]['content'])
        self.assertEqual(payload['model'], 'company-planning-model')

    async def test_invalid_numbers_fields_and_excess_items_are_rejected(self):
        changes = [
            {'items': [{**self.result['items'][0], 'data': {'quantity': '1,000'}}]},
            {'items': [{**self.result['items'][0], 'data': {'quantity': True}}]},
            {'items': [{**self.result['items'][0], 'data': {'quantity': math.nan}}]},
            {'items': [{**self.result['items'][0], 'data': {'python_code': 'delete everything'}}]},
            {'items': [{**self.result['items'][0], 'confidence': 1.2}]},
            {'items': [self.result['items'][0]] * 501},
        ]
        for change in changes:
            with self.subTest(change=str(change)[:80]), self.provider({**self.result, **change}):
                with self.assertRaises(ValueError):
                    await ai.interpret_document(self.source, {}, 'planning.csv')

    async def test_unverifiable_quotes_and_missing_evidence_force_review(self):
        item = {**self.result['items'][0], 'evidence': [{'field': 'name', 'ref': 'invented-page', 'quote': 'MV TEST'}]}
        with self.provider({**self.result, 'items': [item]}):
            result = await ai.interpret_document(self.source, {}, 'planning.csv')
        row = result['items'][0]
        self.assertLessEqual(row['confidence'], .5)
        self.assertTrue(any('could not be verified' in x for x in row['issues']))
        self.assertTrue(any('quantity' in x for x in row['issues']))

    async def test_numeric_values_must_match_verifiable_source_magnitudes(self):
        for field, value, quote, expected_review in [
            ('quantity', 9999, '1000 t', True),
            ('quantity', 1000, '1 kt', False),
            ('quantity', 32000, '32 000 tonnes', False),
            ('quantity', 1000, '1,000 tonnes', True),
            ('quantity', 2500, '2,5 kt', True),
            ('quantity', 1000, '1000 m3', True),
            ('quantity', 1, '1/2 t', True),
            ('quantity', 1, '1–2 kt', True),
            ('quantity', 1, '1000 kg', False),
            ('duration_hours', 2, '120 minutes', False),
            ('delay_hours', 48, '2 days', False),
            ('duration_hours', 2, '2 weeks', True),
            ('loa', 100, '100 m', False),
            ('draft', 3.048, '10 ft', False),
            ('priority', 3, '2', True),
            ('progress', 72, '0.72', True),
            ('progress', 72, '72%', False),
        ]:
            source = {**self.source, 'tables': [], 'blocks': [{'ref': 'P1', 'text': quote}]}
            row = {'data': {field: value}, 'evidence': [{'field': field, 'ref': 'P1', 'quote': quote}], 'issues': [], 'confidence': .99}
            with self.subTest(field=field, quote=quote), self.provider({**self.result, 'items': [row]}):
                result = await ai.interpret_document(source, {}, 'planning.txt')
            item = result['items'][0]
            self.assertEqual(bool(item['issues']), expected_review, item)
            if expected_review:
                self.assertLessEqual(item['confidence'], .5)
                self.assertEqual(item['data'][field], value)

    async def test_dates_need_complete_matching_timestamp_evidence(self):
        for value, quote, review in [
            ('2023-11-28T10:00:00+01:00', '2023-11-28T10:00:00+01:00', False),
            ('2023-11-28T09:00:00Z', '2023-11-28T10:00:00+01:00', False),
            ('2023-11-28T11:00:00+01:00', '2023-11-28T10:00:00+01:00', True),
            ('2023-11-28T10:00:00+01:00', '28/11 AM', True),
            ('2023-11-28T10:00:00+01:00', '28/11/2023 10:00', True),
            ('2023-11-28T10:00:00', '2023-11-28T10:00:00', True),
        ]:
            source = {**self.source, 'tables': [], 'blocks': [{'ref': 'P1', 'text': quote}]}
            row = {'data': {'start': value}, 'evidence': [{'field': 'start', 'ref': 'P1', 'quote': quote}], 'issues': [], 'confidence': .99}
            with self.subTest(value=value, quote=quote), self.provider({**self.result, 'items': [row]}):
                result = await ai.interpret_document(source, {}, 'planning.txt')
            self.assertEqual(bool(result['items'][0]['issues']), review)

    async def test_vision_images_are_explicitly_enabled_and_scanned_pdf_needs_local_ocr(self):
        source = {**self.source, 'blocks': [], 'tables': [], 'needs_ocr': True}
        with self.provider():
            with self.assertRaisesRegex(ValueError, 'disabled'):
                await ai.interpret_document(source, {}, 'scan.png', b'image-data')
        self.assertEqual(self.requests, [])
        with patch.dict(os.environ, {'PORTOPS_AI_VISION': 'true'}), self.provider():
            result = await ai.interpret_document(source, {}, 'scan.png', b'image-data')
        self.assertTrue(any('Visual-only' in x for x in result['items'][0]['issues']))
        payload = json.loads(self.requests[0].content)
        self.assertEqual(payload['messages'][1]['content'][1]['type'], 'image_url')
        self.assertTrue(payload['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/png;base64,'))
        with patch.dict(os.environ, {'PORTOPS_AI_VISION': 'true'}):
            with self.assertRaisesRegex(ValueError, 'local OCR'):
                await ai.interpret_document(source, {}, 'scan.pdf', b'pdf-data')

    async def test_failures_refusals_and_incomplete_output_are_safe(self):
        with self.provider(status=401, raw={'error': 'Bearer secret-api-key private document text'}):
            with self.assertRaises(ValueError) as context:
                await ai.interpret_document(self.source, {}, 'planning.csv')
        self.assertNotIn('secret-api-key', str(context.exception))
        self.assertEqual(len(self.requests), 1)
        with self.provider(finish='length'):
            with self.assertRaisesRegex(ValueError, 'did not complete'):
                await ai.interpret_document(self.source, {}, 'planning.csv')
        with self.provider(raw={'choices': [{'message': {'refusal': 'Declined'}, 'finish_reason': 'stop'}]}):
            with self.assertRaisesRegex(ValueError, 'declined'):
                await ai.interpret_document(self.source, {}, 'planning.csv')
        with patch.dict(os.environ, {'PORTOPS_AI_PROVIDER': 'disabled'}), self.provider():
            with self.assertRaisesRegex(ValueError, 'disabled'):
                await ai.interpret_document(self.source, {}, 'planning.csv')

    async def test_explanations_must_cite_existing_findings(self):
        analysis = {'findings': [{'id': 'F1', 'title': 'Shared loader conflict'}], 'metrics': {}}
        with self.provider({'answer': 'Resolve the loader overlap before publication.', 'citations': ['F1']}):
            result = await ai.explain_operations(analysis, 'Where is the bottleneck?')
        self.assertTrue(result['advisory']); self.assertEqual(result['citations'], ['F1'])
        with self.provider({'answer': 'Unsupported claim', 'citations': ['made-up-id']}):
            with self.assertRaisesRegex(ValueError, 'not in the current analysis'):
                await ai.explain_operations(analysis, 'Explain')


class OperationalEvidence(unittest.TestCase):
    def setUp(self):
        self.clock = '2023-11-28T00:00:00Z'
        self.call = dict(id='C1', name='MV TEST', status='Scheduled', start='2023-11-28T00:00:00Z',
                         end='2023-11-29T20:00:00Z', eta='2023-11-27T20:00:00Z', ready=True,
                         berth_id='B1', equipment_id='E1', loa=100, draft=5, quantity=10000, product='Fertilizer')
        self.berths = [dict(id='B1', code='B1', max_loa=200, max_draft=10, cargo=['Fertilizer'], status='Available', buffer_hours=1)]
        self.equipment = [dict(id='E1', name='Loader 1', status='Available', capacity=1000, berths=['B1'])]

    def analyze(self, calls, delays=()):
        return ai.analyze_operations(calls, self.berths, self.equipment, delays, {}, self.clock)

    def test_load_merges_overlaps_and_excludes_completed_calls(self):
        other = {**self.call, 'id': 'C2', 'name': 'MV OTHER'}
        completed = {**self.call, 'id': 'C3', 'status': 'Completed'}
        result = self.analyze([self.call, other, completed])
        self.assertEqual(result['metrics']['active_calls'], 2)
        self.assertEqual(result['metrics']['equipment_load'][0]['booked_hours'], 44)
        self.assertEqual(result['metrics']['calls_with_constraints'], 2)
        self.assertTrue(any(f['id'] == 'equipment-load-E1' for f in result['findings']))
        self.assertTrue(any('double-booked' in str(f['evidence']) for f in result['findings']))

    def test_readiness_waiting_and_delay_evidence_is_calculated(self):
        call = {**self.call, 'ready': False, 'status': 'Waiting'}
        delays = [{'cause': 'Operations', 'hours': 2}, {'cause': 'Operations', 'hours': 3.5},
                  {'cause': 'Production', 'hours': 8}, {'cause': 'Ignored', 'hours': math.nan}]
        result = self.analyze([call], delays)
        self.assertEqual(result['metrics']['recorded_delay_hours'], 13.5)
        self.assertEqual(result['metrics']['waiting_calls'], 1)
        titles = [f['title'] for f in result['findings']]
        self.assertIn('Cargo readiness needs confirmation', titles)
        self.assertIn('Largest recorded delay category: Production', titles)
        self.assertTrue(all(isinstance(f['evidence'], list) and f['recommendation'] for f in result['findings']))

    def test_incomplete_dates_do_not_crash_analysis(self):
        result = self.analyze([{**self.call, 'start': 'WP'}])
        self.assertEqual(result['metrics']['incomplete_calls'], 1)
        self.assertEqual(result['findings'][0]['severity'], 'high')

    def test_empty_inputs_are_honest(self):
        result = ai.analyze_operations([], [], [], [], {}, self.clock)
        self.assertEqual(result['findings'], [])
        self.assertEqual(result['metrics']['recorded_delay_hours'], 0)


if __name__ == '__main__':
    unittest.main()
