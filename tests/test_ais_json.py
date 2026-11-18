"""Authorized JSON ingestion. Fixtures exercise the prototype model, not its transport."""
import asyncio
import copy
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from backend import store
from backend.ais import positions
from backend.main import app, _LOGIN_ATTEMPTS


NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)


def port():
    return {'id': 'jph', 'center': [-8.63, 33.12], 'boundary': None,
            'integration': {'enabled': True, 'provider': 'json', 'radius_km': 25,
                            'freshness_minutes': 30}}


def row(**changes):
    return dict(SHIP_ID='100001', SHIPNAME='EXAMPLE VESSEL', LAT='33.13', LON='-8.62',
                SPEED='86', COURSE='0', HEADING='511', ELAPSED='2', DESTINATION='EXAMPLE HARBOR',
                FLAG='BS', LENGTH='200.0', WIDTH='32.2', DWT='76000', SHIPTYPE='Bulk Carrier',
                **changes)


def payload(rows=None, **changes):
    return {'observed_at': '2026-11-12T12:00:00Z',
            'units': {'speed': 'tenths_knots', 'elapsed': 'minutes', 'dimensions': 'metres', 'dwt': 'tonnes'},
            'data': {'rows': rows if rows is not None else [row()]}, **changes}


class JSONModel(unittest.TestCase):
    def test_prototype_fields_and_explicit_units(self):
        from backend.ais_json_model import decode
        reports, rejected = decode(payload())
        self.assertEqual(rejected, 0)
        p = reports[0]
        self.assertEqual(p.ship_id, '100001')
        self.assertEqual(p.speed_kn, 8.6)
        self.assertEqual(p.elapsed_s, 120)
        self.assertEqual(p.position_at, '2026-11-12T11:58:00+00:00')
        self.assertEqual(p.course, 0)
        self.assertIsNone(p.heading)
        self.assertEqual(p.length_m, 200.0)
        self.assertEqual(p.width_m, 32.2)
        self.assertEqual(p.dwt, 76000)
        self.assertEqual(p.destination, 'EXAMPLE HARBOR')
        self.assertEqual(p.flag, 'BS')
        self.assertEqual(p.ship_type, 'Bulk Carrier')

    def test_unknown_units_and_clock_are_not_invented(self):
        from backend.ais_json_model import decode
        p = decode({'rows': [row()]})[0][0]
        self.assertIsNone(p.speed_kn)
        self.assertIsNone(p.position_at)
        self.assertIsNone(p.elapsed_s)
        self.assertIsNone(p.length_m)
        self.assertEqual(p.raw['SPEED'], '86')

    def test_envelopes_nulls_coordinates_and_no_fake_identity(self):
        from backend.ais_json_model import decode
        good = row(); good.update(SPEED=0, COURSE=0, HEADING=0, SHIP_ID=123)
        for envelope in [[good], {'rows': [good]}, {'data': [good]}, {'DATA': [good]}, {'data': {'rows': [good]}}]:
            p = decode(envelope)[0][0]
            self.assertEqual(p.ship_id, '123')
            self.assertEqual(p.heading, 0)
        bad = [dict(good, LAT='NaN'), dict(good, LON=181), dict(good, SHIP_ID=None), None]
        rows, rejected = decode({'rows': [good, *bad]})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rejected, 4)
        for bad_envelope in [{}, {'data': {}}, {'rows': 'wrong'}, {'error': 'secret'}]:
            with self.assertRaises(ValueError): decode(bad_envelope)


class JSONCollector(unittest.TestCase):
    def setUp(self):
        from backend.ais_json import JSONAIS
        self.collector = JSONAIS()

    def test_stable_identity_updates_metadata_and_late_reports(self):
        self.collector.ingest(payload(), NOW)
        first = self.collector.snapshot(port(), [], now=NOW)['positions'][0]
        update = row(); update.update(LON=-8.62, SHIPNAME='UPDATED', MMSI='999000001')
        self.collector.ingest(payload([update], observed_at='2026-11-12T12:01:00Z'), NOW)
        second = self.collector.snapshot(port(), [], now=NOW)['positions'][0]
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(second['name'], 'UPDATED')
        self.assertEqual(second['mmsi'], '999000001')
        self.collector.ingest(payload(), NOW)
        self.collector.ingest({'rows': [row()]}, NOW)
        latest = self.collector.snapshot(port(), [], now=NOW)['positions'][0]
        self.assertEqual(latest['position'], [-8.62, 33.13])
        self.assertEqual(latest['position_at'], '2026-11-12T11:59:00+00:00')

    def test_fresh_stale_unknown_future_test_data_and_outage_states(self):
        self.collector.ingest(payload(), NOW)
        self.assertEqual(self.collector.snapshot(port(), [], now=NOW)['mode'], 'live')
        later = datetime(2026, 11, 12, 13, 0, tzinfo=timezone.utc)
        self.assertEqual(self.collector.snapshot(port(), [], now=later)['mode'], 'stale')
        self.collector.connected = False
        self.assertEqual(self.collector.snapshot(port(), [], now=NOW)['mode'], 'stale')
        from backend.ais_json import JSONAIS
        for data in [{'rows': [row()]}, payload(observed_at='2026-11-12T13:00:00Z')]:
            c = JSONAIS(); c.ingest(data, NOW)
            self.assertNotEqual(c.snapshot(port(), [], now=NOW)['mode'], 'live')
        c = JSONAIS(); c.ingest(payload(historical_test=True), NOW)
        self.assertEqual(c.snapshot(port(), [], now=NOW)['mode'], 'replay')

    def test_geofencing_safe_ids_call_matching_and_no_operational_mutation(self):
        data = row(); data.update(SHIP_ID='bad\"id<script>', MMSI='999000001')
        self.collector.ingest(payload([data]), NOW)
        calls = [{'id': 'call', 'mmsi': '999000001', 'name': 'Planned', 'status': 'Loading'}]
        original = copy.deepcopy(calls)
        matched = self.collector.snapshot(port(), calls, now=NOW)['positions'][0]
        self.assertEqual(matched['id'], 'call')
        self.assertEqual(calls, original)
        unknown = self.collector.snapshot(port(), [], now=NOW)['positions'][0]
        self.assertNotIn('"', unknown['id'])
        p = port(); p['center'] = [4.4, 51.9]
        self.assertEqual(self.collector.snapshot(p, calls, now=NOW)['positions'], [])
        p = port(); p['excel_source'] = {'working_version': 1}
        self.assertEqual(self.collector.snapshot(p, calls, now=NOW)['positions'], [])


    def test_empty_success_is_waiting_and_invalid_payload_does_not_erase_cache(self):
        self.collector.ingest({'rows': []}, NOW)
        self.assertEqual(self.collector.snapshot(port(), [], now=NOW)['mode'], 'waiting')
        self.collector.ingest(payload(), NOW)
        source = MagicMock(); source.fingerprint = 'test'
        source.read.return_value = {'error': 'secret URL'}
        self.assertFalse(self.collector.poll(source, now=NOW))
        self.assertEqual(len(self.collector.snapshot(port(), [], now=NOW)['positions']), 1)

    def test_position_only_updates_preserve_particulars_but_not_old_motion(self):
        data = row(); data['MMSI'] = '999000001'
        self.collector.ingest(payload([data]), NOW)
        newer = {'SHIP_ID': '100001', 'LAT': 33.13, 'LON': -8.62,
                 'TIMESTAMP': '2026-11-12T11:59:00Z'}
        self.collector.ingest({'rows': [newer]}, NOW)
        p = self.collector.snapshot(port(), [], now=NOW)['positions'][0]
        self.assertEqual(p['name'], 'EXAMPLE VESSEL')
        self.assertEqual(p['mmsi'], '999000001')
        self.assertEqual(p['loa'], 200.0)
        self.assertEqual(p['destination'], 'EXAMPLE HARBOR')
        self.assertIsNone(p['speed'])
        self.assertIsNone(p['heading'])
        self.assertIsNone(p['course'])

    def test_ambiguous_calls_and_historical_samples_stay_read_only(self):
        data = row(); data['MMSI'] = '999000001'
        calls = [{'id': 'a', 'mmsi': '999000001'}, {'id': 'b', 'mmsi': '999000001'}]
        self.collector.ingest(payload([data]), NOW)
        p = self.collector.snapshot(port(), calls, now=NOW)['positions'][0]
        self.assertNotIn(p['id'], ['a', 'b'])
        self.collector.ingest(payload([data], historical_test=True), NOW)
        p = self.collector.snapshot(port(), calls[:1], now=NOW)['positions'][0]
        self.assertNotEqual(p['id'], 'a')

class NameMatching(unittest.TestCase):
    def result(self, rows, calls):
        from backend.ais_json import JSONAIS
        collector = JSONAIS(); collector.ingest(payload(rows), NOW)
        return collector.snapshot(port(), calls, now=NOW)['positions']

    def test_normalized_name_matches_without_identifiers(self):
        calls = [{'id':'planned', 'name':' MV  Example-Vessel ', 'status':'Loading'}]
        self.assertEqual(self.result([row()],calls)[0]['id'],'planned')

    def test_conflicting_identifiers_duplicate_calls_and_duplicate_reports_do_not_match(self):
        data=row();data['MMSI']='999000001'
        call={'id':'planned','name':data['SHIPNAME'],'status':'Loading'}
        for calls in ([dict(call,mmsi='999999999')], [call,dict(call,id='duplicate')], [dict(call,status='Completed')]):
            self.assertNotEqual(self.result([data],calls)[0]['id'],'planned')
        other=dict(data,SHIP_ID='different',MMSI='999999999')
        self.assertTrue(all(p['id']!='planned' for p in self.result([data,other],[call])))
