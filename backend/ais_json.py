"""Shared normalization and observation cache for the MarineTraffic adapter."""
import copy
import hashlib
import json
import re
import unicodedata
import threading
from dataclasses import replace
from datetime import datetime, timezone

from . import store
from .ais_json_model import decode, instant, MAX_ROWS


def vessel_name(value):
    name = unicodedata.normalize('NFKC', str(value or '')).casefold()
    name = re.sub(r'[\W_]+', ' ', name).strip()
    return re.sub(r'^(?:mv|m v)\s+', '', name)


class JSONAIS:
    def __init__(self):
        self.lock = threading.RLock()
        self.vessels = {}
        self.connected = False
        self.last_sync = None
        self.error = None
        self.rejected = 0
        self.fingerprint = None

    def ingest(self, payload, now=None):
        now = now or datetime.now(timezone.utc)
        reports, rejected = decode(payload)
        with self.lock:
            for report in reports:
                previous = self.vessels.get(report.ship_id)
                if previous:
                    old = previous['report']
                    if old.position_at and (not report.position_at or instant(report.position_at) < instant(old.position_at)):
                        continue
                    # Preserve static particulars when a position-only report omits
                    # them. Motion fields always belong to the new observation.
                    missing = {field: getattr(old, field) for field in
                               ('mmsi', 'imo', 'destination', 'flag', 'ship_type', 'length_m', 'width_m', 'dwt')
                               if getattr(report, field) is None}
                    if report.name == 'AIS vessel ' + report.ship_id:
                        missing['name'] = old.name
                    report = replace(report, **missing)
                self.vessels[report.ship_id] = {'report': report, 'received': now.timestamp()}
            # A valid empty response means the source's current area snapshot is empty.
            if not reports:
                self.vessels.clear()
            self.vessels = {key: row for key, row in self.vessels.items() if now.timestamp() - row['received'] <= 7200}
            while len(self.vessels) > MAX_ROWS:
                self.vessels.pop(next(iter(self.vessels)))
            self.connected, self.error = True, None
            self.last_sync, self.rejected = now.isoformat(), rejected

    def poll(self, source, now=None):
        try:
            self.ingest(source.read(), now)
            return True
        except Exception:
            # Never return/log provider URLs, filesystem paths, keys or raw exceptions.
            with self.lock:
                self.connected = False
                self.error = 'Authorized JSON AIS source is unavailable or invalid. Showing retained observations if available.'
            return False

    def snapshot(self, port, calls, now=None):
        from .ais import inside
        from .ais import bounds
        now = now or datetime.now(timezone.utc)
        result = dict(provider='json', mode='offline', positions=[], connected=False, last_sync=None,
                      source_configured=True,
                      message='Authorized JSON AIS source is not configured on the server.')
        if port.get('excel_source') or port.get('source_feed') or port.get('mode') == 'historical':
            result['message'] = 'JSON AIS tracking is isolated from Excel workspaces.'
            return result
        if not port.get('integration', {}).get('enabled'):
            result['message'] = 'JSON AIS tracking is disabled for this port.'
            return result
        area = bounds(port)
        with self.lock:
            rows = list(self.vessels.values())
            connected = self.connected and self.last_sync is not None and (now - instant(self.last_sync)).total_seconds() <= 180
            result.update(connected=connected, last_sync=self.last_sync, rejected_rows=self.rejected)
            error = self.error
        for item in rows:
            p = item['report']
            if now.timestamp() - item['received'] > 7200 or not area[0] <= p.lat <= area[2] or not area[1] <= p.lon <= area[3]:
                continue
            stamp = instant(p.position_at)
            age = (now - stamp).total_seconds() if stamp else None
            freshness = ('unknown' if age is None else 'future-position' if age < 0 else
                         'stale' if age > port.get('integration', {}).get('freshness_minutes', 30) * 60 else 'fresh')
            matches = [c for c in calls if c.get('status') not in ('Completed', 'Cancelled') and
                       ((p.mmsi and str(c.get('mmsi', '')) == p.mmsi) or (p.imo and str(c.get('imo', '')) == p.imo))
                       and not (p.mmsi and c.get('mmsi') and str(c['mmsi']) != p.mmsi)
                       and not (p.imo and c.get('imo') and str(c['imo']) != p.imo)]
            if not matches and not p.is_satellite and p.name != 'AIS vessel ' + p.ship_id:
                name = vessel_name(p.name)
                same_name_reports = [item for item in rows if vessel_name(item['report'].name) == name]
                if name and len(same_name_reports) == 1:
                    matches = [c for c in calls if c.get('status') not in ('Completed', 'Cancelled')
                               and vessel_name(c.get('name')) == name
                               and not (p.mmsi and c.get('mmsi') and str(c['mmsi']) != p.mmsi)
                               and not (p.imo and c.get('imo') and str(c['imo']) != p.imo)]
            match = matches[0] if len(matches) == 1 and not p.historical_test else None
            # SHIP_ID is kept as provider identity, never substituted for MMSI or a call ID.
            stable_id = 'json-' + hashlib.sha256(p.ship_id.encode()).hexdigest()[:24]
            result['positions'].append(dict(
                id=match['id'] if match else stable_id, vessel_id=stable_id, ship_id=p.ship_id, provider='json',
                name=p.name, mmsi=p.mmsi, imo=p.imo, position=[p.lon, p.lat], position_at=p.position_at,
                speed=p.speed_kn, course=p.course, heading=p.heading, elapsed_seconds=p.elapsed_s,
                destination=p.destination, flag=p.flag, loa=p.length_m, beam=p.width_m,
                dwt=p.dwt, ship_type=p.ship_type, is_satellite=p.is_satellite, raw_fields=copy.deepcopy(p.raw),
                freshness={'kind': freshness}, stale=freshness != 'fresh' or not connected,
                historical_test=p.historical_test, source='Historical/test JSON AIS' if p.historical_test else 'Authorized JSON AIS',
                navigation_label='Historical/test JSON AIS' if p.historical_test else 'AIS observation',
                inside=inside([p.lon, p.lat], port.get('boundary'))))
        if result['positions']:
            historical = any(p['historical_test'] for p in result['positions'])
            result['historical_test'] = historical
            result['mode'] = 'replay' if historical else 'live' if any(not p['stale'] for p in result['positions']) else 'stale'
            result['message'] = ('Historical/test JSON observations. Not live tracking.' if historical else
                                 'Authorized JSON AIS observations. Operational statuses and schedules remain user-controlled.')
            if not connected:
                result['message'] += ' Source unavailable; showing retained positions.'
        else:
            result['mode'] = 'waiting' if connected else 'offline'
            if connected:
                result['message'] = 'JSON AIS source active; no vessel positions in this port tracking area.'
            elif error:
                result['message'] = error
            elif result['source_configured']:
                result['message'] = 'Waiting for the configured JSON AIS source.'
        return result
