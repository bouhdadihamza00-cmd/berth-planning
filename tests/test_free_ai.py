"""Free-only routing at the actual HTTP boundary; no live inference in tests."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend import planning_ai as ai


class FreeAI(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        env = patch.dict(os.environ, {
            'PORTOPS_AI_PROVIDER': 'openrouter_free',
            'PORTOPS_AI_BASE_URL': 'https://openrouter.ai/api/v1',
            'PORTOPS_AI_MODEL': 'openrouter/free',
            'OPENROUTER_API_KEY': 'test-free-key',
            'PORTOPS_AI_API_KEY': 'paid-key-never-use',
            'OPENAI_API_KEY': 'codex-key-never-use',
            'PORTOPS_AI_PROTOCOL': 'openai',
        }, clear=True)
        env.start()
        self.addCleanup(env.stop)
        self.requests = []

    def transport(self, cost=0, status=200):
        client = httpx.AsyncClient
        def handler(request):
            self.requests.append(request)
            return httpx.Response(status, json={
                'choices': [{'finish_reason': 'stop', 'message': {
                    'content': json.dumps({'answer': 'Synthetic result.', 'citations': []})}}],
                'usage': {'cost': cost}})
        return patch.object(ai.httpx, 'AsyncClient', side_effect=lambda **kw: client(
            transport=httpx.MockTransport(handler), **kw))

    def test_status_is_free_only_without_secrets(self):
        status = ai.ai_status()
        self.assertTrue(status['configured'])
        self.assertTrue(status['free_only'])
        self.assertEqual(status['provider'], 'openrouter-free')
        self.assertTrue(status['external'])
        self.assertNotIn('test-free-key', json.dumps(status))
        self.assertNotIn('paid-key-never-use', json.dumps(status))

    async def test_paid_models_and_endpoint_changes_fail_before_network(self):
        overrides = [
            {'PORTOPS_AI_MODEL': 'openai/gpt-5-codex'},
            {'PORTOPS_AI_MODEL': 'vendor/paid'},
            {'PORTOPS_AI_MODEL': 'vendor/codex:free'},
            {'PORTOPS_AI_BASE_URL': 'http://localhost:9999/v1'},
            {'PORTOPS_AI_PROTOCOL': 'ollama'},
        ]
        with self.transport():
            for override in overrides:
                with self.subTest(override=override), patch.dict(os.environ, override):
                    self.assertFalse(ai.ai_status()['configured'])
                    with self.assertRaises(ValueError):
                        await ai._structured('Return JSON', 'Synthetic', ai.EXPLANATION_SCHEMA, 'test')
        self.assertEqual(self.requests, [])

    async def test_free_request_has_no_paid_fallback_and_uses_only_free_key(self):
        with self.transport():
            result = await ai._structured('Return JSON', 'Synthetic', ai.EXPLANATION_SCHEMA, 'test')
        self.assertEqual(result['answer'], 'Synthetic result.')
        request = self.requests[0]
        self.assertEqual(str(request.url), 'https://openrouter.ai/api/v1/chat/completions')
        self.assertEqual(request.headers['authorization'], 'Bearer test-free-key')
        payload = json.loads(request.content)
        self.assertEqual(payload['provider']['max_price'], {
            'prompt': 0, 'completion': 0, 'request': 0, 'image': 0})
        self.assertFalse(payload['provider']['allow_fallbacks'])
        self.assertTrue(payload['provider']['require_parameters'])
        self.assertEqual(payload['model'], 'openrouter/free')
        for field in ('models', 'plugins', 'tools'):
            self.assertNotIn(field, payload)

    async def test_cost_must_be_zero_and_rate_limit_never_retries(self):
        for cost in (None, 0.001, -1, 'NaN', True):
            with self.subTest(cost=cost), self.transport(cost=cost):
                with self.assertRaises(ValueError):
                    await ai._structured('Return JSON', 'Synthetic', ai.EXPLANATION_SCHEMA, 'test')
        self.requests.clear()
        with self.transport(status=429), self.assertRaisesRegex(ValueError, 'HTTP 429'):
            await ai._structured('Return JSON', 'Synthetic', ai.EXPLANATION_SCHEMA, 'test')
        self.assertEqual(len(self.requests), 1)

    def test_paid_credentials_are_never_used_when_free_key_is_missing(self):
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': '',
                                    'PORTOPS_AI_CREDENTIALS_FILE': '/nonexistent/credentials.json'}):
            self.assertFalse(ai.ai_status()['configured'])
            self.assertEqual(ai._configuration()['key'], '')

    def test_private_file_loads_only_openrouter_and_rejects_public_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'keys.json'
            path.write_text(json.dumps({'credentials': {'openrouter': 'private-test-key',
                                                        'bytez': 'inactive-test-key'}}))
            path.chmod(0o600)
            with patch.dict(os.environ, {'OPENROUTER_API_KEY': '', 'PORTOPS_AI_CREDENTIALS_FILE': str(path)}):
                self.assertEqual(ai._configuration()['key'], 'private-test-key')
                self.assertNotIn('private-test-key', json.dumps(ai.ai_status()))
                path.chmod(0o644)
                self.assertFalse(ai.ai_status()['configured'])

    async def test_direct_http_calls_cannot_override_the_free_policy(self):
        with self.transport():
            for url, payload in [
                ('https://other.example/chat/completions', {'model': 'openrouter/free'}),
                ('https://openrouter.ai/api/v1/chat/completions', {'model': 'paid/model'}),
                ('https://openrouter.ai/api/v1/chat/completions', {'model': 'openrouter/free', 'models': ['paid/model']}),
            ]:
                with self.assertRaises(ValueError):
                    await ai._post(url, payload, 'paid-key-never-use')
        self.assertEqual(self.requests, [])
