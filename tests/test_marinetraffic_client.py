from tests.fixtures import initialize_demo
"""Exclusive supplied-client integration; no network calls."""
import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from backend.ais_marinetraffic_client import ClientSource, MarineTrafficAIS
from backend.marinetraffic_client import MarineTrafficClient, MarineTrafficError
from backend.ais import positions

def port():
    return {'id': 'test', 'center': [-8.63, 33.12], 'boundary': None,
            'integration': {'provider': 'marinetraffic-client', 'enabled': True,
                            'radius_km': 25, 'freshness_minutes': 30}}


def row(identity='123', elapsed=0):
    return {'SHIP_ID': identity, 'SHIPNAME': 'REAL SHIP', 'LAT': 33.12, 'LON': -8.63,
            'SPEED': '86', 'COURSE': '0', 'HEADING': None, 'ELAPSED': elapsed,
            'LENGTH': 200, 'WIDTH': 30, 'DWT': 60000, 'SHIPTYPE': 'Cargo'}


class ClientIntegration(unittest.TestCase):
    def test_full_area_shared_tiles_identity_and_age_zero_deduplication(self):
        client = MagicMock()
        client.vessel_tile.side_effect = [{'data': {'rows': [row('a', 0), row('satellite-a', 2)]}}, {'data': {'rows': [row('a', 10), row('satellite-b', 2)]}}]
        factory = MagicMock(); factory.return_value.__enter__.return_value = client
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / 'cookies.json'; private.write_text('{"test":"private"}')
            with patch.dict(os.environ, {'MARINETRAFFIC_CLIENT_COOKIES_FILE': str(private)}), patch('backend.marinetraffic_client.MarineTrafficClient.tiles', return_value=[(1, 1), (1, 2)]):
                data = ClientSource([port(), port()], client_factory=factory).read()
        self.assertEqual(client.vessel_tile.call_count, 2, 'Overlapping ports share tile requests')
        self.assertEqual(len(data['rows']), 3, 'Nearby satellite identities remain distinct')
        self.assertEqual(next(p for p in data['rows'] if p['SHIP_ID'] == 'a')['ELAPSED'], 0)
        self.assertEqual(data['units']['elapsed'], 'minutes')
        self.assertEqual(factory.call_args.kwargs['cookies'], {'test': 'private'})
        collector = MarineTrafficAIS(); collector.ingest(data)
        value = collector.snapshot(port(), [])
        self.assertEqual(value['mode'], 'live')
        self.assertEqual(value['provider'], 'marinetraffic-client')
        self.assertEqual(value['positions'][0]['speed'], 8.6)
        self.assertTrue(value['positions'][0]['id'].startswith('mt-client-'))
        self.assertNotIn('private', json.dumps(value))

    def test_endpoint_is_optional_and_exposes_sanitized_failure(self):
        collector = MarineTrafficAIS()
        with patch('backend.ais_marinetraffic_client.collector', collector):
            disabled = port(); disabled['integration']['enabled'] = False
            self.assertEqual(positions(disabled, [])['positions'], [])
            source = MagicMock(); source.read.side_effect = RuntimeError('secret-cookie upstream URL')
            collector.poll(source)
            value = positions(port(), [{'id': 'demo', 'position': [-8.63, 33.12]}])
        self.assertEqual(value['mode'], 'offline')
        self.assertEqual(value['positions'], [])
        self.assertNotIn('secret-cookie', str(value))
        self.assertIn('blocked', value['message'])

    def test_partial_tile_failure_preserves_valid_rows_and_reports_coverage(self):
        client = MagicMock()
        client.vessel_tile.side_effect = [{"data": {"rows": [row()]}}, RuntimeError('blocked secret')]
        factory = MagicMock(); factory.return_value.__enter__.return_value = client
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {'MARINETRAFFIC_CLIENT_COOKIES_FILE': str(Path(directory) / 'absent.json')}), patch('backend.marinetraffic_client.MarineTrafficClient.tiles', return_value=[(1, 1), (1, 2)]):
                data = ClientSource([port()], client_factory=factory).read()
        collector = MarineTrafficAIS(); collector.ingest(data)
        value = collector.snapshot(port(), [])
        self.assertEqual(value['mode'], 'partial')
        self.assertEqual(value['coverage']['tiles_received'], 1)
        self.assertEqual(value['coverage']['tiles_total'], 2)
        self.assertEqual(len(value['positions']), 1)
        self.assertNotIn('secret', json.dumps(value))

    def test_excel_isolation_and_stale_retained_positions(self):
        collector = MarineTrafficAIS()
        collector.ingest({'rows': [dict(row(), TIMESTAMP='2026-11-12T09:00:00Z')]},
                         now=datetime(2026, 11, 12, 10, tzinfo=timezone.utc))
        collector.connected = False
        value = collector.snapshot(port(), [], now=datetime(2026, 11, 12, 10, tzinfo=timezone.utc))
        self.assertEqual(value['mode'], 'stale')
        self.assertEqual(len(value['positions']), 1)
        self.assertTrue(value['positions'][0]['stale'])
        for extra in [{'mode': 'historical'}, {'excel_source': {'working_version': 1}}]:
            self.assertEqual(collector.snapshot({**port(), **extra}, [])['positions'], [])


class ClientLifecycle(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_signals_worker_and_disabled_ports_make_no_requests(self):
        collector = MarineTrafficAIS()
        slept = asyncio.Event()
        async def sleep(_):
            slept.set(); await asyncio.Future()
        with patch('backend.ais_marinetraffic_client.enabled_ports', return_value=[]), patch('backend.ais_marinetraffic_client.asyncio.sleep', side_effect=sleep), patch('backend.ais_marinetraffic_client.ClientSource') as source:
            task = asyncio.create_task(collector.run())
            await asyncio.wait_for(slept.wait(), 2)
            source.assert_not_called()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
            self.assertTrue(collector.stopping.is_set())

class SuppliedTransport(unittest.TestCase):
    def test_cookie_renewal_preserves_session(self):
        import httpcloak
        session = MagicMock()
        blocked = MagicMock(status_code=403)
        accepted = MagicMock(status_code=200, headers={'date': ['Tue, 17 Nov 2026 12:00:00 GMT']})
        accepted.json.return_value = {'type': 1, 'data': {'rows': []}}
        session.get.side_effect = [blocked, MagicMock(status_code=200), accepted]
        with patch.object(httpcloak, 'Session', return_value=session):
            with MarineTrafficClient(cookies={'test': 'private'}, interval=0) as client:
                self.assertEqual(client.vessel_tile(993, 803)['data']['rows'], [])
                self.assertEqual(client.last_response_time.isoformat(), '2026-11-17T12:00:00+00:00')
        session.set_cookie.assert_called_once()
        self.assertEqual(session.get.call_count, 3)
        session.close.assert_called_once()

    def test_aggregated_or_malformed_tiles_are_rejected(self):
        import httpcloak
        with patch.object(httpcloak, 'Session'):
            with MarineTrafficClient(interval=0) as client:
                for payload in ({'type': 0, 'data': {'rows': []}}, {'data': None}):
                    with patch.object(client, '_get', return_value=payload):
                        with self.assertRaises(MarineTrafficError):
                            client.vessel_tile(993, 803)

    def test_budget_checked_before_any_requests(self):
        import httpcloak
        with patch.object(httpcloak, 'Session'):
            with MarineTrafficClient() as client, patch.object(client, '_get') as get:
                with self.assertRaises(ValueError):
                    client.vessels_in_bbox(-180, -80, 180, 80)
                get.assert_not_called()

class ProviderMigration(unittest.TestCase):
    def test_old_selection_migrates_without_changing_enablement_or_calls(self):
        from backend import store
        with tempfile.TemporaryDirectory() as directory, patch.object(store, 'DB_PATH', str(Path(directory) / 'test.db')):
            initialize_demo()
            with store.connect() as db:
                record = db.execute("SELECT data FROM ports WHERE id='jph'").fetchone()
                data = json.loads(record['data'])
                data['integration'] = {'provider': 'aisstream', 'enabled': True, 'radius_km': 25}
                db.execute("UPDATE ports SET data=? WHERE id='jph'", (json.dumps(data),))
                before = [tuple(r) for r in db.execute("SELECT * FROM records WHERE kind='calls' ORDER BY id")]
            initialize_demo()
            with store.connect() as db:
                config = json.loads(db.execute("SELECT data FROM ports WHERE id='jph'").fetchone()['data'])['integration']
                revision = db.execute("SELECT revision FROM ports WHERE id='jph'").fetchone()[0]
                after = [tuple(r) for r in db.execute("SELECT * FROM records WHERE kind='calls' ORDER BY id")]
            self.assertEqual(config, {'provider': 'marinetraffic-client', 'enabled': True, 'radius_km': 25})
            self.assertEqual(before, after)
            initialize_demo()
            with store.connect() as db:
                self.assertEqual(db.execute("SELECT revision FROM ports WHERE id='jph'").fetchone()[0], revision)
