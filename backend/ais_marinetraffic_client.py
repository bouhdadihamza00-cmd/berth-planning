"""Optional source using the user's MarineTraffic client, isolated from official AIS."""
import asyncio
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import store
from .ais_json import JSONAIS
from .ais_json_model import numeric
from .ais import bounds


def enabled_ports():
    with store.connect() as db:
        ports = [dict(json.loads(r['data']), id=r['id']) for r in db.execute('SELECT id,data FROM ports')]
    return [p for p in ports if p.get('integration', {}).get('enabled') and p.get('mode') != 'historical'
            and not p.get('excel_source') and not p.get('source_feed')]


def cookies_path():
    return Path(os.environ.get('MARINETRAFFIC_CLIENT_COOKIES_FILE',
                               str(store.ROOT / 'data' / 'marinetraffic-client-cookies.json')))


class ClientSource:
    def __init__(self, ports, client_factory=None, stopping=None):
        from .marinetraffic_client import MarineTrafficClient
        self.ports = ports
        self.client_factory = client_factory or MarineTrafficClient
        self.stopping = stopping

    def read(self):
        from .marinetraffic_client import MarineTrafficClient
        cookies = {}
        path = cookies_path()
        if path.is_file():
            cookies = json.loads(path.read_text())
            if not isinstance(cookies, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in cookies.items()):
                raise ValueError('Invalid client cookie configuration')
        zoom = int(os.environ.get('MARINETRAFFIC_CLIENT_ZOOM', '12'))
        if not 2 <= zoom <= 18:
            raise ValueError('Invalid client zoom')
        units = {'speed': os.environ.get('MARINETRAFFIC_CLIENT_SPEED_UNIT', 'tenths_knots'),
                 'elapsed': os.environ.get('MARINETRAFFIC_CLIENT_ELAPSED_UNIT', 'minutes'),
                 'dimensions': 'metres', 'dwt': 'tonnes'}
        areas = [bounds(port) for port in self.ports]
        tiles = sorted({tile for b in areas for tile in MarineTrafficClient.tiles(b[1], max(-85.05112878, b[0]), b[3], min(85.05112878, b[2]), zoom)})
        rows = {}
        completed, failed, consecutive_failures = 0, 0, 0
        with self.client_factory(cookies=cookies) as client:
            for x, y in tiles:
                if self.stopping and self.stopping.is_set():
                    raise RuntimeError('MarineTraffic client is stopping')
                try:
                    raw = client.vessel_tile(x, y, zoom)["data"]["rows"]
                except Exception:
                    failed += 1
                    consecutive_failures += 1
                    if consecutive_failures >= 3:
                        break
                    continue
                completed += 1
                consecutive_failures = 0
                received = client.last_response_time if isinstance(getattr(client, 'last_response_time', None), datetime) else datetime.now(timezone.utc)
                if received.tzinfo is None:
                    received = received.replace(tzinfo=timezone.utc)
                for original in raw:
                    if not isinstance(original, dict):
                        continue
                    row = dict(original)
                    lat, lon = numeric(row.get('LAT'), -90, 90), numeric(row.get('LON'), -180, 180)
                    if lat is None or lon is None or not any(b[0] <= lat <= b[2] and b[1] <= lon <= b[3] for b in areas):
                        continue
                    elapsed = numeric(row.get('ELAPSED'), 0, 52596000)
                    if elapsed is not None and units['elapsed'] in ('minutes', 'seconds'):
                        row['TIMESTAMP'] = (received - timedelta(seconds=elapsed * (60 if units['elapsed'] == 'minutes' else 1))).isoformat()
                    identity = str(row.get('SHIP_ID') or '')
                    if not identity:
                        continue
                    old = rows.get(identity)
                    # Neighboring tiles can repeat the same vessel. Prefer its
                    # youngest report; never deduplicate distinct satellite IDs by proximity.
                    previous_age = numeric(old.get('ELAPSED')) if old else None
                    if old is None or (elapsed is not None and (previous_age is None or elapsed < previous_age)):
                        rows[identity] = row
        if failed and not rows:
            raise RuntimeError('MarineTraffic client did not retrieve area positions')
        return {'rows': list(rows.values()), 'units': units,
                'coverage': {'tiles_total': len(tiles), 'tiles_received': completed, 'tiles_failed': failed,
                             'complete': completed == len(tiles)}}


class MarineTrafficAIS(JSONAIS):
    def __init__(self):
        super().__init__()
        self.stopping = threading.Event()
        self.coverage = None

    def ingest(self, payload, now=None):
        super().ingest(payload, now)
        with self.lock:
            self.coverage = payload.get('coverage') if isinstance(payload, dict) else None

    def snapshot(self, port, calls, now=None):
        value = super().snapshot(port, calls, now)
        value.update(provider='marinetraffic-client', source_configured=True,
                     credential_configured=cookies_path().is_file())
        value['message'] = value['message'].replace('Authorized JSON AIS', 'MarineTraffic client').replace('JSON AIS', 'MarineTraffic client')
        if not port.get('integration', {}).get('enabled') or port.get('excel_source') or port.get('source_feed') or port.get('mode') == 'historical':
            return value
        if not self.last_sync and not self.error:
            value['mode'] = 'connecting'
            value['message'] = 'Collecting the configured port area with the MarineTraffic client. Initial collection can take several minutes.'
        if self.error:
            value['message'] = 'MarineTraffic client request failed or was blocked. Retained observations are stale; no simulated positions are substituted.'
        with self.lock:
            coverage = dict(self.coverage) if self.coverage else None
        if coverage:
            value['coverage'] = coverage
            if not coverage['complete'] and not self.error:
                value['mode'] = 'partial'
                value['message'] = f"MarineTraffic client received {coverage['tiles_received']} of {coverage['tiles_total']} area tiles. Showing partial coverage; failed tiles will be retried."
        for position in value['positions']:
            position['provider'] = 'marinetraffic-client'
            position['source'] = 'MarineTraffic client · website observation'
            position['vessel_id'] = position['vessel_id'].replace('json-', 'mt-client-', 1)
            if position['id'].startswith('json-'):
                position['id'] = position['id'].replace('json-', 'mt-client-', 1)
        return value

    async def run(self):
        self.stopping.clear()
        try:
            while True:
                ports = enabled_ports()
                if not ports:
                    self.connected = False
                    await asyncio.sleep(2)
                    continue
                await asyncio.to_thread(self.poll, ClientSource(ports, stopping=self.stopping))
                await asyncio.sleep(60 if self.connected else 120)
        finally:
            self.stopping.set()


collector = MarineTrafficAIS()
